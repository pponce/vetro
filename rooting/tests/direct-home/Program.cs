using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Launcher.Core;

internal static class DirectHomeTests
{
    [DllImport("libc", SetLastError = true)] static extern int mkfifo(string path, uint mode);
    [DllImport("libc", SetLastError = true)] static extern int open(string path, int flags);
    [DllImport("libc")] static extern int close(int fd);
    [DllImport("libc")] static extern int read(int fd, byte[] bytes, int count);
    static int checks;
    static void Check(bool ok, string name) { checks++; if (!ok) throw new Exception(name); }
    static int Main()
    {
        string dir = Path.Combine(Path.GetTempPath(), "vetro-direct-home-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var frames = new List<string>();
            var route = new SamsungTvRemoteInputAgent.DirectHomeRouter();
            bool active = true, writable = true;
            Func<bool> enabled = () => active;
            Func<string, bool> deliver = line => { if (!writable) return false; frames.Add(line); return true; };
            Check(route.Decide(63, 1, false, 100, 0, enabled, deliver), "Home down consumed");
            Check(route.Decide(63, 1, false, 100, 1, enabled, deliver), "duplicate down consumed");
            Check(frames.Count == 1, "duplicate down does not toggle twice");
            active = false;
            Check(route.Decide(63, 0, false, 100, 100000, enabled, deliver), "release follows consumed down despite mode change");
            Check(!route.Decide(63, 1, false, 100, 200000, enabled, deliver), "Samsung mode passes Home");
            active = true;
            Check(!route.Decide(63, 0, false, 100, 250000, enabled, deliver), "forwarded release stays forwarded");
            Check(frames.Count == 2, "no release alone delivered");
            writable = false;
            Check(!route.Decide(63, 1, false, 101, 0, enabled, deliver), "failed down delivery passes Home");
            writable = true;
            Check(!route.Decide(63, 0, false, 101, 1, enabled, deliver), "failed down never consumes release");
            Check(route.Decide(63, 1, true, 102, 0, enabled, deliver), "explicit rule has priority");
            Check(route.Decide(63, 0, false, 102, 1, enabled, deliver), "explicit rule remains latched");
            Check(frames.Count == 2, "explicit rule does not reach launcher");

            // Actual helper frames through the native parser and gesture detector.
            route = new SamsungTvRemoteInputAgent.DirectHomeRouter(); frames.Clear();
            route.Decide(63, 1, false, 200, 0, enabled, deliver);
            route.Decide(63, 0, false, 200, 50000, enabled, deliver);
            route.Decide(63, 1, false, 200, 200000, enabled, deliver);
            route.Decide(63, 0, false, 200, 250000, enabled, deliver);
            var parser = new DirectHomeInput(); var gesture = new HomeGesture();
            byte[] batch = Encoding.ASCII.GetBytes(string.Concat(frames));
            var events = parser.Feed(batch, batch.Length);
            Check(events.Count == 4, "four physical transitions preserved");
            Check(gesture.Feed(-1, events[0].Value, events[0].Time) == HomeGestureAction.Press, "first press immediate");
            Check(gesture.Feed(-1, events[1].Value, events[1].Time) == HomeGestureAction.None, "release does not toggle");
            Check(gesture.Feed(-1, events[2].Value, events[2].Time) == HomeGestureAction.Double, "buffered fast double uses kernel clock");
            route.Decide(106, 1, false, 200, 300000, enabled, deliver);
            Check(frames[frames.Count - 1] == "reset\n", "navigation cancels double press");
            route.Decide(63, 1, false, 201, 0, enabled, deliver);
            writable = false;
            Check(route.Decide(63, 0, false, 201, 1, enabled, deliver), "lost up stays consumed");
            writable = true;
            route.Decide(63, 1, false, 202, 0, enabled, deliver);
            Check(frames[frames.Count - 1].Split(' ')[2] == "1", "lost release starts new gesture epoch");
            string invalid = "home 1 0 3 1 0\nhome 1 0 1 -1 0\nhome 1 0 1 1 1000000\n" + new string('x', 200) + "\nreset\n";
            batch = Encoding.ASCII.GetBytes(invalid);
            events = parser.Feed(batch, batch.Length);
            Check(events.Count == 1 && events[0].Reset, "invalid and oversized frames cannot launch");

            string state = Path.Combine(dir, "state.json");
            foreach (string value in new[] { "null", "[]", "{", "{}", "{\"enabled\":\"true\"}", "{\"enabled\":false}", "{\"customApp\":\"x;bad\"}" })
            { File.WriteAllText(state, value); Check(!SamsungTvRemoteInputAgent.LauncherEnabled(state), "refuse inactive/invalid state " + value); }
            File.WriteAllText(state, "{\"enabled\":true}"); Check(SamsungTvRemoteInputAgent.LauncherEnabled(state), "overlay mode accepted");
            File.WriteAllText(state, "{\"enabled\":false,\"customApp\":\"org.example.Home\"}"); Check(SamsungTvRemoteInputAgent.LauncherEnabled(state), "custom mode accepted");

            // Linux descriptor tests exercise real FIFO/no-reader/full-pipe paths.
            string pipe = Path.Combine(dir, "home.fifo"), regular = Path.Combine(dir, "regular"), link = Path.Combine(dir, "link");
            Check(mkfifo(pipe, 384) == 0, "create private FIFO");
            Check(!SamsungTvRemoteInputAgent.WriteHomeFrame(pipe, "reset\n"), "no reader returns immediately");
            File.WriteAllText(regular, "keep");
            Check(!SamsungTvRemoteInputAgent.WriteHomeFrame(regular, "reset\n"), "regular file refused");
            Check(File.ReadAllText(regular) == "keep", "regular file unchanged");
            File.CreateSymbolicLink(link, pipe);
            int fd = open(pipe, 2048);
            try
            {
                Check(fd >= 0, "reader open");
                Check(!SamsungTvRemoteInputAgent.WriteHomeFrame(link, "reset\n"), "symlink refused");
                Check(SamsungTvRemoteInputAgent.WriteHomeFrame(pipe, "reset\n"), "private FIFO accepts frame");
                byte[] bytes = new byte[96];
                Check(read(fd, bytes, bytes.Length) == 6 && Encoding.ASCII.GetString(bytes, 0, 6) == "reset\n", "exact atomic frame");
                File.SetUnixFileMode(pipe, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherWrite);
                Check(!SamsungTvRemoteInputAgent.WriteHomeFrame(pipe, "reset\n"), "public-writable pipe refused");
                File.SetUnixFileMode(pipe, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                bool full = false;
                for (int i = 0; i < 100000; i++) if (!SamsungTvRemoteInputAgent.WriteHomeFrame(pipe, "reset\n")) { full = true; break; }
                Check(full, "full FIFO fails without blocking");
            }
            finally { if (fd >= 0) close(fd); }
            Check(SamsungTvRemoteInputAgent.NoFollowFlag(Architecture.Arm) == 32768, "ARM32 nofollow ABI");
            Console.WriteLine("PASS " + checks + " direct Home checks, including real FIFO delivery and fail-open paths");
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine(e); return 1; }
        finally { Directory.Delete(dir, true); }
    }
}
