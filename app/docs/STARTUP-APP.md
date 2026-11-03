# Open an app at power-on

Choose one installed app to open onscreen when the TV starts or wakes from standby.

1. Open Vetro's dashboard and select **Task manager**.
2. Select the app's visible launcher component.
3. Under **Startup**, enable **Open onscreen at power-on**.

Only one app can have this option enabled. Selecting another app replaces the previous choice. Turn the selected app's switch off to stop automatic foreground launches. Saving a choice takes effect at the next power-on; it does not immediately open the app.

## Startup controls

| Setting | Purpose | Number of apps |
| --- | --- | --- |
| Open onscreen at power-on | Ask Vetro to bring the selected app onscreen after boot or standby wake | One |
| Start at boot | Set Tizen's startup flag for the app or component | Multiple |
| Restart automatically | Set Tizen's restart flag for the component | Multiple |

The controls are independent. Selecting a power-on app does not change its boot or restart flags, Samsung's Autorun settings, or the Home button. The selected app does not need either **Start at boot** or **Restart automatically** enabled. Those flags request process startup or restart; they do not guarantee a hidden preload or select an onscreen destination. Apps without a launcher entry and disabled apps cannot be selected.

## What to expect

Vetro requests one launch while the TV is idle and ready. A standby wake has a
twenty-second readiness window; a full boot has a ten-second window measured from
system boot. Remote monitoring can reconnect within that window. It must then be
ready for at least one second. Reconnection never extends the deadline.

While the TV is on, Vetro records recent foreground and source observations. If
the same enabled launcher app resumes automatically after standby, it can yield
to the selected startup app. This requires a recent observation before standby,
unchanged source and no observed navigation. An app first discovered after wake
is not treated as an automatic resume. Missing or stale evidence leaves it alone.

Pressing a remote button other than Power cancels that attempt. Selecting another
app, opening a menu, or changing the input cancels the attempt. Vetro also respects
its native launcher's visible dock and explicit selections. Foreground, source,
power and observed activity are checked again immediately before dispatch. Losing
monitoring while a launch is queued cancels it. Without a configured physical
remote that becomes ready before the deadline, the launch is skipped.

Remote events during a disconnected interval cannot be reconstructed. Vetro uses
the current foreground, source and known navigation as additional checks; these
do not identify every external app-to-app transition.

If root becomes available after the deadline, Vetro leaves the current screen
alone. A late service start after a full boot does not create a new deadline.
The Startup section reports a launch, an app already onscreen, or the reason the
attempt was skipped. The app's own loading and network time can still vary. This
setting does not preload apps or keep them running in the background.

Once the launch request has been sent, Vetro checks the foreground app and reports whether the selected app was confirmed onscreen. It does not repeatedly bring the app back when you switch to another app or input. Restarting Vetro during the same power session does not repeat the launch.

Detection uses Samsung's local power-state API and Linux suspend/resume timing. An unavailable or unrecognized power state is reported in the app's Startup section; a connection failure alone does not trigger a launch. Firmware must provide a usable power state. A screen-off or Art Mode transition is not necessarily a standby transition.

The choice is stored on the TV. If the selected app is removed or disabled, Vetro skips it; select another app or use **Task manager → Startup → Turn off automatic foreground launch**. Turning the option off is available even when the app registry is temporarily unavailable.

## Integration

`GET /startup-app` returns `appId`, `revision`, `powerState`, `pending`, `lastResult`,
and `error`. It also includes `lastResultAt` (Unix milliseconds),
`lastResultSession` and the currently observed `powerSession`. Session objects
contain an opaque `id`, `bootId` and `observedAt`; service restarts create a new
observation identity. `event` records the attempt kind, deadline, readiness,
phase and pre-standby app. Results belong to the session recorded with them, even
if the current power session has changed. Saving a new selection clears the
previous result. A service restart abandons a pending attempt without replaying it.

Set a choice with `POST /startup-app` and an installed app ID plus the revision returned by the last read:

```json
{"appId":"example.app","expectedRevision":0}
```

Use `null` for `appId` to turn the feature off. A stale revision is rejected. Successful writes include `verified: true` and `previousAppId`, and can be read back with GET. These endpoints use the same dashboard access rules as Vetro's other management endpoints.
