# App request receiver and update input handoff — 2026-11-05

## Latest checkpoint: normal reopening, 2026-11-05

The installed runtime remains `6104eeaa7507d10f28edb68f08e37cff4d627aa5`.
Cold boot restored filter/Home automatically, and both the first opening and a
later opening after a long closed interval produced fast green diagnostics.
Immediate reopening after another Back exit still failed, including an attempt
about 45 seconds later. The third attempt opened and went green quickly.

Prepared runtime: `488cdccf3f08916addf4d5f2af567eecd5c105c7`, on
`combined/runtime-wrapper-observation-20261103`. All four jobs passed in
[CI 42064195199](https://github.com/pponce/vetro/actions/runs/42064195199).
The new screen reuses an authenticated service instead of issuing redundant
starts; HTTP refusals retain normal authentication recovery. Exit is idempotent
and cancels screen work. A new test fails on the installed baseline with two
unneeded start calls, then passes on the new code. Eleven targeted local suites
and the complete CI checks passed. See `notes/screen-lifecycle-handoff.md` on
the runtime branch for details.

The native cause of the TV's delayed reopening remains unconfirmed. This build
is ready for a normal-operation device test, not declared fixed or installed.

Pinned installer: `tools/run-screen-lifecycle-update.sh` on this host branch.
It targets the new runtime from installed baseline `6104eeaa`, checks all four
CI jobs, reuses the existing certificate and pairing, retains the at-most-once
install ledger, and pauses/verifies/restores the saved input using the existing
pinned helpers. A repeated run collects/verifies the recorded attempt without
installing again. It prints the report retrieval command. Runner SHA-256:
`713f2f1e7a1e4e6fe5648ceebfb0c8e7c980f80e1646c70c26c5af636caef539`.

Exact next steps:
1. Install this pinned Vetro build once using the prepared runner with the
   established project, TV, local host and report-host arguments.
2. After the update finishes, cold boot once to test the installed package in a
   fresh runtime, open Vetro, then rerun the same runner for verification only.
   Do not delete the install-attempt or input-handoff records.
3. Test normal Back and immediate reopening three times, without an inspector
   or forced app restart. Record any delay, popup, auth failure or lost input.
4. Verify Glass Home's saved approval, app refresh and app launch. Its main
   remains `30c490194f1748d523262a1ac8985fe45f735729`; no new Glass Home install.
5. If reopening remains blocked, collect the screen process wait channel and
   bounded exit evidence rather than claiming that repeated start/exit cleanup
   explained the native delay.

## Objective and current state

Restore Glass Home's explicitly approved app-list and launch access while
preserving remote input across a single in-place Vetro diagnostic update.

Glass Home request delivery and owner approval are now verified. The owner
subsequently reports `Apps from Vetro · 11 selected`, the live app-list success
label. Remote input is now verified healthy after a cold boot on `6104eeaa`, as well
as in earlier `542fd3da` and `e4033b41` captures. The post-boot verifier found a
connected filter and Home ready on its first read; no resume request was needed.
App launching, return/power-on behavior and approval persistence across a new
Vetro update remain to be checked.

Previously verified Vetro: `542fd3da54fafc2bb01a6b3eb5665869beda9f0f`,
which combines TV-screen authentication recovery with compact approved-app rows.
All four jobs passed in run `41944347516`. The owner sees the compact permission
UI. The update report verifies the new clean service but did not verify screen
authentication or finish the remote-input handoff. Later, the owner reports good
TV diagnostics after a long delay and repeated manual checks. This does not
establish reliable automatic recovery. Two subsequent current-state captures
verify stable service and input but have no screen telemetry. A later direct
inspector capture now verifies fast authenticated startup, continued automatic
polling and successful status/pairing reads; the owner also reports fast normal
reopening. A service restart occurred between the earlier and later captures,
before the inspector script ran. Its trigger and the original failure sequence
remain unknown. Subsequent normal exits/reopenings still intermittently fail:
the screen sometimes cannot be reopened for a while, and successful reopening
can lead to a temporary 401 followed by green checks. A launch-time popup asks
the owner to wait and try again; the next attempt can succeed. TV-Store is not
required for either the failure or recovery. The passive normal-operation
capture now shows alternating accepted/rejected private credentials from two
120-second publishing sequences while the observed service stays unchanged.
The rejected file replaces an accepted file without a publication by that
service. The exact competing process/worker has not been identified.

Installed runtime `6104eeaa7507d10f28edb68f08e37cff4d627aa5` gates credentials,
native ports, root/MQTT startup and background operations on HTTP listener
ownership. All four jobs passed in CI run `41962819197`. The latest update
report verifies the clean service, matching screen and screen authentication
within 10.2 seconds. Before the cold boot, remote-input resume failed with an
unclassified HTTPError and normal exit/reopening still blocked temporarily.
After a cold boot, the user reports fast passing TV checks; the verification
console confirms input filter connected, Home ready and no recovery pending.
Normal exit/immediate reopening after that cold boot remains to be tested.
Last verified Glass Home: `30c490194f1748d523262a1ac8985fe45f735729`, which
is still the head of `pponce/glass-home-samsung-tv`,
`combined/vetro-permissions`. At the owner's explicit request, `main` was also
fast-forwarded to that exact tested revision. No new Glass Home package is needed.

## Repositories and branches

- Runtime: `pponce/vetro`, `combined/runtime-wrapper-observation-20261103`.
  Installed head: `6104eeaa7507d10f28edb68f08e37cff4d627aa5`.
  Previous baseline: `542fd3da54fafc2bb01a6b3eb5665869beda9f0f`.
- Host updater: `pponce/vetro`, `combined/runtime-wrapper-inspection-20261103`.
  Current recovery: `tools/run-input-recovery.sh`; no further install is needed.
  Completed installer: `tools/run-service-ownership-update.sh`, targeting `6104eeaa`
  from `542fd3da` and pinning CI run `41962819197`. Its four unchanged helpers
  remain pinned to `fc7b8663a7708e85a1f3427bfb62b001a2442345` with SHA-256
  verification. It does not ask the owner to submit another permission request.
  The earlier entry point `tools/run-screen-auth-check.sh` preserves the running
  screen by default and finishes only the recorded input handoff. That handoff
  is now verified. The explicit `--inspect-screen` mode captured a healthy run,
  but forcibly stopping/relaunching the screen changes the normal exit path.
  `tools/run-screen-lifecycle-watch.sh` provides passive process/service and
  published-credential observation during manual operation. Its current helper
  checks `6104eeaa`; the immutable `610841c6` host-tools revision retains the
  earlier watcher for installed baseline `542fd3da`.
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
3. Keep runtime `542fd3da` installed. Run `run-screen-lifecycle-watch.sh` while
   manually closing/reopening Vetro. It starts no app, stops no process and needs
   no SDB/TV-Store relay. Optional numbered markers correlate user-visible
   closure, blocked reopening, error and green states. Review process lifetimes,
   service restarts and loopback acceptance of the published credential before
   changing either exit handling or authentication. Do not use an inspector
   relaunch to replace this observation; that can clear the state under study.
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

## Two current-state captures after installation

Evidence: `screen-auth-20261105-012946-877239.json` and
`screen-auth-20261105-013029-723511.json`.

- Both captures complete without errors and show the same clean `542fd3da`
  service, unchanged service start timestamp and ready security storage.
- Input was already connected in filter mode, with the saved enabled state and
  Home assignment ready, before either capture. Both handoff records are now
  verified, observation is cleared, and `resumeRequested` remains false.
  The script did not repair or restart input; it confirmed automatic restoration.
- The owner opened Vetro late in the first run. At the 15-second sample the
  service lifecycle request count changes from two to three, with no service
  restart. This is a lifecycle callback count, not an HTTP request count.
- The second run starts with Vetro visible after a failed diagnostic attempt;
  the owner then observes successful diagnostics. Between the zero- and
  five-second samples, private credential publications change from nine to ten.
  A scheduled credential refresh is a plausible lead, not an established cause
  of the observed recovery. Exact screen failure/success times were not captured.
- Both reports still have `screen:null` and zero received widget diagnostic
  messages, even though the owner saw good screen diagnostics. Absence of this
  separate telemetry is not proof that screen HTTP authentication failed.

Do not repeat the current-state collector to try to establish the missing
screen sequence. The existing explicit inspector mode observes page flags and
request completion counts and tests cached versus freshly read credentials for
status and pairing without exporting them. The authentication reliability issue
remains open; no additional runtime patch or installation has been made.

## First direct screen capture: fast authentication verified

Evidence: `screen-auth-20261105-014221-470724.json`. Capture completed without
errors. Installed private-reader, publisher and authentication source hashes
match exact runtime `542fd3da`.

- At the zero-second sample the page is still running its startup checks; by
  the five-second sample it has an authenticated summary with no screen or
  pairing error. The first `/status` request completed about 1.455 seconds after
  page initialization. There was one startup run (`screenEpoch:1`) and no
  manual OK press during the capture.
- At 60 seconds there are 13 completed screen requests and 31 pairing-poll
  requests. Automatic screen refresh continues at approximately five-second
  intervals; authentication remains true throughout the completed samples.
- A freshly read private credential returns HTTP 200 for `/status` and
  `/auth/pending`. The cached credential differs from the fresh one and also
  returns HTTP 200 for `/status`. Rotation from publication five to six therefore
  coexists with a working cached credential in this run. This does not reproduce
  the earlier persistent 401 or establish its cause. No new pairing was created.
- Input is healthy before and after the capture; no resume request is issued.
  The owner reports that the subsequent normal-mode screen reopening also
  reaches green quickly. The report's final service-side screen telemetry is
  unchanged from the debug startup, so the normal-mode result is owner-observed,
  not a separate fresh telemetry confirmation.
- The service start timestamp is `2026-11-05T01:33:08.066Z`, compared with
  `2026-11-05T01:12:28.729Z` in both earlier current-state captures. Thus the
  service restarted between the earlier and later tests, before this inspector
  capture. `serviceRestartObserved:false` only means it did not restart during
  this capture. The script did not request a service restart. The trigger remains
  unknown; ask whether the owner restarted the TV or Vetro around that time.

This is a verified healthy run on the installed code, with a useful changed
service-lifecycle condition. It is not proof of a permanent authentication fix.

## Normal exit/reopen recurrence and next observation

After the healthy inspector run, the owner repeatedly observes normal exit
followed by an interval in which Vetro cannot be opened. Opening and closing
TV-Store sometimes precedes successful reopening, but does not reliably restore
it; later reopening also succeeds without opening any other app. One attempt
shows a launch-time "please wait a moment and try again" popup, followed by a
successful next attempt. Reopened Vetro can again show the service/authentication
error, then recover to green shortly afterward. Keep launch refusal and the
subsequent HTTP authentication failure distinct until evidence links them.

The screen source has no deliberate reopen cooldown. Its normal Back handler
calls `tizen.application.getCurrentApplication().exit()`. A healthy hidden screen
can also call `exit()` from its visibility handler. The successful inspector
script instead used `app_launcher -k` before both debug and normal launches, so
those successes do not validate the normal Back-exit path. No failure cause or
appropriate code change has yet been established.

`watch-screen-lifecycle.py` samples for three minutes using existing owner
pairing. It reads the diagnostic envelope and a bounded process inventory. It
looks for the fixed widget credential filename only within the Vetro package's
known directories and tests that record against loopback `/status` and
`/auth/pending`. The credential goes to curl over stdin; it never appears in
argv, stdout, stderr or saved output. Only expiry/file metadata and HTTP codes
leave the TV. The script launches/stops no app, changes no input or grants,
and starts no pairing. The screen's cached credential is not directly observed.
Process classification and directory discovery are best effort; absence does
not prove a process is terminated or a credential is missing. Sampling itself
can affect timing. Optional terminal markers store only known event labels.

Local tests cover the actual shell probe with an isolated credential fixture,
no credential in curl argv/output, invalid-token refusal, result allowlisting,
exact revision checks, read-only route use, and pinned runner hashes. The helper
captured the normal-exit failure in `screen-lifecycle-20261105-031901-479063.json`.

## Credential ownership fix ready for device testing

The new capture has 33 samples, no errors and no terminal markers. User timing
places successful reopening at 82–87 seconds after about 15 attempts and another
close near 142 seconds. File modification epochs 1793848705 and 1793848825 carry
credentials rejected with 401; epochs 1793848749 and 1793848869 are accepted with
200. Each pair is separated by 120 seconds. Serving publisher counters advance
53→54→55 only for the accepted sequence. Service PID 16051/start time stay fixed.
Future expirations and direct fresh-file probes exclude expiry and an explanation
limited to a stale screen cache.

Screen candidate PID 31659 persists through 82 seconds (state D at 65–82), then
PID 10007 appears at 87 seconds. The latter remains present after the reported
close near 142 seconds. The process/worker writing the rejected file and the
reason the screen process lingered are not established. No intentional cooldown
or requirement to open TV-Store is established.

The runtime correction and reproducible real-port-conflict test are documented
in the runtime branch's `notes/service-listener-ownership-handoff.md`. Twelve
targeted suites passed locally; complete application/integration/host checks,
permissions UI, launcher and combined packaging passed for exact runtime
`6104eeaa7507d10f28edb68f08e37cff4d627aa5` in run `41962819197`.

The current updater reuses the certificate and input-preserving helper workflow,
submits at most one installation, preserves earlier records and prints the
report's Mac rsync command. Runner SHA256:
`14bb26750dc17cffddd8c27aeb4a416f8194243efc1c756e8e5481c9901ed962`.
The passive watcher is also repinned to the new runtime; its seven tests pass.

Next: run the new updater, verify service/screen/input and then test normal Back
exit and immediate reopen, repeating after two minutes. Confirm Glass Home's
saved permission still permits refresh and app launch. If reopening still
blocks, use the passive watcher and targeted process wait/exit evidence. Do not
claim a TV fix from CI or replace normal-exit testing with inspector relaunches.

## Ownership update installed; input resume failed

Superseding the installation instructions above:
`connection-report-20261104-194518-737306.json` verifies clean runtime and screen
`6104eeaa`, a received private session, completed screen checks and authenticated
service access after 10.2 seconds. One early URL read failed. The service's
launch callback timed out after eight seconds, but service reach and screen
authentication succeeded. This capture does not verify authentication across
multiple credential renewal periods.

Input was a connected filter with saved enablement and Home ready before update.
Observation was confirmed and the old filter (PID 20075, start ticks 2531060)
exited. After the update, the handoff passed its service/root check, set
`resumeRequested=true` and failed inside the resume request with HTTPError.
The updater did not retain the HTTP code/body, so the cause is unknown. Do not
label this as a 401 or claim a particular input startup race from this report.
The screen reported input enabled, disconnected and not recovering.

The user subsequently exited the screen, could not immediately reopen it,
then could reopen after waiting. The remote-input error remained. The normal
reopening issue therefore persists on `6104eeaa`; TV-Store was not required.

Next entry point: `tools/run-input-recovery.sh`, with the pinned host revision.
It uses existing owner access and the existing input handoff journal. It waits
30 seconds for automatic recovery including while mode is off, and preserves an
already healthy filter. Before a single optional resume, it checks root/service
revision, saved enablement, current recovery state and bounded helper/socket
evidence. It refuses a competing or unverified helper. It records HTTP status
and allowlisted input errors, then verifies resulting state without replaying
an uncertain request. It does not install, relaunch an app, pair, kill processes
or change saved mappings. The existing diagnostic-update lock prevents overlap.

Nine local recovery tests passed: healthy-state preservation, off-mode automatic
recovery, one guarded resume, HTTP-error capture with successful subsequent
verification, unsuccessful resume without replay, secret redaction, active/foreign-helper refusal, journal/revision/
preference guards, and owner-access refusal without pairing. This tool has not
yet been run on the TV. Its report prints the Mac rsync command.

After restoring input, capture the normal screen exit wait state separately.
Do not submit another package until new evidence supports a runtime change.

## Input recovery capture; cold-start verification next

`input-recovery-20261105-035826-818160.json` did not recover input and did not
submit a resume request. All eight state samples have root connected, saved
input enabled, input off/disconnected and Home not ready. They retain the
allowlisted native-bridge error `input helper disconnected; original keys
released`. There were no HTTP request errors in this capture. The recovering
flag is false at 0–30 seconds and true in the final read at 42 seconds, after
the process audit. That final retry flag caused the guard to stop; it is not
evidence of successful recovery.

The bounded process audit found filtering helper PID 20554/start ticks 3059504,
input node event6, callback port 42783, an established loopback connection and
listener owned by service host PID 16051. The latter has the same process start
ticks 1071660 as in the earlier normal-reopening capture, despite the newer
module's start time/revision. Samsung's runtime can host service workers; the
PID identifies the host process, not an individual JavaScript service context.
The audit spans time and is non-atomic. It does not distinguish a competing
worker from a helper that starts and disconnects between HTTP samples, and it
does not directly prove which descriptor holds an exclusive input grab.

Next recovery step: one Samsung cold restart, then open Vetro once and allow
background startup to settle. This clears existing runtime contexts/helpers
and tests the installed `6104eeaa` code from a clean boot. A surviving older
context is a hypothesis, not an established cause. Preserve the installed
package, pairing, permissions and saved remote mapping; no factory reset,
Smart Hub reset, firmware update, process kill or new installation is proposed.

After startup, use the pinned input-recovery runner to verify the recorded
handoff. Test normal Back exit/reopen separately after input is verified. If the
helper still disconnects following a cold boot, capture bounded native helper
failure markers and correlate them with input attempts before making another
runtime change. Reopening delay remains unresolved.


## Cold boot restores saved input without a resume request

The user reports that Vetro passed its TV checks very quickly after a cold boot.
The pasted output for `input-recovery-20261105-160845-206224.json` shows the first
read as `mode=filter`, `connected=True`, `Home ready=True`, `recovering=False`,
followed directly by the verified result. The pinned recovery code therefore
completed through its already-healthy path; it did not submit an input resume.
The JSON report itself has not been attached or reviewed in this session.

This verifies automatic restoration of the saved input/Home setup after the
cold boot. It supports a transient or resident-runtime explanation for the
pre-boot failure, but does not identify an old worker as the proven cause or
establish that future package updates can safely omit this recovery step.

Next device tests: normal Back exit followed by immediate reopening two or
three times; then leave the screen visible for at least three minutes to span
a private-credential renewal. Check for prompt reopening and sustained passing
authentication/input status. Glass Home's saved permission across update/boot,
app refresh and app launch remain to be verified. No new installation or runtime
change is prepared from this success alone.
