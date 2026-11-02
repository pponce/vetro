# Return to an app after exiting another app

In **Task manager**, select an app's visible launcher component and enable **Return here after exiting another app**. One app can be the return destination. Selecting another replaces it; turning it off stops automatic returns. Saving a choice does not immediately open anything.

For example, select Garage Home, open Netflix, then exit Netflix. If the TV falls back to Samsung Home or its TV viewer, Vetro requests Garage Home once. The destination can be any installed, enabled app with a launcher entry.

The return choice is independent of **Open onscreen at power-on**, **Start at boot**, and **Restart automatically**. You can use the same app for startup and return, choose different apps, or leave either feature off. Both foreground settings are off until you select an app.

## Detection and limits

Vetro observes the TV's foreground app and source while the TV reports that it is on. It waits for another launcher app to fall back to Samsung Home or TV, allows a short settling period, and checks the current state again immediately before launching the destination. Switching to another app, a changed source, or a foreground overlay cancels that return. Leaving the destination itself for TV or an input does not trigger a return.

This detects a fallback transition, not a universal Exit-button event or proof that the app process terminated. A Home action that produces the same transition can also qualify. A deliberate return to the already selected TV input may be indistinguishable from exiting an app. Apps that return somewhere else may not qualify. These behaviors must be checked on the target TV and apps before relying on the setting.

There is no repeating foreground enforcement. A request is verified against the reported foreground state, with no repeated launch if confirmation fails. Vetro does not kill Samsung Home, intercept remote keys, or change their mappings for this feature. Standby, unknown state, service reconnection, suspend/resume, and a pending power-on launch reset the exit observation rather than causing a return.

If the selected app is missing or disabled, the request is skipped. Use **Task manager → Startup → Turn off automatic app return** to clear a choice, including one for an uninstalled app. Turning it off remains available without a working app inventory.

## API

`GET /return-app` returns `appId`, `revision`, `pending`, `lastResult`, and `error`. Set one choice using `POST /return-app` with an installed app ID and the revision returned by GET:

```json
{"appId":"example.app","expectedRevision":0}
```

Use `null` for `appId` to turn it off. Stale revisions are rejected. Successful writes return `verified: true` and `previousAppId`; GET reads the current choice back. Settings persist across service restarts. Exit observations do not, so a restart does not replay an old return.
