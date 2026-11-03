using System;
using System.Globalization;
using System.IO;

namespace Launcher.Core
{
    // One atomic snapshot, published before a deliberate navigation request.
    // The service reads it only while this resident launcher's pid is alive.
    public sealed class NavigationState
    {
        private readonly string _path, _instance = Guid.NewGuid().ToString("N");
        private readonly int _pid;
        private readonly Func<long> _now;
        private long _sequence, _at;
        private bool _visible;
        private string _kind = "none", _appId = "-", _source = "-";
        public NavigationState(string path, int pid, Func<long> now)
        { _path = path; _pid = pid; _now = now; }
        public void SetVisible(bool visible)
        {
            _visible = visible;
            if (visible) SetIntent("launcher"); else Publish();
        }
        public void SetIntent(string kind, string appId = null, int source = -1)
        {
            if (kind != "app" && kind != "home" && kind != "input" && kind != "launcher" && kind != "system")
                throw new ArgumentException("Invalid navigation kind");
            if (appId != null && !Catalog.ValidAppId(appId)) throw new ArgumentException("Invalid app id");
            _kind = kind; _appId = appId ?? "-"; _source = source < 0 ? "-" : source.ToString(CultureInfo.InvariantCulture);
            _sequence++; _at = _now(); Publish();
        }
        public void Publish()
        {
            string temporary = _path + "." + _instance + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream))
                    writer.Write("VETRO_NAV_V1\t" + _pid + "\t" + _instance + "\t" + _sequence + "\t" + _at + "\t" +
                        (_visible ? "1" : "0") + "\t" + _kind + "\t" + _appId + "\t" + _source + "\n");
                File.Move(temporary, _path, true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
}
