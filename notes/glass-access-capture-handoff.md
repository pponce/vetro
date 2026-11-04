# Glass Home request capture — 2026-11-04

## Latest capture: early inspector connection drop and startup waiting

`glass-request-20261104-202022-238012.json` again verified the clean Vetro
revision, root connection, Glass service capability 2 and all seven installed
file hashes. The initial SDB handshake and the single debug launch succeeded.
The first fresh connection for `/json/list` was dropped before the TV answered
CNXN; a retry after one second succeeded and returned the Glass Home page.
The next fresh connection, for the inspector WebSocket, was dropped at the same
CNXN stage. That path had no retry and triggered cleanup about two seconds
after the capture started. The user correctly observed that the helper did
not leave enough time for Glass Home to open and for the Connect test.

This is evidence of a capture transport failure, not evidence that the widget
never sent an access request. No inspector attached and no user Connect action
was captured. Relay failures increased from 4 to 6; the report retained frame
headers proving both drops occurred before an SDB service was opened. The
normal UI relaunch command completed. The report still has no pending request,
grant or Glass Home handler event.

The corrected host helper retries a dropped/reset SDB handshake at most twice,
with 0.4- and 0.8-second waits, before opening any SDB service. Authentication,
invalid protocol frames and service-open failures are not retried by that
connection helper. The debug launch itself is issued only once. Inspector-page
readiness and widget startup each have a separate 60-second wait with progress
messages. Widget readiness requires a visible, fully loaded document, the
permission adapter and app-list adapter, and a completed app-list check. The
user's 60-second capture window starts only after that readiness check, at
CAPTURING. The new report records both waits, connection attempts, readiness
samples and actual capture duration. No installed application code changed.

Validation: all 50 local capture, SDB transport and owner-client tests pass.
Cases cover a dropped handshake followed by success, persistent drops, no
retry for authentication or an uncertain debug launch, late inspector-page
availability, hidden/loading widgets, and a 20-second startup followed by the
full capture window. The read-only JavaScript snapshot was also executed
against missing and loaded widget globals. These are local transport/model
checks; the updated helper still needs the TV run below.

## Earlier capture and transport reporting

`glass-request-20261104-200106-317015.json` passed the clean Vetro revision,
root connection, Glass service capability and all seven installed file checks.
The inspector never attached; permission state remained enabled/available with
no Glass Home event or pending request. The normal UI relaunch command completed.
The capture stored only `ReadFailure`, so neither the failed SDB stage nor the
underlying transport reason can be recovered from this report. It supplies no
new evidence about the Connect action itself.

The host helper now records the exact collection phase, allowlisted SDB error
reason, bounded protocol frame headers, and relay counters/error-code timestamps
before and after the attempt. Banners, command payloads and free-form relay text
are excluded. It completes the SDB handshake before stopping the Glass Home UI
and reuses that connection for the single debug launch. A failed preflight leaves
the UI running. No live app code or permissions were changed. Its 42 local tests
passed, including the reproduced closed-handshake case and preservation of its
failure evidence.

Next: run the updated pinned entrypoint. If it stops again, use `failedPhase`,
`transportAttempts`, `debugFrames`/`pageListFrames` and the before/after relay
summary to choose the next step. Do not treat a historical relay failure reason
as proof of a current Developer Mode setting and do not repeat an uninstrumented
debug attempt or reinstall either app.

## Objective and current evidence

Restore Glass Home's owner-approved app list and app launch access, then finish
remote/Home, power-on, return and saved-settings hardware acceptance.

The post-cold-boot report `app-access-20261104-192916-642379.json` confirms clean
Vetro source `ce92708f55211738f3866756e287b5fb634c0b23`, a new service process,
connected input in filter mode and Home ready. The active input helper's callback
connection belongs to the current service. The user reports that remote control
works again. This is a successful fresh-boot observation, not proof that the
intermittent issue cannot recur. The un-timestamped grab-failure log entry cannot
establish a current grab failure.

App permissions are enabled and available, with zero pending requests, zero
grants and zero target-app events. Registry collection accepts Glass Home's
visible, removable user-app record. This diagnostic's longer query budget does
not establish a production permission request. The user selected Connect to
Vetro and saw “Vetro did not respond” while the saved app list remained visible.
No request is available for approval in the supplied capture.

The user explicitly clarified that earlier versions displayed a request and
allowed owner approval, but Glass Home still could not use the approved access.
The user then removed that approval deliberately for new tests. Zero grants is
therefore expected; it must not be described as an unexpected loss or reset.
The new regression is failure to display a fresh approval request, separate from
the older failure to use an existing approval.

## Repositories and branches

- Vetro runtime candidate: `pponce/vetro`,
  `combined/runtime-wrapper-observation-20261103`, `ce92708f55211738f3866756e287b5fb634c0b23`.
- Authoritative combined branch: `combined/permissions-startup-return`; unchanged.
- Host capture tools: `pponce/vetro`,
  `combined/runtime-wrapper-inspection-20261103`, based on `8c96c3ef86fa7a2336d65316b41c76e0942ec7e7`.
  The current helper revision and hashes are pinned in `tools/run-glass-access-capture.sh`.
  The readiness/retry correction supersedes `f3ba2c7d68698540e7b9d30d15f0fee0327f03de`.
- Glass Home: `pponce/glass-home-samsung-tv`, `combined/vetro-permissions`,
  `30c490194f1748d523262a1ac8985fe45f735729`; no new application build prepared.

## Source findings and completed work

The production permission handler records failed calls as well as new pending
requests. The native app port can discard a request before that handler, and
the installed diagnostic does not record those early receive/reject stages.
The current report therefore cannot distinguish a request that was never sent
from a native transport rejection. No identity or signer check was weakened.

Compared the earlier checkpoint (`95098ef5` Vetro / `195e499e` Glass Home) with
the current pair. Both send to the same native app port with the same UI app
identity. The newer Glass client opts into protocol version 2; Vetro adds
version-2 envelope validation and reply-record reservation before calling the
permission handler, and replies move to authenticated HTTP polling. The
version-1 request path remains supported. These added pre-handler steps are a
regression candidate, not an established root cause. Normal revocation is meant
to allow a subsequent fresh request; do not reset permissions or reinstall as
a substitute for identifying the failed stage.

`tools/capture-glass-access.py` uses the existing owner credential and TV-Store
relay. It verifies the clean Vetro revision, Glass Home service capability 2,
and hashes of seven relevant installed Glass Home files. It stops only the
Glass Home UI and starts that UI once using the existing Apps2Samsung debug
command. It attaches the standard Web Inspector, waits for widget readiness,
observes a user-initiated Connect action for 60 seconds, and reopens the UI in normal mode in its cleanup
path. It does not install, pair, grant, revoke, clear settings, alter input or
restart either background service. An uncertain debug launch is not repeated.

The report stores allowlisted widget states, busy observations, local reply-poll
HTTP statuses, inner 404/202/result observations, exception classes and before/
after permission summaries. It omits raw URLs, local keys, reply IDs, MACs,
message contents, names and free-form errors. Observation of a reply body does
not authenticate it; only the Glass Home widget holds the per-request MAC key.
Debug mode may change timing. `captureComplete` means collection completed;
`connectBusyObserved` and the actual samples establish whether the Connect
operation was observed. Neither field asserts permission or hardware success.

The test suite also covers WebSocket framing and size bounds, SDB fragmentation
and interleaved acknowledgement/data, wrong-stream rejection, report redaction,
source/session preflight gates and normal reopen after a failed debug launch.

## Exact next steps

1. Open Glass Home normally once so its service is running. Keep TV-Store's relay
   running, Developer Mode on and the Host PC IP unchanged. Close any other
   Apps2Samsung debug session.
2. Run the pinned capture helper with the existing project root. Let the helper
   reopen Glass Home and finish its inspector/startup waits. At CAPTURING,
   open Glass Home's + panel, wait for Checking apps to finish, then choose
   Connect to Vetro once. Keep Glass Home visible through the capture.
   `tools/run-glass-access-capture.sh` is the complete checksum-verified SSH
   block for this test, with the helper revision and checksums pinned inside it.
3. Retrieve the new `vetro-install/access-diagnostics/glass-request-*.json`
   using the complete rsync command printed by the helper. Return partial
   reports too; do not reinstall to work around a capture failure.
4. Compare widget timeout/state and native handler events to reply polls. A
   poll proves `sendMessage` returned in this client; it does not prove receipt.
   Repeated inner 404 with no handler event narrows the failure to delivery or
   acceptance before a reply record. Inner 202 shows a reply record exists;
   a completed response must be correlated with the widget's verification.
5. If native receive/reject details remain necessary, add bounded app-port
   diagnostics in the fork and test them before another candidate installation.
   Preserve native sender identity, explicit approval and protected-app checks.
6. After connection works, approve only List TV apps and Open TV apps, refresh,
   test one intentional launch and revocation, then resume startup/return and
   settings acceptance. If remote input fails again, collect fresh input/process
   evidence before rebooting or changing anything.

The earlier installation handoff remains at `notes/input-lifecycle-handoff.md`.
No raw user reports or firmware source are committed.
