# Upstream preparation checkpoint — 2026-11-05

## Objective

Prepare focused Vetro upstream contributions while preserving the working private-storage screen authentication and compatibility with current upstream owner pairing. Complete Glass Home permission acceptance and separate standby/return hardware tests. Foreground opening is standby-only; Tizen Start at boot remains independent.

## Source and TV state

- Fork `pponce/vetro` main and `combined/runtime-wrapper-observation-20261103`: `f1eeaa30165a98a27502fc3f7b51a77db5238117`. Four CI jobs passed. Neither ref was changed in this continuation.
- Upstream `andrearicci93/vetro` release-0.5.0: `87ddaa6273be4976a43885aeb763177dd453347d`; main: `52b02b4cf575aae64af149b77de400c873fc14fc`.
- TV service and authenticated screen are verified at `f1eeaa30165a98a27502fc3f7b51a77db5238117` by `connection-report-20261105-124305-997919.json`; service sourceDirty=false. All quick checks finished. Saved remote filtering and Home readiness were restored automatically, with no resume request. The user reports all green checks and retained Glass Home app-list access. The preceding baseline was `488cdccf3f08916addf4d5f2af567eecd5c105c7`.
- Glass Home `pponce/glass-home-samsung-tv` main: `30c490194f1748d523262a1ac8985fe45f735729`.
- No new upstream PR or maintainer message was issued. The user ran the prepared TV update, and the uploaded report verifies it; no direct TV operation was issued from this preparation environment.

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

## Latest hardware acceptance

The user confirmed fresh Glass Home app-list and launch activity on 2026-11-05: five completed apps.list entries between 12:18:17 PM and 12:18:22 PM, and apps.launch completed at 12:18:47 PM (reported local time). The launched app appeared on the TV. Mark both positive permission paths passed. The subsequent paused refresh failed visibly in Glass Home and produced no new Recent activity. After resuming, the user confirmed that Glass Home regained access and activity appeared again. Mark pause/resume passed. The user subsequently revoked access; Glass Home recognized the loss, offered Connect to Vetro, generated a new request in Vetro and regained access after owner approval. Mark the observed revoke/reapproval flow passed. The user then closed/reopened Glass Home and confirmed that refreshing worked; mark client reopen access passed. These checks preceded the integrated update. Post-update evidence and remaining controls are in [TV acceptance](TV-ACCEPTANCE.md).

The uploaded update report verifies clean f1eeaa3 service and matching authenticated screen, completed quick checks, private-storage authentication and preserved signing identity. Its earlier screen sample has input connected=false, while the final handoff has mode=filter, connected=true, savedEnabled=true and homeReady=true; verified=true, oldFilterExited=true and resumeRequested=false. This supports the reported brief red-to-green recovery without manual intervention. The user also confirmed Glass Home retained app-list access after the update. No post-update activity rows or app-launch result were supplied. Full TV restart remains open. Subsequent standby and automatic-return results are recorded below. The CLI lacked structured install confirmation, but the live revisions verify installation; do not reinstall for that warning.

Normal standby wake now passes on f1eeaa3. Report `after-power-on-20261105-125531-406204-2288598.json` identifies a wake with Netflix as the resumed app, an explicit Vetro launch of GlassHome1.GlassHome and App confirmed onscreen for the same current power session. A native foreground read also shows Glass Home, while root/input/Home readiness remain healthy. Automatic return was disabled, so this specifically validates startup behavior. The user observed under five seconds; separately, service timestamps show dispatch 5.649 seconds after observed wake and confirmation at 6.962 seconds. Do not present those as an automated under-five-second guarantee.

The user reports a successful Glass Home → Apple TV → exit → Glass Home sequence. Report `after-power-on-20261105-130636-396569-2296124.json` records Return app confirmed onscreen at 1:04:55.666 PM America/Los_Angeles, with Glass Home foreground when captured at 1:06:34–1:06:36 PM. The return target is GlassHome1.GlassHome, revision 9; source is still clean f1eeaa3 and root/input/Home are ready. This supports the positive return path.

A second reported route through Samsung Home and then the app did not return to Glass Home. "Apple Home" is interpreted as Apple TV pending clarification. Its failed transition is not captured: the uploaded report's return confirmation is 99.198 seconds old and foreground is Glass Home. The user subsequently repeated this route and confirmed that Glass Home returned. They explicitly did not run the last capture script, so the repeat is a user-observed pass without a new report. Retain the first missed return as unexplained; the successful repeat does not prove a timing cause or a code fix. Explicit Home cancels the current pending return, but another observed ordinary app can establish a later return. No runtime change has been made.

## Verified integrated update

The requested update used [run-integrated-update.sh](run-integrated-update.sh), with checksum-pinned helpers from f1eeaa30165a98a27502fc3f7b51a77db5238117 and expected baseline 488cdccf3f08916addf4d5f2af567eecd5c105c7. Diagnostic CI run 42096796688 passed all four jobs. The existing 22 updater, input-handoff and owner-client tests passed locally; wrapper syntax, pins and checksums were verified.

The report `connection-report-20261105-124305-997919.json` establishes the completed update. It was captured at 2026-11-05T20:43:32.928626Z after 9.1 seconds of observation, not total installation time. The collector's unauthenticated status response and incomplete MessagePort matrix do not contradict authenticated private-storage screen access. The saved input handoff independently verifies maintenance owner access and remote restoration.

Next check deliberate Home navigation from another ordinary app: open an app from Glass Home, choose Samsung Home through the Vetro launcher and leave the TV idle for 20 seconds. Samsung Home should remain visible. No new capture is required just to record the successful alternate-route repeat. If a missed return recurs, capture the failed screen before navigating away using the existing read-only `tools/capture-power-on.py` from `vetro-recovery-f1eeaa30165a`. Obtain fresh permission activity separately.

## Outstanding work and exact next steps

1. The integrated update, screen authentication and automatic input restoration are verified. Glass Home app-list access survived the update/service restart, as reported by the user. One normal standby/wake test has passed with an explicit Vetro launch and current-session foreground confirmation. Automatic return has now been observed from both Glass Home and Samsung Home launch routes; the latter passed on repeat without a new capture. Keep its initial miss recorded as unexplained. Next check deliberate Home cancellation and obtain post-update permission app-launch evidence. See [TV acceptance](TV-ACCEPTANCE.md).
2. Review the two branch diffs and [prepared PR descriptions](PR-DESCRIPTIONS.md). Both target release-0.5.0 provisionally; the maintainer has not selected that target. The combined dependency stack is saved as `prep/screen-input-stack-release-20261105` at `beb68e29d6af23acc91e2813706639965be1dea2`; its source checks passed. Hardware testing remains separate.
3. Extract the screen-authentication prerequisite, preserving private credentials, automatic bounded 401 recovery, listener ownership and explicit compatibility for upstream owner sessions. Add tests for existing cookie/bearer sessions, pending pairing reload, hostnames, sign-out, storage failure, credential scope/rotation and bind/stop races.
4. Stack app permissions on that prerequisite. Preserve identity/signer verification, grants, bounded requests, protected-app rules and authenticated replies. Do not enable scoped app permissions while the local-app owner bypass remains.
5. Update existing Home branches only with their relevant final changes after reviewing overlap. Then prepare separate standby and return branches on the shared navigation foundation.
6. Normal standby wake passes. Complete startup remote-action cancellation, expiry and cold-boot exclusion independently of native Start at boot/Autorun. Both automatic-return launch routes have successful observations. Keep the initial alternate-route miss open as an unexplained intermittent observation and complete deliberate-navigation cancellation checks separately.
7. Review exact CI, hardware limitations and final diffs before submitting any upstream PR.

Original scope/dependency plan: `notes/upstream-pr-plan.md`. Public client guide: `app/docs/APP-PERMISSIONS-TEST.md`.
