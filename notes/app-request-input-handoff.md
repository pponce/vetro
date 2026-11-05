# App request receiver and update input handoff — 2026-11-05

## Objective and current state

Restore Glass Home's explicitly approved app-list and launch access while
preserving remote input across a single in-place Vetro diagnostic update.

The diagnostic update has been installed once and verified on the TV. The
remote-input handoff passed; Glass Home still cannot submit a visible approval
request. Do not reinstall Vetro for the next check.

Verified installed Vetro: `e4033b41f29fc418228494db38364199026902a6`.
Prepared next runtime: `e41f7f4a2021c63505261645b1e39c8e2c06a4f6`,
which fixes TV-screen authentication recovery. All four jobs passed in
run `41939908358`; it has not been installed or verified on the TV. Keep the
installed build for the correlated capture below.
Last verified Glass Home: `30c490194f1748d523262a1ac8985fe45f735729`, which
is still the head of `pponce/glass-home-samsung-tv`,
`combined/vetro-permissions`. No new Glass Home build has been prepared.

## Repositories and branches

- Runtime: `pponce/vetro`, `combined/runtime-wrapper-observation-20261103`.
  Installed candidate: `e4033b41f29fc418228494db38364199026902a6`.
  New branch head: `e41f7f4a2021c63505261645b1e39c8e2c06a4f6`.
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

## TV verification

Evidence: `connection-report-20261104-154817-598783.json` and
`native-requests-20261104-234848-963153.json`.

- The first attempt stopped at the busy-relay preflight without submitting an
  install or starting input handoff. A later check showed zero relay sessions.
- The successful attempt submitted installation exactly once. The CLI did not
  provide a verified install/launch result, but the running clean service and
  authenticated screen both independently verified the exact target revision.
  The author certificate is unchanged.
- Temporary input observation was confirmed and the exact old filtering helper
  exited. The new service automatically restored filter mode, connected input,
  saved-enabled state and Home readiness. `resumeRequested:false`,
  `verified:true`. The owner also reports working remote input.
- The screen's earlier startup snapshot briefly showed input recovering; the
  later handoff verification confirmed connected input. Do not confuse these
  observation times or describe this as proof against all future recurrence.
- Normal-mode request capture completed for 90 seconds with no errors. Before,
  after and every observed interval had an available app port but no app-request
  counts or events; permissions were enabled/available with zero pending
  requests, grants or Glass handler events.
- The owner reports selecting Connect and seeing the same failure. A subsequent
  direct status read still showed the expected revision and empty request counts.
  This collector does not directly observe the widget's send call.
- Vetro's own widget delivered two native messages during startup. The external
  app listener recorded none. The app-port available flag records registration
  calls returning without error; it is not proof of successful delivery.

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
live refresh. Current telemetry points to failure before the app-access callback;
it does not identify whether the sender, registration/broker, or native delivery
is responsible. The new build is diagnostic, not a verified connection fix.

Sender and receiver source use matching port names, version-2 envelopes and
reply-ID/key formats. A prior TV export of Samsung's service runner confirms a
MessagePort routing layer exists; its file capture alone does not prove which
runtime is currently loaded. No firmware wrapper was modified, no permission
check was removed, and no new runtime/application patch was prepared.

After reopening, the owner reports the same saved-app-list timeout and no
approval request; receiver counts remain empty. Both the Glass Home UI and
Photos service were stopped in that attempt. The source normally checks and
starts Photos when opening the UI, but its actual health must be verified.
Do not repeat the same restart or call a stale sender handle the established cause.

## Prepared screen recovery fix

The first failed authenticated summary previously prevented further status
polling because no previous summary existed. The candidate retries that initial
read, then uses lightweight live reads after success. HTTP 401 is displayed as
service reachable with authentication reconnecting; credential storage that is
not yet ready is distinguished from proof that the service responded. A delayed
old-token refusal cannot invalidate a newer session. Full inventory remains
manual, and no service/input lifecycle behavior is changed.

Seven targeted local suites passed, including startup failure/recovery, 401 and
private-storage timing, network failures, concurrent reads, visibility/run
epochs, old-token responses, live HTTP authorization and private bootstrap.
The exact candidate passed `check`, `permissions_ui`, `launcher`, and
`combined_package`: https://github.com/pponce/vetro/actions/runs/41939908358 .
This fixes a demonstrated code gap but is not yet an observed hardware fix.

## Correlated capture

`tools/capture-glass-access.py` now pins installed Vetro `e4033b41` and Glass
Home `30c49019`, verifies seven Glass files and three Vetro receiver/reply files,
and checks that the Photos service answers with permission transport version 2.
It relaunches only the Glass UI in Web Inspector mode, then reopens it normally.

During the capture, it records a native remote-port lookup, visible Connect
busy state, reply-poll results, and the current Vetro receiver events/counters.
The diagnostic start time and lifecycle counters expose a service restart that
could reset evidence. It uses the unauthenticated diagnostic envelope; the
authenticated `/status` response intentionally has a different shape.

Reply polling in the verified client follows a returning native send call.
That supports an explicit inference of send return, never proof of OS delivery.
The helper sends no diagnostic app request, replaces no native function, exports
no request/reply credentials, and changes no package, grants or input settings.
Debug mode can change timing. All 57 locally available capture, transport and
owner-client tests passed before publication.

## Exact next steps

1. Keep both packages installed. Open Glass Home normally once so Photos can
   start; close other relay clients. Do not manually stop either service.
2. Run the pinned correlated capture. Wait for CAPTURING, open +, wait for the
   app check, and choose Connect to Vetro once. Return its JSON report.
3. Check file/health preflight, native lookup, Connect busy observation and
   post-start reply polling against receiver events and service lifetime.
   If the sender returned with no receiver event and no restart, investigate
   native registration/broker routing without loosening authentication.
4. Preserve native caller identity, signer checks, explicit grants and protected
   system-app restrictions. Do not replace native authentication with an
   HTTP-supplied app ID or share the owner's credential with Glass Home.
5. After a functional fix, verify approval, live refresh, one intentional app
   launch, revocation/denial, and power-on/return/saved-settings acceptance.

Prior detail: `glass-access-capture-handoff.md` and
`input-lifecycle-handoff.md`. No raw reports, credentials, or personal network
details are included here.

