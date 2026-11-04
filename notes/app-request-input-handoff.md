# App request receiver and update input handoff — 2026-11-04

## Objective and current state

Restore Glass Home's explicitly approved app-list and launch access while
preserving remote input across a single in-place Vetro diagnostic update.

The next diagnostic update is ready for the owner to run. No TV installation
was submitted in this continuation, and no new hardware report has been received.

Last verified installed Vetro: `ce92708f55211738f3866756e287b5fb634c0b23`.
Last verified Glass Home: `30c490194f1748d523262a1ac8985fe45f735729`, which
is still the head of `pponce/glass-home-samsung-tv`,
`combined/vetro-permissions`. No new Glass Home installation is needed for
this capture.

## Repositories and branches

- Runtime: `pponce/vetro`, `combined/runtime-wrapper-observation-20261103`.
  Ready candidate: `e4033b41f29fc418228494db38364199026902a6`.
- Host updater: `pponce/vetro`, `combined/runtime-wrapper-inspection-20261103`.
  Entry point: `tools/run-app-request-update.sh`.
  The runner pins runtime `e4033b41f29fc418228494db38364199026902a6`,
  CI run `41912982747`, and helper revision
  `fc7b8663a7708e85a1f3427bfb62b001a2442345` with all five SHA-256 hashes.
- Authoritative combined branch: `combined/permissions-startup-return`,
  unchanged at `35ebe18507f9ea289c76d8920ad0bdd4e2bde191`.
- Glass Home: `pponce/glass-home-samsung-tv`, `combined/vetro-permissions`,
  unchanged at `30c490194f1748d523262a1ac8985fe45f735729`.

## Changes and validation

The runtime adds opt-in, bounded app-request diagnostics for receipt, sender
metadata, frame/parameter validation, reply reservation, and handler
dispatch/completion. Native identity, signer, explicit approval and protected-app
checks remain enforced. Diagnostic failures cannot affect validation or dispatch.
Request contents, credentials, reply IDs/keys, app names and raw errors are not
retained by this telemetry.

Original runtime `89eff781563e96ef36d9ce04b078c20329fedccf` failed the
headless launcher control/privilege-boundary step in run `41909711698`.
Connected GitHub tools could read job results but not logs or invoke a rerun.
An empty validation commit on the same runtime branch triggered the full suite.
GitHub comparison confirms zero changed files and the same source tree
`8e556d36f992318374e43f46733f33b0dd0028b5`.

All four jobs passed on exact candidate `e4033b41f29fc418228494db38364199026902a6`:

- `check`
- `permissions_ui`
- `launcher`, including the previously failed step
- `combined_package`

Run: https://github.com/pponce/vetro/actions/runs/41912982747

All 70 available local host tests also passed. The five helper files matched
their pinned SHA-256 hashes. The runner update changes only its runtime revision
and CI run literals. The initial CI failure's cause remains unknown; a passing
rerun is not evidence of a source fix or successful TV behavior.

## Remote input safeguards

The host updater requires a healthy saved filter and a unique helper associated
with the active service before proceeding. It requests temporary observation,
checks that saved preferences remain unchanged, and proves the exact old
PID/start-time pair has exited before installation. It does not kill a PID or
persist an Off preference.

After the package update, it verifies service and screen revisions, screen
authentication, and restored input. A healthy automatically restored filter is
left alone. An in-progress filter gets a bounded wait; resume is requested only
when a filter is not already active. An uncertain installation is collected
without submitting another installation.

The updater returns failure if input restoration is unverified, and the runner
starts the normal-mode request collector only after successful verification.
A small transition journal retains process/status facts, not a configuration
backup. Full TV-screen diagnostics are unnecessary; allow only quick startup
checks during this verification.

## Unresolved functional issue

The latest pre-update inspector capture observed 36 successful outer HTTP
responses containing 36 inner 404 responses, with no reply record, pending
permission request, grant, or Glass Home handler event. Earlier approval had
been deliberately revoked. This narrows the problem to native request delivery
or rejection before dispatch without identifying which stage failed.

The cached app list reappearing does not prove fresh permission or a successful
live refresh. The next update supplies receiver evidence; it is not a verified
fix for the Glass Home connection failure.

## Exact next steps

1. Keep the existing TV apps installed. Run the pinned updater in the established
   project with the existing signing identity, with TV-Store's relay ready and
   other Apps2Samsung/debug clients closed.
2. Require the updater to verify the new service, authenticated screen, and
   restored remote input. If it stops, inspect its report before another action.
3. At `CAPTURING`, open Glass Home normally, open `+`, let `Checking apps`
   finish, then choose `Connect to Vetro` once. Keep Glass Home visible through
   the 90-second capture. This does not use Web Inspector or relaunch Glass Home.
4. Retrieve both the connection report and native-request report using the
   complete Mac rsync commands printed by the runner.
5. Use the receiver's first failed stage to choose the functional fix. Then
   verify explicit approval, live refresh, one intentional app launch,
   revocation/denial, and power-on/return/saved-settings acceptance.

Prior detail: `glass-access-capture-handoff.md` and
`input-lifecycle-handoff.md`. No raw reports, credentials, or personal network
details are included here.
