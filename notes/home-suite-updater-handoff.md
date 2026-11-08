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

Validation: 16 isolated Python tests passed locally; Python compilation passed. No TV installation or live transport test was performed here. The app CI runs listed in the earlier delivery handoff passed. The public download route is documented nightly.link functionality; actual artifact delivery to Mint remains a runtime check.

Decisions: use existing signing identity; do not uninstall, generate certificates, create backups, cold reboot, change Developer Mode, or automatically enable any Home assignment. Use compiled CI artifacts rather than the repository's older committed native binary. Keep PR submissions and comments with the user.

Next steps: run the supplied pinned bootstrap from Mint while Vetro root and TV-Store's relay are ready. If the updater stops, return its JSON report; do not delete the ledger or repeat installation through another tool. After success, test single/double Home behavior, editable Home shortcut, Glass installed-app choices and hidden-list persistence, and Garage native Sources, audio and controls. These interaction tests remain pending.
