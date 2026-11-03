using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using VetroUpdate;

internal static class Tests
{
    private static int count;
    private const string Duid = "TESTTV1234567";
    private static readonly string Before = new string('b', 40), After = new string('a', 40);
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static void Throws(Action operation, string message)
    {
        try { operation(); } catch (Exception) { return; }
        throw new Exception(message);
    }
    private static void Test(string name, Action test) { test(); count++; Console.WriteLine("PASS " + name); }

    private sealed class FakeSdb : ISdbSession
    {
        private readonly Fixture fixture;
        internal FakeSdb(Fixture fixture) { this.fixture = fixture; }
        public string Execute(string command, int timeout)
        {
            fixture.Commands.Add(command);
            if (command == "shell:0 getduid") return Duid + "\r\n";
            Assert(command == "shell:0 vd_appinstall vetrotvapp " + fixture.Stage + "/vetro.wgt", "Fixed package and staged path");
            fixture.DuringInstall();
            if (fixture.FailAfterSubmit) throw new IOException("lost acknowledgement");
            return "install returned";
        }
        public void Dispose() { }
    }

    private sealed class Fixture : IDisposable
    {
        internal readonly string Stage = "/tmp/vetro-update-" + Guid.NewGuid().ToString("N").Substring(0, 16);
        internal readonly List<string> Commands = new List<string>();
        internal readonly Worker Worker;
        internal readonly Job Job;
        internal Action DuringInstall = () => { };
        internal bool FailAfterSubmit, FailInstallConnection;
        internal uint Uid;
        internal int Launches, Connections;
        internal string InstalledRoot { get { return Path.Combine(Stage, "installed"); } }
        internal string Lock { get { return Path.Combine(Stage, "lock"); } }
        internal Fixture()
        {
            Directory.CreateDirectory(Stage);
            Directory.CreateDirectory(Path.Combine(InstalledRoot, "service"));
            Directory.CreateDirectory(Path.Combine(InstalledRoot, "native/dock"));
            File.WriteAllText(Path.Combine(InstalledRoot, "author-signature.xml"),
                "<Signature xmlns='urn:test'><X509Certificate>YXV0aG9y</X509Certificate></Signature>");
            SetRevision(Before);
            File.WriteAllText(Path.Combine(InstalledRoot, "native/dock/tvlauncher-dotnet.dll"), "native");
            File.WriteAllText(Path.Combine(Stage, "vetro.wgt"), "package");
            Worker = new Worker(Stage, new[] { InstalledRoot }, () => {
                Connections++;
                if (FailInstallConnection && Connections == 2) throw new IOException("connection refused");
                return new FakeSdb(this);
            }, () => Uid, () => { Launches++; return "requested"; }, Lock);
            Job = new Job { revision = After, previousRevision = Before, size = 7,
                sha256 = VetroUpdate.Worker.Hash(Encoding.UTF8.GetBytes("package")),
                authorFingerprint = VetroUpdate.Worker.Hash(Encoding.UTF8.GetBytes("author")),
                launcherSha256 = VetroUpdate.Worker.Hash(Encoding.UTF8.GetBytes("native")),
                duidFingerprint = VetroUpdate.Worker.Hash(Encoding.UTF8.GetBytes(Duid.ToLowerInvariant())) };
        }
        internal void SetRevision(string revision) { File.WriteAllText(Path.Combine(InstalledRoot, "service/build-info.js"), "module.exports={\"sourceRevision\":\"" + revision + "\"}"); }
        public void Dispose() { Directory.Delete(Stage, true); }
    }

    private static byte[] Packet(string command, uint first, uint second, byte[] data = null)
    {
        data = data ?? new byte[0];
        using (var memory = new MemoryStream())
        using (var writer = new BinaryWriter(memory))
        {
            uint code = BitConverter.ToUInt32(Encoding.ASCII.GetBytes(command), 0), sum = 0;
            foreach (byte value in data) sum += value;
            writer.Write(code); writer.Write(first); writer.Write(second); writer.Write((uint)data.Length); writer.Write(sum); writer.Write(~code); writer.Write(data);
            return memory.ToArray();
        }
    }
    private static string ReadPacket(NetworkStream stream, uint? first = null, uint? second = null)
    {
        using (var reader = new BinaryReader(stream, Encoding.UTF8, true))
        {
            byte[] header = reader.ReadBytes(24);
            Assert(header.Length == 24, "Complete header");
            if (first.HasValue) Assert(BitConverter.ToUInt32(header, 4) == first.Value, "Packet sender ID");
            if (second.HasValue) Assert(BitConverter.ToUInt32(header, 8) == second.Value, "Packet recipient ID");
            int size = BitConverter.ToInt32(header, 12);
            Assert(size >= 0 && size <= 4096, "Bounded packet");
            byte[] data = reader.ReadBytes(size);
            Assert(data.Length == size, "Complete payload");
            return Encoding.ASCII.GetString(header, 0, 4) + ":" + Encoding.UTF8.GetString(data);
        }
    }
    private static void Send(NetworkStream stream, byte[] packet)
    {
        // Fragment every frame to exercise partial socket reads.
        for (int offset = 0; offset < packet.Length; offset += 3)
            stream.Write(packet, offset, Math.Min(3, packet.Length - offset));
    }
    private static void WithServer(Action<NetworkStream> serve, Action<int> client)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var task = Task.Run(() => {
            using (var connection = listener.AcceptTcpClient())
            using (var stream = connection.GetStream())
            {
                stream.ReadTimeout = 3000; stream.WriteTimeout = 3000;
                serve(stream);
            }
        });
        try { client(port); Assert(task.Wait(5000), "Fake SDB server finished"); task.GetAwaiter().GetResult(); }
        finally { listener.Stop(); }
    }

    public static int Main()
    {
        Test("DUID validation matches the signing tool's 10-64 alphanumeric format", () => {
            foreach (string value in new[] { "TEST123456", Duid, new string('A', 64) }) {
                Assert(Worker.ParseDuid(value) == value, "Valid DUID length " + value.Length);
                Assert(Worker.ParseDuid("\r\n  " + value + " \r\n") == value, "Whitespace normalization");
                Assert(Worker.ParseDuid(value + "\r\nignored second line") == value, "First-line behavior");
            }
            foreach (string value in new[] { "", "TEST12345", new string('A', 65), "DUID: " + Duid,
                "error: command failed", "invalid-command", "No_such_command", Duid + "\0" }) {
                try { Worker.ParseDuid(value); throw new Exception("Invalid DUID accepted"); }
                catch (IOException error) {
                    Assert(error.Message.Contains("first-line length="), "Length-only diagnostic");
                    if (value.Length > 0) Assert(!error.Message.Contains(value), "Raw response is not logged");
                }
            }
        });
        Test("probe and installed certificate", () => {
            using (var f = new Fixture()) {
                var info = f.Worker.Probe(); Assert(info.duid == Duid && info.uid == 0 && info.sourceRevision == Before, "Probe identity");
                Assert(info.authorFingerprint == f.Job.authorFingerprint, "X509 fingerprint");
                f.Uid = 1; Throws(() => f.Worker.Probe(), "Non-root probe rejected");
            }
            Throws(() => Worker.AuthorFingerprint("<!DOCTYPE a [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><a>&x;</a>"), "No XML external entity resolution");
        });
        Test("helper response uses a versioned operation-specific frame", () => {
            using (var f = new Fixture()) {
                string line = Program.ResponseLine("probe", f.Worker.Probe());
                Assert(line.StartsWith(Program.ResponsePrefix) && !line.Contains('\n'), "Single marked result line");
                using (var document = JsonDocument.Parse(line.Substring(Program.ResponsePrefix.Length))) {
                    var value = document.RootElement;
                    Assert(value.GetProperty("protocol").GetInt32() == 1, "Protocol version");
                    Assert(value.GetProperty("mode").GetString() == "probe", "Operation identity");
                    Assert(value.GetProperty("result").GetProperty("duid").GetString() == Duid, "Typed result serialized");
                }
                // CI passes this entire test log (including the other PASS
                // lines) through the real Python decoder to check the boundary.
                Console.WriteLine("Runtime fixture startup");
                Console.WriteLine(line);
                Console.WriteLine("Runtime fixture shutdown");
            }
        });
        Test("checksum, identity, revision and root preflight", () => {
            Action<Fixture>[] change = {
                f => f.Job.sha256 = new string('0', 64), f => f.Job.size = 9,
                f => f.Job.authorFingerprint = new string('0', 64), f => f.Job.duidFingerprint = new string('0', 64),
                f => f.Job.previousRevision = new string('c', 40), f => f.Uid = 5,
                f => f.Job.revision = "invalid", f => f.Job.launcherSha256 = "invalid"
            };
            foreach (var mutate in change) using (var f = new Fixture()) {
                mutate(f); var state = f.Worker.Install(f.Job);
                Assert(state.phase == "not-submitted" && state.submitted == false && state.finished, "Definite failure");
                Assert(f.Commands.FindAll(c => c.Contains("vd_appinstall")).Count == 0 && f.Launches == 0, "No install or launch");
            }
        });
        Test("single submission and verified lock release", () => {
            using (var f = new Fixture()) {
                var state = f.Worker.Install(f.Job); Assert(state.phase == "install-returned" && state.finished, "Completed attempt");
                Assert(f.Launches == 1 && Directory.Exists(f.Lock), "Lock retained until verification");
                f.Worker.Install(f.Job); Assert(f.Commands.FindAll(c => c.Contains("vd_appinstall")).Count == 1, "No repeat install");
                Throws(() => f.Worker.Finish(f.Job), "Old installed revision not accepted");
                f.SetRevision(After); f.Worker.Finish(f.Job); Assert(!Directory.Exists(f.Lock), "Own lock released");
            }
        });
        Test("lost acknowledgement stays pending and cannot replay", () => {
            using (var f = new Fixture()) {
                f.FailAfterSubmit = true;
                var state = f.Worker.Install(f.Job); Assert(state.phase == "install-uncertain" && state.submitted == true, "Unknown outcome");
                f.Worker.Install(f.Job); Assert(f.Commands.FindAll(c => c.Contains("vd_appinstall")).Count == 1, "No replay");
                Assert(Directory.Exists(f.Lock) && f.Launches == 1, "Retain lock and request reopen");
                f.SetRevision(After); f.Worker.Finish(f.Job);
            }
        });
        Test("connection failure before dispatch releases only own lock", () => {
            using (var f = new Fixture()) {
                f.FailInstallConnection = true; var state = f.Worker.Install(f.Job);
                Assert(state.submitted == false && !Directory.Exists(f.Lock), "Safe pre-dispatch failure");
            }
            using (var f = new Fixture()) {
                Directory.CreateDirectory(f.Lock); File.WriteAllText(Path.Combine(f.Lock, "owner"), "other");
                var state = f.Worker.Install(f.Job);
                Assert(state.submitted == false && File.ReadAllText(Path.Combine(f.Lock, "owner")) == "other", "Other lock untouched");
            }
        });
        Test("second process and early verification cannot race active updater", () => {
            using (var f = new Fixture()) {
                f.DuringInstall = () => {
                    var duplicate = f.Worker.Install(f.Job); Assert(duplicate.phase == "installing", "Running state retained");
                    f.SetRevision(After); Throws(() => f.Worker.Finish(f.Job), "Do not clean an active updater");
                };
                f.Worker.Install(f.Job); Assert(f.Commands.FindAll(c => c.Contains("vd_appinstall")).Count == 1, "One dispatch");
            }
        });
        Test("SDB handshake, fragmented response, acknowledgements and close", () => {
            WithServer(stream => {
                Assert(ReadPacket(stream) == "CNXN:host::\0", "Client handshake"); Send(stream, Packet("CNXN", 0x01000000, 4096));
                Assert(ReadPacket(stream) == "OPEN:shell:0 getduid\0", "Command open");
                Send(stream, Packet("OKAY", 7, 12345)); Send(stream, Packet("WRTE", 7, 12345, Encoding.UTF8.GetBytes(Duid)));
                Assert(ReadPacket(stream, 12345, 7) == "OKAY:", "Data acknowledged"); Send(stream, Packet("CLSE", 7, 12345));
                Assert(stream.ReadByte() == -1, "CLOSE receives no reply");
            }, port => { using (var session = new SdbSession("127.0.0.1", port, 2000)) Assert(session.Execute("shell:0 getduid", 2000) == Duid, "Exact output"); });
        });
        Test("SDB zero-sender WRITE and CLOSE complete the actual probe", () => {
            foreach (var ids in new[] { new uint[] { 0, 7 }, new uint[] { 7, 0 }, new uint[] { 0, 0 } }) {
                using (var f = new Fixture()) WithServer(stream => {
                    Assert(ReadPacket(stream) == "CNXN:host::\0", "Client handshake"); Send(stream, Packet("CNXN", 0x01000000, 4096));
                    Assert(ReadPacket(stream, 12345, 0) == "OPEN:shell:0 getduid\0", "Read-only DUID probe");
                    Send(stream, Packet("OKAY", 7, 12345));
                    foreach (string chunk in new[] { Duid.Substring(0, 8), Duid.Substring(8) + "\r\n" }) {
                        Send(stream, Packet("WRTE", ids[0], 12345, Encoding.UTF8.GetBytes(chunk)));
                        Assert(ReadPacket(stream, 12345, 7) == "OKAY:", "ACK uses the peer from READY, including after zero-sender WRITE");
                    }
                    Send(stream, Packet("CLSE", ids[1], 12345));
                    Assert(stream.ReadByte() == -1, "No CLOSE reply or second command");
                }, port => {
                    var worker = new Worker(f.Stage, new[] { f.InstalledRoot },
                        () => new SdbSession("127.0.0.1", port, 2000), () => 0, () => "unused", f.Lock);
                    var info = worker.Probe();
                    Assert(info.duid == Duid && info.sourceRevision == Before, "Complete probe result");
                });
            }
        });
        Test("SDB compatibility preserves stream boundaries and READY ordering", () => {
            var frames = new[] {
                Packet("WRTE", 8, 12345, Encoding.UTF8.GetBytes(Duid)), Packet("CLSE", 8, 12345),
                Packet("WRTE", 0, 12346), Packet("CLSE", 0, 12346), Packet("OKAY", 8, 12345)
            };
            foreach (byte[] frame in frames) WithServer(stream => {
                ReadPacket(stream); Send(stream, Packet("CNXN", 0x01000000, 4096)); ReadPacket(stream);
                Send(stream, Packet("OKAY", 7, 12345)); stream.Write(frame, 0, frame.Length);
            }, port => {
                using (var session = new SdbSession("127.0.0.1", port, 1000)) {
                    try { session.Execute("shell:0 getduid", 1000); throw new Exception("Invalid stream accepted"); }
                    catch (IOException error) {
                        Assert(error.Message.Contains("packet=") && error.Message.Contains("opened=7"), "Header-only diagnostics");
                        Assert(!error.Message.Contains(Duid), "DUID never included in diagnostics");
                    }
                }
            });
            foreach (byte[] frame in new[] { Packet("OKAY", 0, 12345), Packet("WRTE", 0, 12345), Packet("CLSE", 0, 12345) })
                WithServer(stream => {
                    ReadPacket(stream); Send(stream, Packet("CNXN", 0x01000000, 4096)); ReadPacket(stream);
                    stream.Write(frame, 0, frame.Length);
                }, port => { using (var session = new SdbSession("127.0.0.1", port, 1000)) Throws(() => session.Execute("shell:0 getduid", 1000), "No success before valid READY"); });
        });
        Test("SDB auth, corrupt framing, checksum and oversized frames fail", () => {
            var frames = new List<byte[]> { Packet("AUTH", 1, 0), Packet("CNXN", 0, 4096), Packet("CNXN", 0, 4096, new byte[] { 1 }), Packet("CNXN", 0, 4096) };
            frames[1][20] ^= 1; frames[2][16] ^= 1; Array.Copy(BitConverter.GetBytes(5000), 0, frames[3], 12, 4);
            foreach (byte[] frame in frames) WithServer(stream => {
                ReadPacket(stream); stream.Write(frame, 0, frame.Length);
            }, port => Throws(() => { using (var session = new SdbSession("127.0.0.1", port, 500)) { } }, "Invalid handshake rejected"));
        });
        Test("SDB EOF, wrong stream, refusal and timeout are not success", () => {
            for (int scenario = 0; scenario < 4; scenario++) {
                int selected = scenario;
                WithServer(stream => {
                    ReadPacket(stream); Send(stream, Packet("CNXN", 0x01000000, 4096)); ReadPacket(stream);
                    if (selected == 1) Send(stream, Packet("OKAY", 7, 12346));
                    if (selected == 2) Send(stream, Packet("CLSE", 0, 12345));
                    if (selected == 3) Thread.Sleep(200);
                }, port => { using (var session = new SdbSession("127.0.0.1", port, 1000)) Throws(() => session.Execute("shell:0 getduid", 100), "Unconfirmed command rejected"); });
            }
        });
        Console.WriteLine(count + " updater suites passed");
        return 0;
    }
}
