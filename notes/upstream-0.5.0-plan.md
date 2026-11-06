# Vetro 0.5.0 contribution and compatibility plan

Updated 2026-11-06. This checkpoint supersedes the submission order in `notes/upstream-pr-plan.md`.

## Objective and decision

Keep the working combined fork while waiting for stable upstream 0.5.0. After release, check the final upstream baseline, adapt Glass Home and Garage Home to stock APIs, test on S95C/Tizen 9, and retain only the Home features and demonstrated fixes still needed. Do not submit the combined branch as an upstream PR.

Per-app permissions are optional for this setup. Park that API and its separate screen-authentication prerequisite. Revisit them only through the design discussion requested by the maintainer. Keep signing/install tooling separate from the application package.

This document records the plan and unsent comment drafts. It does not authorize posting comments, installing software, rebasing PR branches, disabling Samsung Home or publishing additional PRs.

## Repositories and source checkpoints

- Upstream: https://github.com/andrearicci93/vetro
- Reviewed release branch: `release-0.5.0`, head `fd68ce2db7d2f9c2ba6102b5036d6b99a7b92382`.
- Published stable release at review: `v0.3.5`; `v0.5.0` not yet published.
- Working fork: https://github.com/pponce/vetro, branch `feat/home-double-press`, installed integration source reported in issue #138: `fbbbafda72a840e135f92ea919f63e3c29a3b9b4`.
- Glass Home: https://github.com/pponce/glass-home-samsung-tv, `main` / `combined/vetro-permissions`; reviewed `318778fb2028f944dff7c3d373ac8057f48ee4e4`.
- Garage Home: https://github.com/pponce/garage-home, `feat/vetro-controls`; reviewed `755fc205bccf72b83b197ee06b1bb14041902707`.
- This plan: `pponce/vetro`, documentation branch `notes/upstream-0.5.0-plan`, path `notes/upstream-0.5.0-plan.md`.

## Maintainer decisions

Source: [issue #138 reply](https://github.com/andrearicci93/vetro/issues/138#issuecomment-6686574200).

- Taken into release: input lifecycle cleanup from `prep/input-lifecycle-release-20261105`, upstream commit `e7ba796ad8c0741dab3b58a4b4b94d0ec7f77e39`. Maintainer reports passing tests; integration not yet tested by him on a TV.
- Existing overlap: concurrent screen checks and deferred package inventory; duplicate Home suppression and pending Home-close cancellation.
- After release: remaining screen/service reuse changes, Home tile, shared assignment, double press.
- Possible future plugins: standby foreground opening and automatic return, once key/app events are exposed.
- Design discussion first: per-app capabilities and separate TV-screen authentication. Plugins run with Vetro's capabilities and are not a security boundary.
- Targets: `release-0.5.0` only for small ready release fixes; `main` after release for the deferred work.

## Focused PR plan

| Work | Existing branch | Next action |
| --- | --- | --- |
| [#113 short Home press](https://github.com/andrearicci93/vetro/pull/113) | `fix/launcher-home-toggle` | Compare all five regression scenarios with final upstream. Preserve delayed-echo handling. Retain only residual changes/tests; close as superseded if nothing remains. |
| [#117 Home close completion](https://github.com/andrearicci93/vetro/pull/117) | `pr/home-guard-completion` | Concentrate on a close already executing. Upstream cancels future closes but does not wait for that in-flight command. Maintainer requests post-release Q80A testing and source rebuild. |
| [#118 editable Home tile](https://github.com/andrearicci93/vetro/pull/118) | `pr/home-shortcut-settings` | Destination, label, persistence, restoration and unavailable-app fallback only. Rebase after release. |
| [#119 shared Home assignment](https://github.com/andrearicci93/vetro/pull/119) | `pr/shared-home-assignment` | Remove stacked/redundant changes; reconcile ownership with final launcher modes. Preserve one physical key owner and coherent editing/restoration. |
| Independent double press | Extract from `feat/home-double-press` | New focused PR after Home ownership is agreed. Immediate single press; second distinct press within 350 ms; independent app or linked Home-tile destination; cancellation and fallback tests. |
| Screen reliability | Prepared `prep/screen-quick-checks-release-20261105` and `prep/screen-input-stack-release-20261105` | Test upstream first. Port only residual behavior, preserving upstream authentication. Input cleanup already taken must not be resubmitted. |

The desired Home combination is Vetro overlay on immediate single press, Samsung Home on its onscreen Home tile, and Glass Home on double press. Stock Custom launcher mode replaces the overlay and does not provide that combination.

## Client compatibility

### Glass Home

Stock has `/apps`, `/apps/launch`, `/apps/icon`, `/dock` and `/dock/icon`. It trusts qualifying requests originating on the TV without per-app approval. Use the Glass Home service as the compatibility adapter; browser origin restrictions and platform loopback isolation still matter.

The current legacy client reads the Home row through `/dock`. That is not the same as the fork's full installed Samsung Apps catalog, including unpinned apps. Stock `/apps/icon` reads package icons; `/dock/icon` provides Home-row artwork. Verify YouTube/Prime artwork and unpinned apps rather than assuming equivalence.

First adapt existing endpoints. If exact catalog/artwork coverage remains unavailable, propose a small independent catalog/artwork change or optional plugin; do not require the complete permissions system. Keep tile movement, custom artwork, hidden state and saved selections.

### Garage Home

Keep native Sources: `systeminfo` VIDEOSOURCE and `tvwindow.setSource`; no Vetro permission dependency.

Current controls use the custom scoped API and are not drop-in compatible. Task management can be adapted to stock `/monitor` and `/components/action`; volume/mute, sleep shutdown and optional brightness can use stock control/settings routes through an appropriate local service adapter. Task management can be omitted if not worth retaining. Preserve user-app filtering, confirmation and verification in the client.

## Readiness and corrections

The release branch is a test candidate. Earlier Q80A builds have hardware validation; that is not validation of the current head on S95C. New root runtime preflight changes are described as offline-tested and not deployed to a TV in the current changelog.

CI for `cacb6c9d819ff2f382a38944785fd9fe38122fab` passed in [run 42241323401](https://github.com/andrearicci93/vetro/actions/runs/42241323401). At this checkpoint, current-head [run 42260533724](https://github.com/andrearicci93/vetro/actions/runs/42260533724) was in progress. Recheck before selecting any test build.

Important same-day change: Custom launcher no longer disables Samsung Home, following [commit 3ed9b7c](https://github.com/andrearicci93/vetro/commit/3ed9b7c648a5f51c2a5c987af57810d8033b69fd). It now uses the dock guard. Earlier descriptions of automatic package disabling are superseded. The maintainer found that disabling Samsung Home can prevent the Q80A boot script finishing; the standalone disabling switch should not be used for a reboot test.

The fork's current double-press/tile/assignment behavior is not included in stock. Replacing the installation would also require checking client compatibility, signing identity, saved configuration and the difference in owner authentication/session storage. Do not assume rollback of application files also rolls back configuration formats.

## Verification and exact next steps

1. Await stable 0.5.0. A release watch checks every six hours, notifies on stable publication, then pauses itself.
2. Read the final tagged source/release notes and verify its checks and included fixes. Do not infer PR merge status from similar behavior.
3. Prepare client adapters and acceptance checks without changing the installed TV. Verify full app list, unpinned apps, Samsung artwork, selection/hidden-state persistence, native Sources and desired controls.
4. Before any requested TV install, verify signing compatibility and a recovery path. Ask before creating backups. Use the complete rooted integration package, not the app-only package.
5. Run a controlled stock S95C comparison: initial/open/reopen diagnostics, pairing, service/input restart, Home event order/echo/rapid presses, Samsung Home selected during a pending/in-flight close, ordinary wake, and cold boot with Samsung Home enabled.
6. Record hardware findings separately from CI. Any 401 or startup problem must be reproduced on stock before attributing a fork-specific authentication fix to upstream.
7. Rebase/extract #113/#117/#118/#119 only after release and explicit implementation work begins. Prepare independent double press once key ownership is settled. Preserve review threads.
8. Hold startup/return and permissions. Keep Tizen Start at boot distinct from standby foreground launch.

## Copy and paste handoff

Objective: preserve the preferred Home interaction while reducing the maintained Vetro fork after upstream 0.5.0.

Current state: working integration is pponce/vetro feat/home-double-press fbbbafd. Upstream release-0.5.0 head fd68ce2 is unreleased; current-head CI was running at the checkpoint and must be rechecked. Input lifecycle cleanup is already upstream as e7ba796. No TV installation, runtime code change or comment posting is part of this checkpoint.

Decisions: wait for release; adapt Glass/Garage to stock APIs; permissions are optional; preserve independent double press and editable Home tile. Custom launcher now uses a guard and no longer disables Samsung Home. Keep stock-auth compatibility and configuration migration explicit.

Outstanding: final-release CI/hardware coverage; exact full catalog/artwork parity; scoped Garage control replacement; isolated Home race tests; rebase/extract existing PRs. Resume from this plan and the current GitHub threads, checking for newer maintainer comments.

## Unsent replies

### Issue 138

Thanks Andrea, that gives me a clear path forward. Thanks also for taking the input lifecycle fix and preserving the credit.

I'll hold off on further feature submissions until 0.5.0 is released, then test the released build on my S95C/Tizen 9 and separate out what is still needed.

My plan is:
- #113: compare the five regression scenarios against the new Home-event handling and keep only any remaining gap.
- #117: focus on the close command that is already running when Samsung Home is selected. I'll leave this open for your post-release Q80A comparison and source rebuild.
- #118: keep the configurable launcher Home tile and label as a small, separate feature.
- #119: rework the shared Home assignment around the final Vetro/Custom launcher behavior, with one owner of each physical press.

The Home behavior I most want to preserve is a single press immediately toggling Vetro's overlay, with a quick double press opening a separately chosen app. For example, the overlay's Home tile can still open Samsung Home while double press opens Glass Home. I'll prepare double press separately after we agree on the Home ownership model.

The per-app permission system isn't essential for my setup, so I'm happy to park it and the separate screen authentication work. I'll check Glass Home and Garage Home against the stock APIs and adapt the clients where needed. Full Samsung Apps catalog and artwork coverage still need checking; I won't assume those are identical to my fork. If we revisit permissions later, I'll start with the design discussion you requested.

I'll also test your new screen checks before proposing any remaining screen/recovery changes. Standby opening and automatic return can wait for the plugin event APIs, and signing/install helpers can remain separate tools.

I'll keep the existing PR threads open and target main after the release for the remaining feature work.

### PR 113

Following your comments in #138, I'll hold this until after 0.5.0 and compare the five regression scenarios against the released launcher.

I'll check both event orders, a delayed XF86Home echo, duplicate events, a genuine second press and the first press after a long idle. I'll preserve the newer 1.5-second echo handling rather than replace it with the older implementation in this PR.

If the released code covers all the scenarios, I'm happy to close this as superseded or contribute only any useful missing tests. If a gap remains, I'll reduce the PR to that behavior, rebase onto main and report the isolated S95C result.

### PR 117

Thanks, that distinction makes sense. I'll leave this open and hold it until after 0.5.0.

I'll focus the follow-up on the remaining case: a Home close command has already started when Samsung Home is selected. The change needs to wait for that command to complete before launching Home, while preserving the release's cancellation of pending closes.

I'll keep the source and focused regression tests available for your Q80A comparison, and rebase around the final launcher code so the diff contains only what is still needed. My existing S95C result covers the combined build; I'll report an isolated test separately rather than treat that as proof of this particular race.

### PR 118

Following your feedback in #138, I'll keep this open and wait until after 0.5.0.

I'll keep the scope to the Vetro overlay's Home tile: choose an installed app, set its label, restore Samsung Home as the default, and fall back to Samsung Home if the selected app becomes unavailable.

This remains useful when keeping Vetro's overlay rather than selecting Custom launcher mode. It won't change the physical Home assignment or include double press, standby opening, automatic return or app permissions.

After release, I'll rebase it onto main and separate any shared launcher changes so you can review this feature on its own.

### PR 119

Following your comments in #138, I'll keep this open and wait until after 0.5.0.

I'll rework it around the final Vetro launcher and Custom launcher modes. The main requirement is one clear owner of each physical Home press, with consistent saved settings and no competing launcher/remapper handling. I'll document what happens when changing modes and when restoring Samsung Home.

This branch is currently stacked, so I'll remove changes already covered upstream and rebase the remaining assignment/editor work after the earlier PRs are resolved.

I'll keep double press in a separate follow-up. The intended combination is an immediate single-press overlay toggle and an independently selected double-press app, without changing the overlay Home tile.
