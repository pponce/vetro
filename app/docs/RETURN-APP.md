# Return to an app after exiting another app

In **Task manager**, select an app's visible launcher component and enable **Return here after exiting another app**. One app can be the return destination. Selecting another replaces it; turning it off stops automatic returns. Saving a choice does not immediately open anything.

For example, select Garage Home, open Netflix, then exit Netflix. If the TV falls back to Samsung Home or its TV viewer, Vetro requests Garage Home once. The destination can be any installed, enabled app with a launcher entry.

The return choice is independent of **Open onscreen at power-on**, **Start at boot**, and **Restart automatically**. You can use the same app for startup and return, choose different apps, or leave either feature off. Both foreground settings are off until you select an app.

## Detection and limits

Vetro observes the TV's foreground app and source while the TV reports that it is on. It waits for another launcher app to fall back to Samsung Home or TV, allows a short settling period, and checks the current state again immediately before launching the destination. Switching to another app, a changed source, or a foreground overlay cancels that return. Leaving the destination itself for TV or an input does not trigger a return.

Normal checks are scheduled one second apart after each check completes. A possible exit is rechecked after 300 milliseconds instead of waiting for the next normal check. Back and Exit events that Vetro already observes temporarily bring checks forward to 150 milliseconds for two seconds, without grabbing additional keys. TV status reads, command processing and the destination app's own startup add to this timing. Vetro records intentional app, Home and input choices before dispatching its own requests, including physical shortcuts, dashboard/API requests, MQTT actions and native launcher tiles. These cancel a pending return. While the native dock is visible, automatic return waits. A known app launch is protected until the destination is observed or 30 seconds elapse; timeout discards the old exit rather than requesting a return. These are transient observations, not additional saved settings.

An external launcher such as Glass Home can use the existing `POST /apps/launch` API (`{"appId":"example.app"}`) for ordinary app launches to receive the same coordination. There is no new integration endpoint or requirement for external launchers to participate. Native deep links, URLs and launches made by other apps remain unannounced. The 300 ms check can reject quick unannounced transitions, but a slower app-to-browser transition that still reports Home or TV can still be mistaken for an exit.

This detects a fallback transition, not a universal Exit-button event or proof that the app process terminated. An unobserved Home or input action that produces the same transition can still qualify. Explicit choices handled by Vetro are suppressed as described above. Apps that return somewhere else may not qualify. These behaviors must be checked on the target TV and apps before relying on the setting.

There is no repeating foreground enforcement. A request is verified against the reported foreground state, with no repeated launch if confirmation fails. Vetro does not kill Samsung Home, intercept remote keys, or change their mappings for this feature. Standby, unknown state, service reconnection, suspend/resume, and a pending power-on launch reset the exit observation rather than causing a return.

If the selected app is missing or disabled, the request is skipped. Use **Task manager → Startup → Turn off automatic app return** to clear a choice, including one for an uninstalled app. Turning it off remains available without a working app inventory.

## API

`GET /return-app` returns `appId`, `revision`, `pending`, `lastResult`, `error`, and transient `navigation` intent (or `null`). Set one choice using `POST /return-app` with an installed app ID and the revision returned by GET:

```json
{"appId":"example.app","expectedRevision":0}
```

Use `null` for `appId` to turn it off. Stale revisions are rejected. Successful writes return `verified: true` and `previousAppId`; GET reads the current choice back. Settings persist across service restarts. Exit observations do not, so a restart does not replay an old return.
