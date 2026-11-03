using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;

namespace VetroUpdate
{
    internal interface ISdbSession : IDisposable
    {
        string Execute(string command, int timeout);
    }

    // The same CNXN/OPEN/WRTE/OKAY/CLSE protocol used by rooting/service/adb.js.
    // The production caller connects only to the TV's own loopback SDB socket.
    internal sealed class SdbSession : ISdbSession
    {
        private readonly TcpClient client;
        private readonly NetworkStream stream;
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private long deadline;
        private const uint LocalId = 12345;
        private const int MaximumPayload = 4096;

        internal SdbSession(string host, int port, int timeout)
        {
            client = new TcpClient();
            try
            {
                var connection = client.ConnectAsync(host, port);
                if (!connection.Wait(timeout)) throw new TimeoutException("Loopback SDB connection timed out");
                connection.GetAwaiter().GetResult();
                client.NoDelay = true;
                stream = client.GetStream();
                deadline = clock.ElapsedMilliseconds + timeout;
                Send("CNXN", 0x01000000, MaximumPayload, Text("host::"));
                var hello = Receive();
                if (hello.Command == "AUTH") throw new IOException("Loopback SDB requested key authentication");
                if (hello.Command != "CNXN") throw new IOException("Unexpected loopback SDB handshake");
            }
            catch { client.Dispose(); throw; }
        }

        private static byte[] Text(string value) { return Encoding.UTF8.GetBytes(value + "\0"); }

        private int Remaining()
        {
            long value = deadline - clock.ElapsedMilliseconds;
            if (value <= 0) throw new TimeoutException("Loopback SDB operation timed out");
            return (int)Math.Min(value, int.MaxValue);
        }

        private void Send(string command, uint first, uint second, byte[] payload = null)
        {
            payload = payload ?? new byte[0];
            using (var bytes = new MemoryStream())
            using (var writer = new BinaryWriter(bytes))
            {
                uint code = BitConverter.ToUInt32(Encoding.ASCII.GetBytes(command), 0);
                uint checksum = 0;
                foreach (byte value in payload) checksum += value;
                writer.Write(code); writer.Write(first); writer.Write(second);
                writer.Write((uint)payload.Length); writer.Write(checksum); writer.Write(~code);
                writer.Write(payload);
                stream.WriteTimeout = Remaining();
                byte[] packet = bytes.ToArray();
                stream.Write(packet, 0, packet.Length);
            }
        }

        private byte[] Read(int count)
        {
            byte[] result = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                stream.ReadTimeout = Remaining();
                int length = stream.Read(result, offset, count - offset);
                if (length == 0) throw new IOException("Loopback SDB closed before completion");
                offset += length;
            }
            return result;
        }

        private sealed class Packet
        {
            internal string Command;
            internal uint First, Second;
            internal byte[] Data;
        }

        private Packet Receive()
        {
            using (var reader = new BinaryReader(new MemoryStream(Read(24))))
            {
                uint code = reader.ReadUInt32();
                uint first = reader.ReadUInt32(), second = reader.ReadUInt32();
                uint length = reader.ReadUInt32(), check = reader.ReadUInt32(), magic = reader.ReadUInt32();
                if (magic != ~code || length > MaximumPayload) throw new IOException("Invalid loopback SDB frame");
                byte[] data = Read((int)length);
                uint actual = 0;
                foreach (byte value in data) actual += value;
                if (actual != check) throw new IOException("Invalid loopback SDB checksum");
                return new Packet { Command = Encoding.ASCII.GetString(BitConverter.GetBytes(code)),
                    First = first, Second = second, Data = data };
            }
        }

        public string Execute(string command, int timeout)
        {
            if (Text(command).Length > MaximumPayload) throw new ArgumentException("SDB command is too long");
            deadline = clock.ElapsedMilliseconds + timeout;
            Send("OPEN", LocalId, 0, Text(command));
            uint remote = 0;
            using (var output = new MemoryStream())
            {
                while (true)
                {
                    var packet = Receive();
                    if (packet.Second != LocalId) throw new IOException("Unexpected loopback SDB stream ID");
                    if (remote != 0 && packet.First != remote) throw new IOException("Loopback SDB remote stream changed");
                    if (packet.Command == "OKAY")
                    {
                        if (packet.First == 0) throw new IOException("Invalid loopback SDB remote stream");
                        remote = packet.First;
                    }
                    else if (packet.Command == "WRTE" && remote != 0)
                    {
                        if (output.Length + packet.Data.Length > 65536) throw new IOException("Loopback SDB output exceeded its limit");
                        output.Write(packet.Data, 0, packet.Data.Length);
                        Send("OKAY", LocalId, remote);
                    }
                    else if (packet.Command == "CLSE")
                    {
                        // A close without an OPEN acknowledgement is not a successful command.
                        if (remote == 0) throw new IOException("Loopback SDB refused the command stream");
                        // CLSE itself is the terminal acknowledgement; a failed close reply
                        // must not make the caller reissue an already completed command.
                        try { Send("CLSE", LocalId, remote); } catch (IOException) { }
                        return Encoding.UTF8.GetString(output.ToArray());
                    }
                    else throw new IOException("Unexpected loopback SDB stream packet");
                }
            }
        }

        public void Dispose() { client.Dispose(); }
    }
}
