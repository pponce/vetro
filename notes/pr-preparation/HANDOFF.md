# Upstream preparation checkpoint — 2026-11-05

## Objective

Prepare focused Vetro upstream contributions while preserving the working private-storage screen authentication and compatibility with current upstream owner pairing. Complete Glass Home permission acceptance and separate standby/return hardware tests. Foreground opening is standby-only; Tizen Start at boot remains independent.

## Source and TV state

- Fork `pponce/vetro` main and `combined/runtime-wrapper-observation-20261103`: `f1eeaa30165a98a27502fc3f7b51a77db5238117`. Four CI jobs passed. Neither ref was changed in this continuation.
- Upstream `andrearicci93/vetro` release-0.5.0: `87ddaa6273be4976a43885aeb763177dd453347d`; main: `52b02b4cf575aae64af149b77de400c873fc14fc`.
- TV remains on `488cdccf3f08916addf4d5f2af567eecd5c105c7`, with previously reported fast green checks and three successful immediate reopen cycles.
- Glass Home `pponce/glass-home-samsung-tv` main: `30c490194f1748d523262a1ac8985fe45f735729`.
- No new upstream PR, maintainer message, TV install or TV setting change was issued.

## Saved focused branches

| Branch in pponce/vetro | Commit | Baseline | Verification |
| --- | --- | --- | --- |
| `prep/input-lifecycle-release-20261105` | `db4205b008ada471876fac10ad2c53821cf64973` | release-0.5.0 | 83 app suites locally; full source-check CI passed: https://github.com/pponce/vetro/actions/runs/42100112380 |
| `prep/screen-quick-checks-release-20261105` | `12f48337fe31406a23735f569fab1c708dbbe27e` | release-0.5.0 | Focused suites locally; all 82 app suites and remaining source checks passed in CI: https://github.com/pponce/vetro/actions/runs/42101157088 |

Both are independent branches based on the exact release commit. The screen branch includes an implementation commit and a documentation commit; the input branch has one commit. Their source workflow runs application tests, 12 integration suites, Python parser tests and release hygiene. These are not the four-job integrated package workflow. Neither changes auth.js (blob `2fa19e5ada7487c5561b6e08cf77b2d0076502a2`), native binaries, app permissions, standby or return.

The input change includes generation checks at listener, socket, restoration, action-queue and root-command dispatch boundaries plus lifecycle stop/exit cleanup. It preserves saved mappings. The screen change adds quick/full checks, live status, initial summary recovery, service reuse and cancellable idempotent exit, retaining upstream diagnostic reasons and pairing UI.

The execution workspace became unavailable during the screen full-suite run. The candidate changes were reconstructed from the verified upstream source and recorded edits, saved through GitHub, and validated by their successful remote CI runs. Resume from the saved GitHub branches, not a partial scratch checkout.

## Combined validation branch

`prep/screen-input-stack-release-20261105` merges the two focused branches at `beb68e29d6af23acc91e2813706639965be1dea2`, preserving both parents and upstream authentication. All 84 application suites and the remaining source checks passed in https://github.com/pponce/vetro/actions/runs/42101261859 . Hardware acceptance remains open. This branch contains screen/input changes on the upstream release baseline; the full permissions integration remains on the fork main.

## Authentication decision

The user asked why the owner-session store differed, recalling that the change made pairing work. The notes distinguish two earlier changes:

- Private, atomic owner security storage originated with the app-permission design.
- The demonstrated pairing fix was moving the TV screen credential from the failing MessagePort reply path to package-private `wgt-private` storage. Subsequent fixes renewed refused credentials and restricted publishing to the HTTP listener owner.

Preserve that successful screen mechanism. Do not restore the failed MessagePort dependency or copy the combined owner-auth implementation over upstream's session store and reload-capable pairing page. See [authentication rationale](authentication-rationale.md).

## Existing Home PRs and dependencies

#113, #117, #118 and #119 remain open and were not modified. Their established branches are respectively `fix/launcher-home-toggle`, `pr/home-guard-completion`, `pr/home-shortcut-settings` and `pr/shared-home-assignment`. #119 is a draft stack. Overlapping upstream #129 and #55 are also open and address Home-guard cancellation. Keep their existing review threads; do not create duplicate PRs.

## Outstanding work and exact next steps

1. Use [TV acceptance](TV-ACCEPTANCE.md) to record a fresh Glass Home apps.list and one apps.launch with new completed permission-activity entries on the current TV. Then exercise reopen persistence, pause/resume and revoke/reapproval. No new hardware result was obtained in this continuation.
2. Review the two branch diffs and [prepared PR descriptions](PR-DESCRIPTIONS.md). Both target release-0.5.0 provisionally; the maintainer has not selected that target. The combined dependency stack is saved as `prep/screen-input-stack-release-20261105` at `beb68e29d6af23acc91e2813706639965be1dea2`; its source checks passed. Hardware testing remains separate.
3. Extract the screen-authentication prerequisite, preserving private credentials, automatic bounded 401 recovery, listener ownership and explicit compatibility for upstream owner sessions. Add tests for existing cookie/bearer sessions, pending pairing reload, hostnames, sign-out, storage failure, credential scope/rotation and bind/stop races.
4. Stack app permissions on that prerequisite. Preserve identity/signer verification, grants, bounded requests, protected-app rules and authenticated replies. Do not enable scoped app permissions while the local-app owner bypass remains.
5. Update existing Home branches only with their relevant final changes after reviewing overlap. Then prepare separate standby and return branches on the shared navigation foundation.
6. A separately requested candidate installation is needed for standby-only hardware acceptance. Test ordinary wake and cold-boot exclusion independently of native Start at boot/Autorun. Test automatic return and deliberate-navigation cancellation separately.
7. Review exact CI, hardware limitations and final diffs before submitting any upstream PR.

Original scope/dependency plan: `notes/upstream-pr-plan.md`. Public client guide: `app/docs/APP-PERMISSIONS-TEST.md`.
