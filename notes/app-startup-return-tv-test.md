# Startup and return-app TV test package

This fork build combines the startup foreground choice and the independent return destination with the previously TV-tested Home-toggle launcher. It does not include the separate, unconfirmed Home-escape build.

- Build branch: `build/app-startup-and-return`
- Startup feature: `feat/startup-foreground-app` (`335d21f5d6e1262deb00f2ece6125962d96e7313`)
- Return feature: `feat/return-to-app` (`69d44eb5ee0c8d911bb5b7aca91c29c4ddd729a8`)
- Launcher baseline: `build/launcher-home-toggle` (`9a1a6483d89650a4cc32304f04e7ada1b972429d`)
- Package: `vetro-app-startup-and-return-unsigned.wgt`

## Package and installation status

Download the `vetro-app-startup-and-return-unsigned` artifact from this branch's successful **Source checks** run. It contains the full integration widget, its SHA-256 checksum, source commit, and these instructions. This is an unsigned package: it still needs the existing Samsung Partner signing profile covering the TV before installation.

Keep the downloaded files within the existing project directory. This build does not alter certificates, Developer Mode settings, the Host PC IP, the installed TV package, or any TV configuration from CI.

Installation through the existing Vetro was previously prepared for other launcher widgets. That procedure has not been verified for updating Vetro itself, which can stop the service performing the update. Do not assume a launcher-only installer is a proven Vetro self-update procedure. TV installation and hardware verification remain pending; preserve the current Host PC IP and established signing profile.

## Test one setting at a time

Both new settings default to off. First check that the existing Home-toggle launcher still behaves as before with both off.

1. In **Task manager**, open the chosen app's visible launcher component. Enable **Open onscreen at power-on** only.
2. Turn the TV off normally with the remote, wait, then turn it on. Confirm the chosen app opens. Repeat after a full reboot.
3. Switch to other apps and inputs. Confirm the startup choice does not repeatedly pull you back. Select a second startup app and confirm only it opens on the next power-on.
4. Turn the startup choice off. Set **Return here after exiting another app** for Garage Home or another chosen app.
5. Open Netflix, then exit to Samsung Home/TV. Confirm the destination opens once. Repeat with another app.
6. Test direct app switching, HDMI changes, settings overlays, and leaving the destination for Live TV.
7. Test Home and returning to an already selected input. These can look like an app-exit fallback to this detector; record any unwanted return.
8. Replace the return destination, disable it, and confirm the original fallback behavior returns. Test a Vetro service restart without an extra return.
9. Finally enable both choices if desired; they may use the same app or different apps.

Inspect each app's Startup section for confirmation or error messages. A failed launch should not cause repeated focus changes.

## Reporting

Record the TV firmware, selected app names, whether each test passed, any unwanted returns, and the exact status message. Do not include signing secrets or raw private diagnostics in a public issue.

No upstream PR should be submitted before the user confirms the relevant TV tests. The public behavior documentation is in `app/docs/STARTUP-APP.md` and `app/docs/RETURN-APP.md`.
