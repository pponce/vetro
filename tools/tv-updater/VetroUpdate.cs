using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Xml;

namespace VetroUpdate
{
    internal sealed class Job
    {
        public string revision { get; set; }
        public string previousRevision { get; set; }
        public string sha256 { get; set; }
        public string authorFingerprint { get; set; }
        public string duidFingerprint { get; set; }
        public string launcherSha256 { get; set; }
        public long size { get; set; }
    }

    internal sealed class Installed
    {
        public string authorFingerprint { get; set; }
        public string sourceRevision { get; set; }
        public string launcherSha256 { get; set; }
        public string duid { get; set; }
        public uint uid { get; set; }
        public bool updateLocked { get; set; }
        public string runtime { get; set; }
    }

    internal sealed class Record
    {
        public string revision { get; set; }
        public bool? submitted { get; set; }
        public string phase { get; set; }
        public string error { get; set; }
        public string output { get; set; }
        public string launch { get; set; }
        public bool finished { get; set; }
    }

    internal sealed class Worker
    {
        internal readonly string DirectoryPath, LockPath;
        private readonly string[] roots;
        private readonly Func<ISdbSession> connect;
        private readonly Func<uint> uid;
        private readonly Func<string> launch;
        internal static readonly Regex Stage = new Regex(@"\A/tmp/vetro-update-[a-f0-9]{16}\z");
        private static readonly Regex Revision = new Regex(@"\A[a-f0-9]{40}\z");
        private static readonly Regex Sha = new Regex(@"\A[a-f0-9]{64}\z");

        [DllImport("libc", SetLastError = true)] private static extern int mkdir(string path, uint mode);
        [DllImport("libc")] private static extern uint getuid();

        internal Worker(string directory, string[] installedRoots = null,
            Func<ISdbSession> connection = null, Func<uint> userId = null,
            Func<string> launcher = null, string lockPath = "/tmp/vetro-combined-update.lock")
        {
            DirectoryPath = directory; LockPath = lockPath;
            roots = installedRoots ?? new[] {
                "/opt/usr/apps/vetrotvapp/res/wgt", "/opt/usr/apps/vetrotvapp/wgt", "/opt/usr/apps/vetrotvapp",
                "/opt/usr/home/owner/apps_rw/vetrotvapp/res/wgt", "/opt/usr/home/owner/apps_rw/vetrotvapp/wgt", "/opt/usr/home/owner/apps_rw/vetrotvapp",
                "/home/owner/apps_rw/vetrotvapp/res/wgt", "/home/owner/apps_rw/vetrotvapp/wgt", "/home/owner/apps_rw/vetrotvapp" };
            connect = connection ?? (() => new SdbSession("127.0.0.1", 26101, 8000));
            uid = userId ?? getuid;
            launch = launcher ?? Launch;
        }

        internal static string Hash(byte[] bytes)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }

        internal static string AuthorFingerprint(string xml)
        {
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
            using (var reader = XmlReader.Create(new StringReader(xml), settings))
                while (reader.Read())
                    if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "X509Certificate")
                        return Hash(Convert.FromBase64String(reader.ReadElementContentAsString()));
            throw new IOException("Installed author certificate could not be read");
        }

        internal Installed ReadInstalled()
        {
            string root = Array.Find(roots, candidate => File.Exists(Path.Combine(candidate, "author-signature.xml")));
            if (root == null) throw new IOException("Installed Vetro author certificate was not found");
            string info = File.ReadAllText(Path.Combine(root, "service/build-info.js"));
            var revision = Regex.Match(info, "[\"']?sourceRevision[\"']?\\s*:\\s*[\"']([a-f0-9]{40})[\"']");
            return new Installed {
                authorFingerprint = AuthorFingerprint(File.ReadAllText(Path.Combine(root, "author-signature.xml"))),
                sourceRevision = revision.Success ? revision.Groups[1].Value : null,
                launcherSha256 = Hash(File.ReadAllBytes(Path.Combine(root, "native/dock/tvlauncher-dotnet.dll"))) };
        }

        internal static string ParseDuid(string output)
        {
            string response = (output ?? string.Empty).Trim();
            string duid = response.Split('\n')[0].Trim();
            // Match Apps2Samsung.Core/Models/TizenDuid.cs: Samsung IDs can be
            // shorter than 16 characters. Do not accept error text or labels.
            bool alphanumeric = Regex.IsMatch(duid, @"\A[A-Za-z0-9]+\z");
            if (duid.Length < 10 || duid.Length > 64 || !alphanumeric)
                throw new IOException("Loopback SDB did not return a usable TV DUID"
                    + " (first-line length=" + duid.Length + ", alphanumeric=" + alphanumeric
                    + ", response length=" + response.Length + "; expected 10-64 letters/digits)");
            return duid;
        }

        internal Installed Probe()
        {
            if (uid() != 0) throw new IOException("Updater must be started through Vetro root");
            var info = ReadInstalled();
            using (var session = connect())
            {
                info.duid = ParseDuid(session.Execute("shell:0 getduid", 8000));
            }
            info.uid = uid(); info.updateLocked = Directory.Exists(LockPath) || File.Exists(LockPath);
            info.runtime = Environment.Version.ToString();
            return info;
        }

        private static bool Matches(Regex pattern, string value) { return value != null && pattern.IsMatch(value); }

        private void Validate(Job job)
        {
            if (job == null || !Matches(Revision, job.revision) || !Matches(Sha, job.sha256) ||
                !Matches(Sha, job.authorFingerprint) || !Matches(Sha, job.duidFingerprint) || !Matches(Sha, job.launcherSha256) ||
                job.size < 1 || job.size > 32 * 1024 * 1024 ||
                job.previousRevision != null && !Matches(Revision, job.previousRevision)) throw new IOException("Invalid update job");
            string package = Path.Combine(DirectoryPath, "vetro.wgt");
            if (new FileInfo(package).Length != job.size || Hash(File.ReadAllBytes(package)) != job.sha256)
                throw new IOException("Transferred package does not match its checksum");
        }

        private static bool Acquire(string path)
        {
            // Directory.CreateDirectory is not exclusive when the directory exists.
            if (mkdir(path, 448) == 0) return true;
            int error = Marshal.GetLastWin32Error();
            if (error == 17) return false; // EEXIST
            throw new IOException("Could not acquire updater directory (errno " + error + ")");
        }

        private void Save(Record record)
        {
            string file = Path.Combine(DirectoryPath, "state.json");
            File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(record) + "\n");
            File.Move(file + ".tmp", file, true);
        }

        private void Unlock()
        {
            string owner = Path.Combine(LockPath, "owner");
            if (File.ReadAllText(owner) != DirectoryPath) throw new IOException("Update lock belongs to another attempt");
            File.Delete(owner); Directory.Delete(LockPath);
        }

        private static string Launch()
        {
            try
            {
                using (var process = Process.Start(new ProcessStartInfo {
                    FileName = "/usr/bin/app_launcher", Arguments = "-s vetrotvapp.app", UseShellExecute = false,
                    RedirectStandardOutput = true, RedirectStandardError = true }))
                {
                    // Drain both streams so app-launcher output cannot hold verification open.
                    process.OutputDataReceived += (sender, value) => { };
                    process.ErrorDataReceived += (sender, value) => { };
                    process.BeginOutputReadLine(); process.BeginErrorReadLine();
                    if (process.WaitForExit(10000) && process.ExitCode == 0) return "Vetro launch requested";
                    if (!process.HasExited) process.Kill();
                }
            }
            catch { }
            return "Open Vetro on the TV to finish verification";
        }

        internal Record Install(Job job)
        {
            if (!Stage.IsMatch(DirectoryPath)) throw new IOException("Invalid update directory");
            if (!Acquire(Path.Combine(DirectoryPath, "attempt-started")))
            {
                try { return JsonSerializer.Deserialize<Record>(File.ReadAllText(Path.Combine(DirectoryPath, "state.json"))); }
                catch { return new Record { phase = "already-started", submitted = null }; }
            }
            var record = new Record { revision = job == null ? null : job.revision, submitted = false, phase = "checking" };
            bool ownedLock = false;
            try
            {
                Validate(job);
                var info = Probe();
                if (info.updateLocked) throw new IOException("Another Vetro update is pending; do not submit a second install");
                if (info.authorFingerprint != job.authorFingerprint) throw new IOException("Author certificate differs from installed Vetro");
                if (Hash(Encoding.UTF8.GetBytes(info.duid.ToLowerInvariant())) != job.duidFingerprint) throw new IOException("TV identity changed since preflight");
                if (info.sourceRevision != job.previousRevision) throw new IOException("Installed Vetro changed since preflight");
                if (!Acquire(LockPath)) throw new IOException("Another Vetro update acquired the lock");
                ownedLock = true;
                File.WriteAllText(Path.Combine(LockPath, "owner"), DirectoryPath);
                record.phase = "connecting"; Save(record);
                using (var session = connect())
                {
                    // Record submission before OPEN. A missing acknowledgement must never trigger replay.
                    record.submitted = true; record.phase = "installing"; Save(record);
                    string result = session.Execute("shell:0 vd_appinstall vetrotvapp " + DirectoryPath + "/vetro.wgt", 120000);
                    record.phase = "install-returned";
                    record.output = result.Substring(Math.Max(0, result.Length - 8192));
                }
            }
            catch (Exception error)
            {
                record.phase = record.submitted == true ? "install-uncertain" : "not-submitted";
                record.error = error.Message;
                if (record.submitted != true && ownedLock) { try { Unlock(); } catch { } }
            }
            Save(record);
            if (record.submitted == true) record.launch = launch();
            record.finished = true; Save(record);
            return record;
        }

        internal object Finish(Job job)
        {
            if (!Stage.IsMatch(DirectoryPath)) throw new IOException("Invalid update directory");
            var info = ReadInstalled();
            if (job == null || info.sourceRevision != job.revision || info.launcherSha256 != job.launcherSha256)
                throw new IOException("Installed package has not been verified");
            var state = JsonSerializer.Deserialize<Record>(File.ReadAllText(Path.Combine(DirectoryPath, "state.json")));
            if (state == null || !state.finished || state.submitted != true) throw new IOException("Updater has not finished; resume verification later");
            if (Directory.Exists(LockPath)) Unlock();
            return new { verified = true, revision = job.revision };
        }
    }

    internal static class Program
    {
        public static int Main(string[] args)
        {
            try
            {
                if (args.Length != 1) throw new ArgumentException("Use probe, installed, install, or finish");
                string directory = AppContext.BaseDirectory.TrimEnd('/');
                if (!Worker.Stage.IsMatch(directory)) throw new IOException("Invalid update directory");
                var worker = new Worker(directory);
                object result;
                switch (args[0])
                {
                    case "probe": result = worker.Probe(); break;
                    case "installed": result = worker.ReadInstalled(); break;
                    case "install":
                        Thread.Sleep(3000); // Let the launching HTTP response finish before self-update.
                        result = worker.Install(JsonSerializer.Deserialize<Job>(File.ReadAllText(Path.Combine(directory, "job.json"))));
                        break;
                    case "finish": result = worker.Finish(JsonSerializer.Deserialize<Job>(File.ReadAllText(Path.Combine(directory, "job.json")))); break;
                    default: throw new ArgumentException("Use probe, installed, install, or finish");
                }
                Console.WriteLine(JsonSerializer.Serialize(result));
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        }
    }
}
