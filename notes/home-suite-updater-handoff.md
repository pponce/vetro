# Home suite updater checkpoint

Latest milestone: the Samsung Home launch correction is now prepared independently for stock 0.5.0 and included in enhanced build `a57bf4cf4967620f158e750b7e37f0399efc4176`. Both application branches pass CI. Use `tools/update-vetro-home-fix.py` for the Vetro-only update. See [the current fix handoff](samsung-home-fix/HANDOFF.md) for authoritative build, installer, review links and next steps; the original installation record below remains historical evidence.

Objective: install and verify the reviewed Vetro 0.5.0 enhancements plus compatible Glass Home and Garage Home, then complete interaction testing.

Repository: `pponce/vetro`, branch `tools/home-suite-updater-0.5.0`, based on combined build `eb2227342f66cb9a0eb9a855c62fe2f105619793`. Implementation is in `tools/update-home-suite.py`, with `tools/vetro_owner.py` and tests in `tools/tests/test_home_suite.py`.

Pinned application revisions:

| App | Repository | Revision | Artifact |
| --- | --- | --- | --- |
| Vetro | pponce/vetro | eb2227342f66cb9a0eb9a855c62fe2f105619793 | 13627979773 |
| Glass Home | pponce/glass-home-samsung-tv | 06621f448c956ca582abf1f5fc0b2aab6cec1ae4 | 13628544795 |
| Garage Home | pponce/garage-home | 66f6a378c60cc94dcbb1fc3c3a19fd7c4bcbdbc3 | 13628697593 |

Completed: existing CLI/certificate discovery; installed author identity checks for all three apps; exact CI and artifact checks; native launcher digest verification; preservation of client configuration and keys; preparation of all three packages before installation; clients-first installation order; durable no-repeat install ledger; installed payload checks; targeted service restarts and runtime checks; active native launcher refresh; private sanitized reports with copy commands.

Validation: 23 isolated Python tests passed locally; Python compilation passed. The first updater revision passed hosted CI run `42517990932`. The installed updater code is pinned at `19b8e99205e87ceff9201e8b0d00abd6d354d487`; its CI run `42519804246` was still in progress when this checkpoint was recorded. All three application source revisions have their earlier passing CI runs. The pinned artifact downloads, configuration preservation and installation checks have now completed on the TV.

Connection correction: the updater accepts active stock Vetro SDB access on 26201 before checking TV-Store. Vetro can own that port while TV-Store reports a bind failure. If Vetro's tunnel is available but LAN access is off, the updater directs the user to its documented Quick settings toggle. It never enables that setting automatically. Reports now retain both connection states when relevant. The same installation ledger and pinned application builds are retained. Tests cover active Vetro access, disabled access, both TV-Store response shapes, historical errors, unavailable services, and busy relay sessions.

Decisions: use existing signing identity; do not uninstall, generate certificates, create backups, cold reboot, change Developer Mode, or automatically enable any Home assignment. Use compiled CI artifacts rather than the repository's older committed native binary. Keep PR submissions and comments with the user.

Current hardware state from report `report-20261108T202317629394Z.json`: `complete: true`. Glass Home, Garage Home and enhanced Vetro all have `installedFilesVerified: true` and `runtimeVerified: true`. Vetro is running source revision `eb2227342f66cb9a0eb9a855c62fe2f105619793` with root connected. Garage's service start is confirmed; its authenticated health check returned HTTP 200, curl exit 0, and healthy true. Vetro SDB access is active. The native Home launcher was inactive (`nativeRefresh: not-active`), so these checks do not establish live native launcher behavior.

All three CLI replies raised JSONDecodeError while parsing installer output, but the independent checks verified every installed payload file and author identity, followed by runtime checks. Treat these installations as complete. Do not reinstall any of the apps solely because `cliConfirmed` is false. Improving the CLI output parser is optional tooling cleanup; it is not an installation blocker.

Garage correction: its GUI starts the controls service only on demand. The updater explicitly starts `GarageHome.Controls` before the authenticated health probe and records bounded HTTP/curl outcomes. The completed TV run confirms service readiness after this change.

Home tile investigation: after enabling the native Vetro launcher, selecting its Samsung Home tile did not open Samsung Home. Screenshots show the shared Home destination set to the Vetro overlay, the launcher running, Remapper interception off, and **Disable Samsung Home** off. That last switch means Samsung Home is enabled; leave it off. Do not add a physical Home remap. The launcher handles Home independently.

Read-only collector: `tools/diagnose-home-tile.py`, with the existing owner helper. It captures before and after a normal tile selection and a selection after waiting four seconds. Evidence includes the saved tile target, launcher state, relevant processes, native binary hash, close/launch log, and Samsung Home registry flags. It writes a private JSON report under the existing updater work directory and prints the copy command. Five diagnostic tests pass, plus all 23 updater tests. The collector has not yet run on the TV.

Hardware diagnostic `home-tile-20261108T204721588745Z.json` completed without collection errors. Both attempts dismissed the overlay and left the previous app visible. All four Home components were enabled; the service revision remained `eb2227342f66cb9a0eb9a855c62fe2f105619793`, root connected, and the native launcher hash was `7ca4230f21579020875ba677d5dfc2dc8d64d824fbaecd9e4df2354f4828793d`. The tile target was `com.samsung.tv.coba.newhome`, with `com.samsung.tv.csfs` as fallback. Remapper and double press were off.

The final recorded close completed at 12:47:31.219 before the normal selection's launch at 12:47:36.848. For the delayed selection, the final close completed at 12:48:32.874 before launch at 12:48:41.081. No additional close appears after either launch in its captured interval. Those two attempts do not show the close race. Ecore child completion was observed repeatedly on the armv7l TV. The process-list section was empty, so it cannot establish process absence.

Direct-launch report `home-launch-20261108T205309868217Z.json` establishes the failing path on this S95C: CoBA returned exit 0 and a successfully-launched PID, but Glass Home remained visible. The subsequent `com.samsung.tv.csfs` launch also returned 0 and visibly opened Samsung Home, confirmed again by the owner. All components remained enabled. This is a successful command that does not open the intended screen, so the shell's `|| csfs` fallback is never reached. No settings, registry, package, or launcher source changes were applied on the TV. All 31 updater/diagnostic tests pass locally.

Attribution verified against official `v0.5.0`, commit `81e16b164236e2fd1edae50a06d986da5e607469`: `app/service/dock-catalog.js` lines 55–73 selects CoBA based on its installed directory, and line 224 makes CoBA the tile target with csfs as fallback. `dock/src/Core/SystemLaunch.cs` is identical to the combined build and falls back only on a nonzero app_launcher exit. The combined Home enhancements inherited this path; they did not introduce it. Hardware testing used the enhanced build, not a fresh stock 0.5.0 installation, and any report must say so.

Owner decision: Samsung Home must work with its default setting. Do not add a special per-TV setting or use the editable Home tile as a workaround. The existing homeShortcut validator normalizes explicit csfs to the default, so that is not a usable configuration fix anyway. No source fix has been implemented. Prepare an upstream bug report with the two launch results and unchanged official source, then pursue an automatic fix with cross-firmware validation; do not assume reversing target order globally is proven safe by one TV. Do not reinstall the completed suite merely to establish attribution.

Exact next steps:

0. Use the confirmed CoBA no-op / csfs visible-launch evidence for an upstream default-launch bug report and an automatic correction. No special settings workaround. Preserve the other Home enhancements and validate other firmware paths before claiming a general fix. Continue interaction checks after the default Samsung Home tile works.

1. Configure the intended Home setup through Vetro's Launcher: overlay on single press, Samsung Home as the Home tile destination, and Glass Home as the independent double-press destination. Keep Samsung Home available.
2. Verify single press, distinct fast double press, slow second press, held-key/repeat handling, and Home behavior while a close is already executing. The binary is installed, but none of these interactions is established by the installation report.
3. Verify the editable Home tile's destination/label, persistence after reopening, and Samsung Home fallback.
4. Check Glass installed-app choices, unpinned entries, YouTube/Prime artwork and selected/hidden-list persistence after editing the app list.
5. Check Garage native Sources opens the selected HDMI input with audio; test controls and their confirmations. Brightness remains optional.
6. Record the S95C interaction results for issue #138. The Q80A comparison and exact Samsung catalog/artwork parity remain outstanding. PR submissions and issue comments remain with the user.
