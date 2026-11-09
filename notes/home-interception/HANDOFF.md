# Direct Home restoration checkpoint — 2026-11-09

Objective: restore immediate physical Home delivery in the enhanced 0.5.0 build, preserve optional fast double press and the working Samsung Home tile, and accurately describe the six open Home PRs. Coordinate overlapping interception work with upstream #30.

Repository: `pponce/vetro`. Enhanced branch `combined/home-enhancements-0.5.0`; implementation branch `fix/direct-home-0.5.0-integration`. Both point to `a5055f2216ba3dbdcef2b089c9bc4e04b337a089`, parent `a57bf4cf4967620f158e750b7e37f0399efc4176`. Source CI run `42537866728` passed every job. Unsigned artifact `13639913528`, SHA-256 `93df73f413cc837033429738e7ff982fc823dd7af2eedafe20e949118783d84e`, expires 2026-12-09. The installer checks these identities before installation.

Tooling and review documents live on `tools/home-suite-updater-0.5.0`. Installer source is pinned at `25586a48e5c52fa3bdac3ada4befc5dbd554b848`. Use `tools/update-vetro-direct-home.py` with `tools/update-home-suite.py` and `tools/vetro_owner.py`, following [the complete block](INSTALL.md). The installer has a distinct `vetro-direct-home-20261109-r1` ledger, reuses owner pairing, updates only Vetro, and reports direct-input readiness without selecting a remote or changing an explicitly disabled preference. All 38 Python updater/diagnostic tests passed locally.

Completed implementation:
- Remote-input helper consumes physical Home only after successful bounded delivery to the active launcher's private FIFO. It preserves the consume/forward choice through the held key, validates the FIFO descriptor and state, and normally forwards Home when initial delivery is unavailable.
- Native launcher accepts press/release/repeat timestamps, helper session identity, and gesture reset messages. Direct events use the existing double-press handler without starting the Samsung Home close guard. The native listener remains as fallback.
- Saved interception can start with no other physical shortcuts when Vetro/custom Home is configured. Explicit interception off and temporary listening mode remain respected.
- CI compiles and packages both native components. Tests cover routing, delivery failure, real FIFO behavior, gestures, saved-input lifecycle, native launcher and Ecore process completion. Full source CI passed.
- Complete replacement descriptions for #113, #117, #118, #119, #167 and #169, plus a suggested #30 comment, are in this folder. Nothing was posted to another person's PR or fork.

Attribution and decisions:
- Official v0.5.0 uses the native observe-then-close path, so the code path that allows Samsung Home to appear is upstream. This was established by source comparison, not a fresh isolated stock hardware test.
- The 0.5.0 integration lost the earlier enhanced direct Home behavior. The later Home tile correction in #169 did not introduce that loss.
- #30 uses the same basic interception approach but writes a plain toggle to the existing launcher FIFO. This integration uses a separate timestamped event FIFO for #167 compatibility, custom launchers, and the shared assignment. FIFO validation and press-latching work were informed by #30; this is not an unchanged cherry-pick.
- Keep basic interception coordination under #30. Ask whether the maintainer prefers that PR first plus follow-ups, or a focused contribution to the author's branch. Do not send the entire combined branch as a patch to #30; it depends on other enhanced features.
- Samsung TV Plus takeover after TV-store exit and standby wake remains unresolved. Do not claim this Home change fixes it or automatically change TV startup settings.

Current hardware evidence: the last verified installed build is `a57bf4cf`, with the Samsung Home tile confirmed working. The new direct-input build has not been installed or visually tested. Earlier configuration evidence showed interception off; the installer reports the current state. The physical remote must be selected and interception enabled for direct delivery. No separate Home shortcut rule is needed.

Exact next steps:
1. Run the pinned Vetro-only installer on the existing project host with TV awake and existing SDB access available. Return its sanitized report using the printed rsync command. Do not repeat an unverified install manually.
2. If input readiness is false, use Launcher and Remapper to select the intended Home mode and physical remote, and enable interception. Rerun the same installer to verify the recorded installation and readiness; it does not reinstall a recorded attempt.
3. Test physical Home from Apple TV, immediate first press, distinct fast double press, slower second press, held-key handling, and the Samsung Home tile. Record visible Samsung Home flash and any TV Plus takeover separately.
4. Update only the corresponding PR's hardware claims after evidence is available. Copy the prepared descriptions manually; #119 must not claim direct interception in its current independent branch.
5. Post the suggested #30 coordination comment when ready. Prepare a minimal code contribution only after the author/maintainer agrees on the base and scope.

Local source snapshot warning: the recovered workspace has synthetic git history and unrelated pre-existing changes. Do not push local HEAD or indiscriminately stage the worktree. Remote commits were created from verified authoritative GitHub trees with expected-head branch updates. No backups or TV-side ad hoc patches were created.
