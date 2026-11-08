# Home suite updater checkpoint

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

Exact next steps:

1. Configure the intended Home setup through Vetro's Launcher: overlay on single press, Samsung Home as the Home tile destination, and Glass Home as the independent double-press destination. Keep Samsung Home available.
2. Verify single press, distinct fast double press, slow second press, held-key/repeat handling, and Home behavior while a close is already executing. The binary is installed, but none of these interactions is established by the installation report.
3. Verify the editable Home tile's destination/label, persistence after reopening, and Samsung Home fallback.
4. Check Glass installed-app choices, unpinned entries, YouTube/Prime artwork and selected/hidden-list persistence after editing the app list.
5. Check Garage native Sources opens the selected HDMI input with audio; test controls and their confirmations. Brightness remains optional.
6. Record the S95C interaction results for issue #138. The Q80A comparison and exact Samsung catalog/artwork parity remain outstanding. PR submissions and issue comments remain with the user.
