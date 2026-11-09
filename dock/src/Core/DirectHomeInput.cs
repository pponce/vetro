using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Launcher.Core
{
    // Private FIFO frames retain the physical event's clock and helper session.
    // The public show/hide/toggle FIFO does not accept these commands.
    internal sealed class DirectHomeEvent
    {
        public int Session, Epoch, Value;
        public double Time;
        public bool Reset;
    }

    internal sealed class DirectHomeInput
    {
        private readonly StringBuilder _line = new StringBuilder();
        private bool _overflow;
        public List<DirectHomeEvent> Feed(byte[] bytes, int count)
        {
            var events = new List<DirectHomeEvent>();
            for (int i = 0; i < count; i++)
            {
                if (bytes[i] == 10)
                {
                    DirectHomeEvent e;
                    if (!_overflow && Parse(_line.ToString(), out e)) events.Add(e);
                    _line.Length = 0; _overflow = false;
                }
                else if (_line.Length == 96) _overflow = true;
                else _line.Append((char)bytes[i]);
            }
            return events;
        }

        private static bool Parse(string line, out DirectHomeEvent e)
        {
            e = null;
            if (line == "reset") { e = new DirectHomeEvent { Reset = true }; return true; }
            string[] p = line.Split(' ');
            int session, epoch, value; long seconds, micros;
            if (p.Length != 6 || p[0] != "home" ||
                !int.TryParse(p[1], NumberStyles.None, CultureInfo.InvariantCulture, out session) || session <= 0 ||
                !int.TryParse(p[2], NumberStyles.None, CultureInfo.InvariantCulture, out epoch) ||
                !int.TryParse(p[3], NumberStyles.None, CultureInfo.InvariantCulture, out value) || value > 2 ||
                !long.TryParse(p[4], NumberStyles.None, CultureInfo.InvariantCulture, out seconds) || seconds > 100000000000L ||
                !long.TryParse(p[5], NumberStyles.None, CultureInfo.InvariantCulture, out micros) || micros >= 1000000) return false;
            e = new DirectHomeEvent { Session = session, Epoch = epoch, Value = value, Time = seconds + micros / 1000000.0 };
            return true;
        }
    }
}
