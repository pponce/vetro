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

Installation report `report-20261108T211324503481Z.json` now confirms completion on the TV: enhanced revision `a57bf4cf4967620f158e750b7e37f0399efc4176`, installed files verified, runtime verified, and active native launcher refresh verified. Vetro SDB access remained active. The CLI output parser recorded JSONDecodeError, but independent payload and runtime verification succeeded; do not reinstall because of that parser result. Visual acceptance of the Samsung Home tile is still pending. The owner explicitly wants to test the enhanced build before submitting the PR and issue.

Prefilled PR and issue text and URLs are in this folder. Submit the PR first. Until a PR number exists, the issue's PR link searches the exact author and unique branch; it will find the submitted PR. No PR or issue has been posted by the assistant.

## Exact next steps

1. Ask for the visible result of selecting the default Samsung Home tile from Glass Home and another app, including quick selection and repeated reopen. The updated build is already installed and running; no Home override should be needed.
2. Confirm the other enhanced Home interactions remain intact. Keep the separate PR #117 in-flight-close scope distinct from this launch fix.
3. After the owner confirms the fixed tile works, update the PR/issue validation paragraph and prefilled links with the actual S95C result, then return them for submission. Cross-generation TV behavior remains unverified; request the maintainer's comparison.

## Working environment

Local repo history is a reconstruction and must not be pushed. Remote commits are authoritative. Use remote base trees and expected-SHA ref updates. Tools and working notes are on `tools/home-suite-updater-0.5.0`; the stock fix and enhanced application branches contain only their intended source changes.

