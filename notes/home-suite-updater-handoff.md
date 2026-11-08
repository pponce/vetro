# Home suite updater checkpoint

Objective: deliver one Mint update script for the reviewed Vetro 0.5.0 enhancements plus compatible Glass Home and Garage Home.

Repository: `pponce/vetro`, branch `tools/home-suite-updater-0.5.0`, based on combined build `eb2227342f66cb9a0eb9a855c62fe2f105619793`. Implementation is in `tools/update-home-suite.py`, with `tools/vetro_owner.py` and tests in `tools/tests/test_home_suite.py`.

Pinned application revisions:

| App | Repository | Revision | Artifact |
| --- | --- | --- | --- |
| Vetro | pponce/vetro | eb2227342f66cb9a0eb9a855c62fe2f105619793 | 13627979773 |
| Glass Home | pponce/glass-home-samsung-tv | 06621f448c956ca582abf1f5fc0b2aab6cec1ae4 | 13628544795 |
| Garage Home | pponce/garage-home | 66f6a378c60cc94dcbb1fc3c3a19fd7c4bcbdbc3 | 13628697593 |

Completed: existing CLI/certificate discovery; installed author identity checks for all three apps; exact CI and artifact checks; native launcher digest verification; preservation of client configuration and keys; preparation of all three packages before installation; clients-first installation order; durable no-repeat install ledger; installed payload checks; targeted service restarts and runtime checks; active native launcher refresh; private sanitized reports with copy commands.

Validation: 21 isolated Python tests passed locally; Python compilation passed. The first updater revision passed hosted CI run `42517990932`. No TV installation was submitted: the original report and its retry both stopped at the TV-Store relay prerequisite, after successful owner/root access. The public download route is documented nightly.link functionality; actual artifact delivery to Mint remains a runtime check.

Connection correction: the updater accepts active stock Vetro SDB access on 26201 before checking TV-Store. Vetro can own that port while TV-Store reports a bind failure. If Vetro's tunnel is available but LAN access is off, the updater directs the user to its documented Quick settings toggle. It never enables that setting automatically. Reports now retain both connection states when relevant. The same installation ledger and pinned application builds are retained. Tests cover active Vetro access, disabled access, both TV-Store response shapes, historical errors, unavailable services, and busy relay sessions.

Decisions: use existing signing identity; do not uninstall, generate certificates, create backups, cold reboot, change Developer Mode, or automatically enable any Home assignment. Use compiled CI artifacts rather than the repository's older committed native binary. Keep PR submissions and comments with the user.

Current state: the user confirms Vetro's SDB setting is already enabled and the Vetro screen is open. Leave that setting enabled and use the corrected updater; no TV-Store relay change is needed when Vetro reports active SDB access.

Next steps: run the corrected pinned bootstrap from Mint. If the updater stops, return its JSON report; do not delete the ledger or repeat installation through another tool. After success, test single/double Home behavior, editable Home shortcut, Glass installed-app choices and hidden-list persistence, and Garage native Sources, audio and controls. These interaction tests remain pending.
