using System;
using System.IO;
using Launcher.Core;

namespace Launcher.Tests
{
    internal static class NavigationStateTests
    {
        public static void Run()
        {
            T.Run("navigation snapshots preserve the selected destination across hide", () =>
            {
                string dir = Path.Combine(Path.GetTempPath(), "vetro-navigation-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(dir);
                try
                {
                    string path = Path.Combine(dir, "navigation"); long now = 1000;
                    var state = new NavigationState(path, 42, () => now);
                    state.Publish();
                    T.True(File.ReadAllText(path).EndsWith("\t0\t0\t0\tnone\t-\t-\n"), "initial frame is not a navigation request");
                    state.SetVisible(true);
                    string[] shown = File.ReadAllText(path).TrimEnd().Split('\t');
                    T.Eq(shown[5], "1", "shown dock suppresses return");
                    now = 1200; state.SetIntent("app", "video.one"); state.SetVisible(false);
                    string[] launch = File.ReadAllText(path).TrimEnd().Split('\t');
                    T.Eq(launch[2], shown[2], "stable process incarnation");
                    T.Eq(launch[3], "2", "hide does not replace the navigation sequence");
                    T.Eq(launch[4], "1200", "hide preserves launch time");
                    T.Eq(launch[5], "0", "dock hidden after app selection");
                    T.Eq(launch[6], "app", "hide preserves app intent");
                    T.Eq(launch[7], "video.one", "destination recorded");
                    state.SetIntent("input", "org.tizen.tv-viewer", 13);
                    T.True(File.ReadAllText(path).EndsWith("\tinput\torg.tizen.tv-viewer\t13\n"), "source recorded");
                    bool rejected = false;
                    try { state.SetIntent("app", "bad\tframe"); } catch (ArgumentException) { rejected = true; }
                    T.True(rejected, "invalid ids cannot corrupt frame");
                    T.Eq(Directory.GetFiles(dir).Length, 1, "atomic writes leave only the current snapshot");
                    var next = new NavigationState(path, 43, () => now); next.Publish();
                    T.True(File.ReadAllText(path).Split('\t')[2] != shown[2], "new process has a new incarnation");
                }
                finally { Directory.Delete(dir, true); }
            });
        }
    }
}
