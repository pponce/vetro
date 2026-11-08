# Samsung Home launch fix checkpoint

## Objective and evidence

Make the default Samsung Home tile work automatically on the S95C, prepare an isolated stock-0.5.0-compatible PR and issue, and update the enhanced build with a Vetro-only installer. No special setting or live file patch.

Reports `home-tile-20261108T204721588745Z.json` and `home-launch-20261108T205309868217Z.json` show the overlay closing while the previous app remains visible. All Home components were enabled. CoBA's standard launch returned zero without showing Home; the subsequent csfs launch returned zero and visibly opened Samsung Home. The close guard had completed before either tile request. Hardware evidence uses enhanced revision `eb2227342f66cb9a0eb9a855c62fe2f105619793`.

Official v0.5.0 commit `81e16b164236e2fd1edae50a06d986da5e607469` has the same CoBA directory detection and identical SystemLaunch helper. Upstream commit `9010571ee17b7a2690986f935d8fec8d84a3f9f6` records that other firmware needs CoBA first, so the correction preserves that order.

## Code and build

- Stock PR branch: `pponce/vetro:fix/samsung-home-csfs-handoff`, commit `cba08242c1a552b21f3b6e41881a95c7697cf48b`, based on upstream main `180d9845f1b2a3769c8e4775620757f8f1092c4a` (v0.5.0 plus its subsequent YouTube change). Only SystemLaunch.cs and LauncherRegressionTests.cs differ.
- Enhanced branch: `pponce/vetro:combined/home-enhancements-0.5.0`, commit `a57bf4cf4967620f158e750b7e37f0399efc4176`, parent `eb2227342f66cb9a0eb9a855c62fe2f105619793`. Same two-file change; all enhanced features retained.
- Behavior: for the exact CoBA primary / csfs fallback pair, run CoBA and then csfs regardless of CoBA's exit code. Keep ordinary app fallback conditional. No extra sleeps, processes to kill, settings or firmware model overrides.
- Stock CI: https://github.com/pponce/vetro/actions/runs/42523197467 — passed.
- Enhanced CI: https://github.com/pponce/vetro/actions/runs/42523234818 — passed, including real Ecore tests, TV compilation, integration packaging and checksums.
- Enhanced artifact: https://github.com/pponce/vetro/actions/runs/42523234818/artifacts/13634208090
- Artifact SHA-256: `372f4130a360c226c8dd0b3a8e69e955f48fa4918b90133341073034dfaf3bd1`.

## Installer and delivery

`tools/update-vetro-home-fix.py` reuses `tools/update-home-suite.py` and `tools/vetro_owner.py`, pins only the new Vetro artifact, and uses `vetro-install/vetro-home-fix-20261108-r1` as a separate ledger. Owner pairing is reused from the existing maintenance location. Glass Home and Garage Home are not prepared, installed or restarted. Existing certificate and package identity are checked. Installed payloads, source revision, root reconnection and active launcher refresh are verified. Reruns never repeat a recorded installation attempt.

All 33 local Python tests pass, including the Vetro-only execution scope and preservation of the prior ledger/pairing location. Python compilation and whitespace checks pass.

Installation report `report-20261108T211324503481Z.json` confirms completion on the TV: enhanced revision `a57bf4cf4967620f158e750b7e37f0399efc4176`, installed files verified, runtime verified, and active native launcher refresh verified. Vetro SDB access remained active. The CLI output parser recorded JSONDecodeError, but independent payload and runtime verification succeeded; do not reinstall because of that parser result.

On 2026-11-08 the owner confirmed that the Samsung Home tile in the launcher now works and requested the prefilled PR and issue for submission. This establishes visible success on the S95C with the enhanced fixed build. It does not establish repeated/cold-boot tests, success from two specific source apps, fresh stock-build installation, or other TV generations. Both drafts and prefilled URLs now include the confirmed result with those testing boundaries.

Prefilled PR and issue text and URLs are in this folder. Submit the PR first. Until a PR number exists, the issue's PR link searches the exact author and unique branch; it will find the submitted PR. No PR or issue has been posted by the assistant.

## Exact next steps

1. Submit the prepared standalone PR and issue; the owner requested prefilled links, so publication remains with them. Once a PR number is available, the issue's branch-specific PR lookup can be replaced with its direct URL.
2. Request the maintainer's comparison on other Home generations. Keep the separate PR #117 in-flight-close scope distinct from this launch fix.
3. Continue the remaining enhanced Home, Glass Home and Garage Home acceptance checks from the overall plan. Do not repeat the verified installation.

## Working environment

Local repo history is a reconstruction and must not be pushed. Remote commits are authoritative. Use remote base trees and expected-SHA ref updates. Tools and working notes are on `tools/home-suite-updater-0.5.0`; the stock fix and enhanced application branches contain only their intended source changes.

