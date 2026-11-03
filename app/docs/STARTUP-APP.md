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

The controls are independent. Selecting a power-on app does not change its boot or restart flags, Samsung's Autorun settings, or the Home button. The selected app does not need its **Start at boot** switch enabled. Apps without a launcher entry and disabled apps cannot be selected.

## What to expect

Vetro waits for the TV to report that it is on, allows a short settling period, and waits for its root service before sending one foreground-launch request. A full boot can take longer because root must become available. If the TV is not ready within three minutes of the detected power-on, that attempt expires.

Once the launch request has been sent, Vetro checks the foreground app and reports whether the selected app was confirmed onscreen. It does not repeatedly bring the app back when you switch to another app or input. Restarting Vetro during the same power session does not repeat the launch.

Detection uses Samsung's local power-state API and Linux suspend/resume timing. An unavailable or unrecognized power state is reported in the app's Startup section; a connection failure alone does not trigger a launch. Firmware must provide a usable power state. A screen-off or Art Mode transition is not necessarily a standby transition.

The choice is stored on the TV. If the selected app is removed or disabled, Vetro skips it; select another app or use **Task manager → Startup → Turn off automatic foreground launch**. Turning the option off is available even when the app registry is temporarily unavailable.

## Integration

`GET /startup-app` returns `appId`, `revision`, `powerState`, `pending`, `lastResult`, and `error`. Set a choice with `POST /startup-app` and an installed app ID plus the revision returned by the last read:

```json
{"appId":"example.app","expectedRevision":0}
```

Use `null` for `appId` to turn the feature off. A stale revision is rejected. Successful writes include `verified: true` and `previousAppId`, and can be read back with GET. These endpoints use the same dashboard access rules as Vetro's other management endpoints.
