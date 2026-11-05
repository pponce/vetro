# App request receiver and update input handoff — 2026-11-05

## Objective and current state

Restore Glass Home's explicitly approved app-list and launch access while
preserving remote input across a single in-place Vetro diagnostic update.

Glass Home request delivery and owner approval are now verified. The owner
subsequently reports `Apps from Vetro · 11 selected`, the live app-list success
label. The remote-input handoff passed on the earlier `e4033b41` build.
App launching, return/power-on behavior and approval persistence across a new
Vetro update remain to be checked.

Verified running Vetro: `542fd3da54fafc2bb01a6b3eb5665869beda9f0f`,
which combines TV-screen authentication recovery with compact approved-app rows.
All four jobs passed in run `41944347516`. The owner sees the compact permission
UI. The update report verifies the new clean service but did not verify screen
authentication or finish the remote-input handoff. Later, the owner reports good
TV diagnostics after a long delay and repeated manual checks. This does not
establish reliable automatic recovery. Preserve the working screen and collect
current state before another restart or install.
Last verified Glass Home: `30c490194f1748d523262a1ac8985fe45f735729`, which
is still the head of `pponce/glass-home-samsung-tv`,
`combined/vetro-permissions`. At the owner's explicit request, `main` was also
fast-forwarded to that exact tested revision. No new Glass Home package is needed.

## Repositories and branches

- Runtime: `pponce/vetro`, `combined/runtime-wrapper-observation-20261103`.
  Installed candidate and branch head: `542fd3da54fafc2bb01a6b3eb5665869beda9f0f`.
- Host updater: `pponce/vetro`, `combined/runtime-wrapper-inspection-20261103`.
  Installer entry point: `tools/run-permissions-screen-update.sh`, targeting `542fd3da`
  from `e4033b41` and pinning CI run `41944347516`. Its four unchanged helpers
  remain pinned to `fc7b8663a7708e85a1f3427bfb62b001a2442345` with SHA-256
  verification. It does not ask the owner to submit another permission request.
  Do not reinstall to investigate the current authentication delay. The next
  entry point is `tools/run-screen-auth-check.sh`, which preserves the running
  screen by default and finishes only the recorded input handoff.
- Authoritative combined branch: `combined/permissions-startup-return`,
  unchanged at `35ebe18507f9ea289c76d8920ad0bdd4e2bde191`.
- Glass Home: `pponce/glass-home-samsung-tv`, `combined/vetro-permissions`,
  and `main`, both at `30c490194f1748d523262a1ac8985fe45f735729`.
  Main was a clean fast-forward from `30ebf4b06c5fd2f799afa22631a0f55347e94309`;
  no code was changed for this promotion. Candidate CI run `41796862889` passed.
  The subsequent main-branch CI run `41943530563` also passed.

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

The updater returns failure if input restoration is unverified. The earlier
request-diagnostics runner started a normal-mode request collector afterward;
the current screen-recovery runner finishes after update verification.
A small transition journal retains process/status facts, not a configuration
backup. Full TV-screen diagnostics are unnecessary; allow only quick startup
checks during this verification.

## Earlier delivery failure; cause still unknown

The latest pre-update inspector capture observed 36 successful outer HTTP
responses containing 36 inner 404 responses, with no reply record, pending
permission request, grant, or Glass Home handler event. Earlier approval had
been deliberately revoked. This narrows the problem to native request delivery
or rejection before dispatch without identifying which stage failed.

The cached app list reappearing did not prove fresh permission or a successful
live refresh. Earlier telemetry showed failure before the app-access callback;
it did not identify whether the sender, registration/broker, or native delivery
was responsible. The installed build added diagnostics, not a delivery fix.

Sender and receiver source use matching port names, version-2 envelopes and
reply-ID/key formats. A prior TV export of Samsung's service runner confirms a
MessagePort routing layer exists; its file capture alone does not prove which
runtime is currently loaded. No firmware wrapper was modified, no permission
check was removed, and no new runtime/application patch was prepared.

An earlier reopening attempt produced the same saved-app-list timeout and no
approval request; receiver counts remain empty. Both the Glass Home UI and
Photos service were stopped in that attempt. The source normally checks and
starts Photos when opening the UI, but its actual health must be verified.
Do not repeat the same restart or call a stale sender handle the established cause.

## Successful delivery and saved approval

Evidence: `glass-request-20261105-003925-934119.json`, followed by the owner's
confirmation of approval, saved permission and `Apps from Vetro · 11 selected`.

- The 60.5-second capture completed with no errors. Photos was healthy and
  reported permission transport version 2. All seven Glass file hashes and
  all three Vetro receiver/reply hashes matched the pinned installed source.
- The native remote-port lookup returned the expected app, port and regular
  trust flag. Vetro verified Glass UI sender metadata on its received frames.
- Before the inspector relaunch, one `access.status` request was already
  received and completed. At capture start there were two; at its end five.
  All five reserved a reply, dispatched and resolved successfully: four status
  calls and one permission request. There were no receiver rejection events.
- The widget showed Connect busy and then pending. Four reply polls produced
  one processing response and three successful replies (two unapproved, one
  pending), without network, body-read or JavaScript exception failures.
- Final owner state contained one saved grant and zero pending requests.
  The audit included `access.request: pending` and `access.approve: saved` for
  Glass Home. The recorded `permission_denied` widget label preceded a fresh
  read of the saved approval; it does not override the final grant evidence.
- The helper completed its normal Glass UI relaunch. The owner then reported
  the live-list label with 11 selected apps. Source inspection confirms this
  label requires a successful available, nonempty Vetro list; cached-only
  failure takes the separate saved-list label.
- Vetro's diagnostic start time was `2026-11-05T00:29:57.936Z`, newer than the
  previous update report's `2026-11-04T23:48:39.341Z`. No restart occurred during
  this capture. The trigger for the earlier restart and restored delivery is
  unknown; do not claim the inspector or a specific code change fixed it.

The combined updater's Bash/Python syntax, exact runtime/baseline/CI pins,
four helper hashes and single updater invocation were verified locally using
mocked network/hardware. Authentication-only parent `e41f7f4a` passed all four
jobs; the combined candidate also passed its own exact four-job CI run.

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

## Compact approved-app rows

The owner requested a single app-name/status row, with permissions and
Save/Pause/Resume/Revoke controls revealed only after opening the app.
Runtime `542fd3da` implements native details/summary disclosure, Approved/Paused
status styling, visible global-off or changed-installation exceptions, and
confirmed revocation inside the expanded details. It preserves unsaved checkbox
selections when collapsed and keeps expansion by app identity across saves or
refreshes. Keyboard focus returns to the app row after a change and to Refresh
after a grant is removed.

The change extends `e41f7f4a`; it does not modify app-access authorization,
native transport or remote-input lifecycle. Local permission UI, screen recovery
and live status tests pass. GitHub's source and desktop/mobile browser checks
passed, including keyboard interaction, preserved edits/expansion/focus,
confirmation, stale-revision refusal and collapsed/expanded 390-pixel layout.
See `notes/approved-apps-ui-handoff.md` on the runtime branch.
All four jobs (`check`, `permissions_ui`, `launcher`, `combined_package`) passed
on exact candidate `542fd3da54fafc2bb01a6b3eb5665869beda9f0f`:
https://github.com/pponce/vetro/actions/runs/41944347516 .

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

1. Keep the installed Glass Home package. Its exact tested source is now main;
   no Glass Home installation is required for the branch promotion.
2. Verify one intentional app launch from Glass Home and reopening it with the
   saved permission. App-list success alone does not establish launch behavior.
3. Keep runtime `542fd3da` installed. Run `run-screen-auth-check.sh` without the
   inspector flag to preserve the now-working TV screen, collect service/screen
   evidence and verify or resume the recorded saved remote input. Review the
   report before any new package or service restart. If authentication fails
   again, use the explicit `--inspect-screen` mode for credential/status/pairing
   observations. That mode relaunches only the screen and can change timing.
4. Preserve native caller identity, signer checks, explicit grants and protected
   system-app restrictions. Do not replace native authentication with an
   HTTP-supplied app ID or share the owner's credential with Glass Home.
5. Complete remaining revocation/denial and power-on/return/saved-settings
   acceptance separately. If delivery fails again, correlate both sides and
   lifecycle evidence; do not reinstall merely to repeat empty counters.

Prior detail: `glass-access-capture-handoff.md` and
`input-lifecycle-handoff.md`. No raw reports, credentials, or personal network
details are included here.

## Installed screen recovery: delayed success remains unresolved

`connection-report-20261104-171207-666667.json` records the exact clean `542fd3da`
service, ready security storage, two successful private credential publications,
and an available app port. Screen diagnostics were absent throughout the
three-minute capture. The author certificate was unchanged. Installation was
submitted once; the CLI's successful exit did not supply its expected confirmed
install/launch fields. The new running service and owner-observed dashboard UI
establish installation separately from screen authentication.

Input observation was confirmed and the old filtering helper exited. The saved
handoff still had `observationRequested:true`, `resumeRequested:false` and
`verified:false`. That is not a current input status read: check the actual mode
before restoring, and never restart a filter that is already healthy.

The owner observed repeated HTTP 401 on both screen diagnostics and pairing,
then eventual good diagnostics after a long wait and repeated checks. The same
widget credential protects `/status`, `/screen` and `/auth/pending`; the existing
owner browser pairing uses separate credentials. Do not reset browser pairings
or bypass local scoped widget authorization. No exact failing sequence or cause
of recovery has been established, and no further runtime fix is claimed.

`capture-screen-auth.py` defaults to a 30-second current-state observation with
existing owner pairing. It validates the current clean service and recorded
handoff, finishes only a verified input handoff, and otherwise leaves the screen
and service running. An explicit inspector mode verifies the installed auth
source, reopens only the screen, records automatic-request completion counts and
page flags for 60 seconds, and tests cached/fresh private credentials against
status and pairing reads. Tokens, codes, response bodies and headers remain on
the TV; Network and Runtime event feeds are not enabled. Normal screen reopening
runs on success or failure after a debug launch attempt. This mode is diagnostic,
not a proven fix, and debug relaunch is an acknowledged timing change.

Local tests cover normal-mode preservation, exact-revision/old-helper guards,
resuming only saved input, preserving an already healthy filter, allowlisted
results, credential containment and screen-only cleanup after inspector failure.

