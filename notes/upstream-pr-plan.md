# Vetro upstream contribution plan — 2026-11-05

## Current checkpoint — maintainer discussion first

The integration is published: fork main, combined/runtime-wrapper-observation-20261103 and the TV are at f1eeaa30165a98a27502fc3f7b51a77db5238117; all four CI jobs passed. Permission list/launch, pause/resume, revoke/reapproval and reopen tests passed. The update restored remote input, preserved Glass Home app-list access, and was followed by successful standby opening, navigation cancellation and return observations. Cold-boot nonlaunch was already tested by the user; do not request a repeat. One missed return remains unexplained, and broader hardware acceptance is still limited.

Focused screen/input branches and their combined stack are prepared against release-0.5.0 with passing source checks and unchanged upstream authentication. The user now prefers a maintainer issue to agree on scope, target and PR sequence. See [the issue draft](pr-preparation/MAINTAINER-ISSUE.md), [current handoff](pr-preparation/HANDOFF.md) and [acceptance record](pr-preparation/TV-ACCEPTANCE.md). No issue or new upstream PR has been submitted. The original planning snapshot below is retained for provenance; the checkpoint documents supersede its installation/testing status and immediate next steps.

## Objective and source baseline

Publish the complete integrated work in the fork's `main`, then submit focused upstream changes with explicit dependencies and a reproducible Glass Home test. The foreground power-on choice is standby-only: it must never launch on cold boot, even if root is immediately available. The independent Tizen **Start at boot** flag is unchanged.

Sources checked for this plan:

- Fork `pponce/vetro`: previous `main` `4bbf073abc523fe75bf2a6032685678a69d52a31`.
- Runtime branch `combined/runtime-wrapper-observation-20261103`: `488cdccf3f08916addf4d5f2af567eecd5c105c7`.
- Host tools branch `combined/runtime-wrapper-inspection-20261103`: `ba75a35ea7350c85894832c61094ec6f47551755`.
- Upstream `andrearicci93/vetro` main: `52b02b4cf575aae64af149b77de400c873fc14fc`.
- Upstream `release-0.5.0`: `87ddaa6273be4976a43885aeb763177dd453347d`.
- Glass Home `pponce/glass-home-samsung-tv` main: `30c490194f1748d523262a1ac8985fe45f735729`.

The integration uses runtime code as the base, adds the host branch's 32 otherwise missing tool/test/note files, and resolves four note-only conflicts to the later host checkpoints. It retains both parents. The new standby-only behavior, tests, public descriptions and this plan are added on top. No new upstream feature is imported into the tested runtime as part of publishing the fork.

## Recommended review order

Do not send the entire combined branch as one upstream PR. Its history includes experiments, diagnostic collectors, generated binaries, installer work and several independent features. Prepare clean branches from the maintainer's selected integration target and transplant final changes by scope. Run the complete test suite on each branch and its dependency stack.

The active release branch already contains owner pairing and newer diagnostics. Use it as the provisional baseline for new screen/auth/API branches; confirm the target before publishing. Do not copy our full `auth.js`, dashboard or screen over that branch. Preserve upstream pairing/session behavior and port the required differences with compatibility tests. Existing PRs still target main and should retain their established review threads unless the maintainer requests otherwise.

| Order | PR / working title | Scope and dependencies |
| --- | --- | --- |
| Existing | [#113 Home short press](https://github.com/andrearicci93/vetro/pull/113), [#117 pending Home guard](https://github.com/andrearicci93/vetro/pull/117), [#118 custom Home tile](https://github.com/andrearicci93/vetro/pull/118), [#119 shared Home assignment](https://github.com/andrearicci93/vetro/pull/119) | Update these branches, not duplicate PRs. Keep guard/Ecore command ownership with #117; Home shortcut validation/label behavior with #118; direct root control, one physical Home owner and remapper save/edit behavior with #119. Shared native files may require a dependency stack. Check overlapping #129 and #55 before carrying duplicate fixes. |
| 1 | **Show TV status and pairing before optional full diagnostics** | Five quick probes on opening; app/package inventory only on explicit OK. Include live status refresh, first-failure recovery where independent, running-service reuse and idempotent screen exit. Port onto release diagnostics, retaining model/version and useful timeout reporting from #106/#107/#88. Security-specific credential renewal belongs to order 3. |
| 2 | **Release remote input on service stop and ignore cancelled helper callbacks** | Focused `physical-input.js`/lifecycle cleanup and tests. Preserve saved mappings and verify no exclusive grab survives a stop. Generic input cleanup can be independent; bind-owner gating is part of order 3. Establish which parts are still missing in the chosen upstream baseline. |
| 3 | **Authenticate the TV screen with a scoped private credential** | Adapt existing upstream owner pairing rather than resubmitting #9. Remove the third-party loopback/opaque-origin owner bypass; scoped screen-only access, private-storage bootstrap/rotation, automatic 401 recovery and single HTTP-listener ownership. Include native service lifecycle and stop/bind-race tests. Preserve upstream owner sessions or provide an explicit tested migration; never silently replace its store format. |
| 4 | **Add owner-approved permissions for installed TV apps** | Stack on order 3. Submit identity and signer checks, bounded grant/request store, protected-app policy, native MessagePort requests, authenticated replies, SDK, owner UI, compact details and all security/browser tests as a coherent feature. Include public API docs and the Glass Home test guide. Integration with return coordination can follow in order 6. |
| 5 | **Open one selected app after standby wake** | `startup-app.js`, power-state detection, bounded eligibility/dispatch queue guards, dashboard controls and tests/docs. Explicit cold-boot exclusion. Preserve independent boot/restart flags. Shared Home/navigation hooks depend on #119; do not import return behavior just to deliver this option. |
| 6 | **Return to a chosen app after another app exits** | `return-app.js`, navigation coordinator and native launcher cooperation. Respect explicit Home, app, input and menu navigation; include coordination with scoped app launches when order 4 is present. Requires the shared navigation/Home foundation. Keep separate from standby opening. |
| Optional | **Provide a verified combined update and diagnostics toolchain** | Installer, signing preflight, SDB/.NET updater, input handoff and redacted capture tools. Fork maintenance can retain these without requiring their inclusion in the app-permissions PR. Discuss upstream demand before a separate tooling PR. |

Orders 3 and 4 should be submitted as dependent drafts and tested together. They can be combined if the maintainer prefers one security-boundary review, but do not merge app access while leaving the old local-app owner bypass in place. A stacked base branch must not accidentally make unrelated Home/startup/return work part of the permissions diff.

## Change inventory and extraction anchors

| Area | Final code / useful history | Destination |
| --- | --- | --- |
| Launcher Home delivery, command completion | `dock/src/Core/HomeKeyHandler.cs`, `Native/EcoreChildProcess.cs`, `Native/ControlPipe.cs`; `ff3374f`, `5ccbd0d`, `ca47e58`, `429b5b8` | Existing #113/#117/#119 according to the behavior changed |
| Custom Home tile and shared assignment | `home-routing.js`, `dock.js`, `remap.js`, dashboard; `53058dc`, `8c0e886`, `6d431cf`, `cf662c6`, `d989004` | Existing #118/#119, including later validation/save fixes |
| Quick/full TV checks, live view, exit | `app/index.html`, `screen-status.js`, `/screen`; `3f49d07`, `3d6a431`, `e41f7f4`, `488cdcc` | Order 1; split auth-dependent portions into order 3 |
| Input lifecycle | `physical-input.js`, service shutdown; `ce92708` | Order 2 |
| Owner/screen boundary | `auth.js`, `widget-bootstrap*.js`, widget ports, service listener ownership; `95098ef`, `6104eea` | Order 3, adapting current upstream #9 behavior |
| App access | `access-store.js`, `app-access*.js`, `app-identity.js`, `app-permission-registry.js`, `app-ports.js`, `app-replies.js`, vendor HMAC and license, manifest; `288b7d3`, `3c6af03`, `fc0b236`, `b726e8c`, `542fd3d` | Order 4; include native shell completion-marker and public MessagePort reply-factory corrections from the start |
| Startup / return | `startup-app.js`, `return-app.js`, `return-navigation.js`, `power-state.js`, registry lookups, native `NavigationState.cs`; `335d21f`, `69d44eb`, `b286f4e`, `ce50c3c`, `aee9b38` and standby-only integration | Orders 5/6; include bounded lookup/queue behavior and cancellation, not only the earliest feature commit |
| Authenticated scripts / support | `app/scripts/*`, build/manifest tests, public docs | Include the minimum necessary adaptation with the corresponding PR |
| Installation and diagnostics | `tools/*`, opt-in connection/runtime/request diagnostics and CI packaging | Optional tooling; keep personal handoffs, raw evidence and experimental proposals out of upstream diffs |

These anchors identify provenance, not a safe blind cherry-pick sequence. Several commits touch shared files or merge other work. Review the final diff and preserve public licenses and original authorship. Build native changes reproducibly using upstream's policy; do not bundle unrelated generated executables into a feature review.

## What the testing establishes

| Feature | Evidence | Remaining acceptance |
| --- | --- | --- |
| Runtime `488cdcc` | Four CI jobs passed in [run 42064195199](https://github.com/pponce/vetro/actions/runs/42064195199). User reports fast green diagnostics before and after cold boot. | Re-run full CI on the final combined commit and each extracted PR. |
| Normal Back exit/reopen | User completed three immediate reopen cycles after cold boot, with fast green checks each time. | Stock upstream was not A/B tested. Do not claim a proven upstream native hang or universal firmware fix. |
| Screen/service authentication and remote input | Collect-only update output verified matching runtime/screen, an authenticated screen request and saved input/Home after cold boot. | The final report JSON was not supplied. Broader firmware and repeated-update coverage remain necessary. |
| Glass Home permissions | Request reached Vetro; owner approved and saved it; Glass Home displayed Apps from Vetro with 11 selected. | Confirm a fresh post-update read, one positively correlated Vetro launch, pause/revoke and approval persistence after the latest boot. Do not count cached tiles or native fallback as permission success. |
| Standby-only opening | Automated cold-boot exclusion, delayed root, missing session, changed boot ID, real wake/resume, activity, timeout and queue tests. | New standby-only change is not yet installed/tested on the TV. Exercise ordinary wake and cold-boot exclusion before upstream release. |
| Return app and wider scopes | Automated navigation/policy tests. | Full end-to-end TV acceptance remains open; Glass Home only exercises app-list/launch scopes. |

The quick/full split was introduced to make owner pairing available without waiting for app/package inventory. It is a separate UX/performance change, although the permission build also needs scoped authentication to reach those endpoints. Upstream release already improves probe order and early reporting; retain those improvements when proposing the two-stage flow.

The competing private-credential publisher was part of the new screen authentication integration. Its ownership fix belongs with that feature, not an unsupported claim that stock Vetro had the same 401 regression. Unconditional service starts and unguarded repeated exit calls are present in the inspected upstream screen, but that alone does not establish they caused a native exit delay on stock firmware.

## Maintainer-ready descriptions

### Quick screen checks

Opening Vetro runs five bounded checks and makes status and browser pairing available before app/package inventory. OK runs full TV API diagnostics. The screen reuses an answering background service, refreshes live status and cancels outstanding work once when it exits. Validate automatic recovery from an initial failure, explicit full checks, pairing visibility and repeated normal Back/reopen cycles. Preserve release-branch diagnostics in the extracted diff.

### Screen authentication prerequisite

Give Vetro's own screen a short-lived, limited credential through package-private storage. Only the service that owns the HTTP listener publishes credentials or starts background work. Local third-party apps must not inherit owner API access. Validate credential rotation, 401 recovery, failed binds, lifecycle stop/restart, origin checks and existing owner pairing/session compatibility.

### App permissions

An installed TV app can request individual Vetro capabilities, which the owner approves in the paired dashboard. Grants bind native app identity and installation/signing metadata; calls recheck the grant and protected-app policy at dispatch. Pending requests and calls are bounded. Owners can inspect an approved app, reduce permissions, pause it or revoke it. Native requests use authenticated replies without sharing owner credentials. Include [the Glass Home test guide](../app/docs/APP-PERMISSIONS-TEST.md) and report hardware results separately from automated coverage.

### Standby opening / automatic return

Submit as separate features with separate acceptance tables. Standby opening selects one app after an observed ordinary wake when root and activity monitoring are ready, with a fixed 20-second launch window and no cold-boot launch. Automatic return selects a fallback after another app exits, while respecting deliberate navigation. Both need tests for cancellation, stale state and command dispatch, plus TV evidence for their specific behavior.

## Exact next steps

1. Finish final source checks and four-job CI on the integrated candidate, then fast-forward the fork's main to that tested commit. The TV remains on `488cdcc` until a separately requested installation.
2. Use the public Glass Home guide to finish the permission acceptance gaps and exercise the new standby-only exclusion on a TV when ready to install the candidate.
3. Prepare clean screen and input PR branches, retaining relevant current upstream behavior. Prepare authentication and app-permissions branches as a dependent pair with compatibility tests. Do not copy the old owner session store over upstream.
4. Update existing #113/#117/#118/#119 with only their relevant final changes; coordinate overlapping upstream work. Prepare separate standby and return branches after their shared Home/navigation base is established.
5. Review the final titles, diffs, dependencies, exact CI links and hardware limitations before publishing. No new upstream PR or maintainer message is authorized merely by creating this plan.

## Copyable handoff

Objective: publish all integrated Vetro work to the fork main and prepare focused upstream contributions. Enforce standby-only foreground opening; keep Tizen Start at boot independent.

State: runtime source starts at 488cdcc; host tools at ba75a35 are reconciled into the candidate. Glass Home main is 30c4901. The TV has 488cdcc, with fast green checks and three successful immediate reopen cycles. No new TV installation is part of this publication.

Changes: scoped app permissions and owner controls, private screen authentication, live and two-stage diagnostics, input/service ownership cleanup, screen exit/reuse, Home/launcher coordination, startup and return options, and safe update/capture tooling. New change excludes every cold boot from the foreground option and documents the 20-second standby window.

Open: complete CI and publication verification; post-update Glass list/launch/pause/revoke/persistence acceptance; hardware standby-only and return acceptance; upstream auth/session compatibility when extracting PRs. Existing Home PRs are 113, 117, 118 and 119. No stock-Vetro reproduction of the exit delay was captured.

Next: use this plan and app/docs/APP-PERMISSIONS-TEST.md; start new upstream branches from the chosen current upstream base, preserve dependencies, and exclude private notes/diagnostic experiments. Do not publish new upstream PRs or reinstall the TV without a separate request.
