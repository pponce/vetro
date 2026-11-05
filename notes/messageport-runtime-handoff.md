# Current checkpoint: input conflict, Glass replies and power-on inspection

## Installed source and verified progress

Installed Vetro remains `95098ef5a6f472f49a542d8737d291fd65d6168b`, candidate
branch `combined/runtime-wrapper-observation-20261103`, all four CI jobs passed
in run 41782387008. No application code has changed during this inspection.
The private-storage screen bootstrap and browser pairing are hardware-confirmed.
The TV screenshot reports service running, root connected and launcher running.
The user subsequently reran full checks and reports TV APIs available.

## Remote-input evidence

The saved Smart Control 2016 binding pointed to event4, now an AUTO_MODE_DEVICE.
Current same-name candidates were event6, event18 and event19. Vetro resolves
by name and key capabilities, so the stale saved path alone does not identify
the failure. The native log reported EVIOCGRAB on event6 failing with errno 16
(EBUSY). A read-only process inspection found enlightenment and a Vetro-owned
SamsungTvRemoteInputAgent.dll process with event6 open. The helper was in filter
mode for Home code 63. An open descriptor is not proof of exclusive ownership.

The inspection's escaping mangled displayed zeros and its final awk failed.
The earlier read-only inspection did not modify a process. A guarded single-PID
restart was prepared but NEVER DELIVERED OR EXECUTED: the user chose a cold boot
instead. Do not reuse pre-boot process IDs. The post-boot input outcome has not
been supplied yet.

Current helper source AND packaged DLL already poll callback disconnect while
input is idle and release evdev/uinput resources on return. No missing native
watchdog was established. The current launcher never acquires EVIOCGRAB.
Service lifecycle stop only cleans app communication; physical input/timer
cleanup is a separate potential lifecycle gap, not a proven hardware cause.

## Glass Home app permissions

Glass Home branch `combined/vetro-permissions` remains
`195e499e76ad4e9297c9962ce4347ad16bdb20be`. The user approved it in Vetro,
then observed Checking Vetro followed by Vetro did not respond / saved app list.
Refresh apps performs access.status followed by paginated apps.list. Its SDK
times out after 15 seconds if no reply passes service-ID/port/framing checks.
Approval is persisted server-side; this protocol issues no app credential.
The shared service MessagePort reply path remains unresolved for external apps.
Do not equate successful Vetro-screen HTTP pairing with Glass reply delivery.

An asymmetric MessagePort-request / HMAC-authenticated HTTP-result protocol was
reviewed ONLY AS A DESIGN. Nothing was implemented or published. Requests would
retain native caller identity, installation/signer and scope checks; per-call
CSPRNG IDs/secrets would authenticate exact response bytes without sending the
secret over HTTP. Bounds, duplicate suppression, revocation invalidation, and
no retry of uncertain mutations are required.

A major feasibility issue remains: Glass already handles cross-package loopback
isolation in app/service/vetro.js. Its own authenticated local-service proxy
might be needed; direct widget-to-Vetro loopback is unverified. Its TV-local
address fallback would need an explicit receiver policy. Do not implement or
claim this design working without settling that path and its trust boundary.

## Power-on inspection requested by user

Confirmed in startup-app.js and main.js:
- Startup requires the remote input policy to be connected AND in filter mode,
  with input not paused. Missing or broken remote filtering can block startup.
- Cold boot has 10 seconds from Linux uptime, not from service readiness.
- Standby wake has 20 seconds; the monitor must settle for 1 second. Input restore
  polls every 5 seconds and itself depends on root readiness.
- Expiry consumes that power-on attempt; later root/input recovery does not
  launch late. Remote/navigation/app/source guards also intentionally cancel.
- The UI still describes 10 seconds for both cases, although wake uses 20.

Executed the actual StartupApp class with an in-memory filesystem:
first cold-boot observation at uptime 12 s, with root/monitor ready, yields
zero launches and Skipped: power-on launch expired before Vetro was ready.
Early boot with monitor unavailable yields zero launches and
Skipped: power-on launch expired; remote activity monitoring was not ready.
These reproduce code behavior; the TV's latest actual skip reason is pending.

A suspected return-navigation command escaping defect was explicitly retracted:
direct execution produces newline byte 10 and a matching PID header. No fix is
needed on that evidence.

Next: read authenticated GET /startup-app and GET /input together from the paired
dashboard. Inspect lastResult, event.kind/phase/timing, current input policy and
Home readiness. Establish whether cold boot cleared the input conflict and which
guard skipped the latest startup before selecting a correction. Preserve the
user-navigation protection and do not simply remove monitoring or add late
unbounded retries. Glass replies remain outstanding alongside startup/return.

## Previous checkpoints

# Hardware milestone: screen authentication and browser pairing verified

## Current state

Installed revision: `95098ef5a6f472f49a542d8737d291fd65d6168b`.
Report: `connection-report-20261103-220425-655360.json`.
Both service and screen report this revision; service sourceDirty is false.
The private bootstrap is ready with no error. The screen reports
sessionReceived=true, serviceAuthenticated=true, serviceReach.ok=true,
summaryReady=true, screenError="" and pairingError="". Collection completed in
9.1 seconds. The user subsequently confirmed successful browser pairing.
The screen/service authentication and browser-pairing blocker is resolved on
the TV using the package-private file transport.

MessagePort repliesSent=0 is expected for this screen path and is not a failure.
External-app MessagePort replies remain unverified. The report's unauthenticated
collector response still says to pair the requesting device; it does not negate
the screen's authenticated requests or the user's successful browser pairing.
The install command returned zero without a recognized installation response;
matching live revisions prove the update. Author certificate unchanged=true.

## Remaining work

The serviceLaunch callback still times out after eight seconds. Source review
confirms the bounded check continues to authenticated reach/readScreen calls,
and the root/launcher rows depend on the returned service summary, not that
callback. This is a separate lifecycle item, not a current authentication block.

The user reports other errors and will provide a screenshot. The connection
report deliberately omits the full /screen summary, so it cannot establish root,
input or launcher state. Do not infer these errors from the callback timeout.
Next: review the screenshot, then use the now-paired dashboard's diagnostics to
inspect the actual remaining failure. Verify root, saved settings, external-app
permissions, startup/return and full inventory before combined acceptance.
No additional installation is required to establish this milestone.

Repository/branch details, design, all four passing CI jobs (41782387008) and
previous decisions are retained below. Preserve report/attempt records, existing
certificates/settings and strict app identity checks. Use documented APIs first.

## Historical checkpoint before hardware validation

# Private-storage screen bootstrap checkpoint

## Current decision and implementation

The user requested a different approach after the public MessagePort factory
correction still failed to authenticate the TV screen. Implemented a screen
bootstrap through the documented package-private filesystem, without depending
on a MessagePort response. The public-factory correction remains in app-access
replies; external-app hardware delivery remains a separate unresolved item.

Ready candidate: `95098ef5a6f472f49a542d8737d291fd65d6168b` on
`combined/runtime-wrapper-observation-20261103`. All four jobs passed in
[Source checks 41782387008](https://github.com/pponce/vetro/actions/runs/41782387008):
application/integration checks, permissions UI, native launcher/updater, and the
full combined diagnostic package. This candidate has not been installed yet.

Latest installed source: `3c6af03d0da3c1e68bd50e925f9ddf118e06d99d`.
Latest report: `connection-report-20261103-213130-637793.json`.
Both clean service and screen revisions match. There are 47 accepted connections,
47 issued sessions, 47 send calls returned, zero send errors, and zero screen
sessions. This proves removal of the native type exception, not delivered or
authenticated replies. The report has no ordinary receive/reject telemetry.
The launch callback still times out after eight seconds. Settings, root, browser
pairing, startup/return and complete inventory acceptance remain unverified.

## Private bootstrap design

The service resolves wgt-private using Tizen's Filesystem API and atomically
publishes `vetro-widget-session.json`, mode 0600. Each publication contains a
random five-minute widget credential; renewal every two minutes retains valid
prior credentials until expiry. Credentials are independent of the MessagePort
session limit and are invalidated when the service stops or restarts. Failed
publication revokes private credentials and reports a fixed error category.
There is no shared-directory or temporary-directory fallback.

The screen uses documented resolve/readAsText calls for that fixed private file.
Reads are bounded by size and timeout, and validate schema, token format and
expiry. The existing local HTTP gate and limited widget routes remain enforced;
this credential cannot authorize owner operations or requests from LAN clients.
No token, pairing code or file content is included in diagnostics. The existing
MessagePort sender checks for third-party app permissions remain unchanged.

Samsung documents wgt-private isolation. TV-Store v0.3.17 provides a concrete
service-to-screen private-file precedent: its service writes an upload key into
package data, and its screen reads that key through wgt-private. This supports
the design choice but does not prove Vetro's hardware success.

- https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/filesystem-api.html
- https://github.com/Apps2Samsung/TV-Store/blob/v0.3.17/tizen-app/service/index.js
- https://github.com/Apps2Samsung/TV-Store/blob/v0.3.17/tizen-app/js/app.js

## Completed validation and next step

New integration tests authenticate real HTTP requests and complete browser pairing
while every MessagePort creation is unavailable. Tests cover file mode, expiry,
renewal overlap, restart, corruption, failed atomic writes, symlinks, inaccessible
storage, scoped routes, rejection of remote clients, and credential-free telemetry.
The existing UI, authentication, lifecycle, transport and diagnostics suites pass
locally. The package manifest includes both bootstrap modules.

The collector now distinguishes reading a credential from authenticating a service
request (`screenServiceAuthenticated`). For this transport, collection ends when
matching screen checks finish, including failure, without waiting for a reply
matrix that cannot run. `complete` describes collection, not authentication.

Next: use the existing single-attempt update helper with target
`95098ef5a6f472f49a542d8737d291fd65d6168b`, CI run `41782387008`, and
expected-before `3c6af03d0da3c1e68bd50e925f9ddf118e06d99d`.
The complete SSH update block was checked for Bash/Python syntax; the pinned
helper SHA256 is
`f0f8d63aff380764b53c54437cc09d16b3794a1f36d0602db82259954ece3555`.
Require widgetBootstrap.ready, screenServiceAuthenticated=true, actual code display
and browser pairing. Native repliesSent may remain zero because the screen no
longer uses that reply path. Then verify root/settings and resume combined
permissions/startup/return acceptance. No additional update has been installed yet.

Repositories: Vetro `pponce/vetro`; authoritative branch
`combined/permissions-startup-return` remains at historical baseline `35ebe185`.
Candidate branch: `combined/runtime-wrapper-observation-20261103`.
Host helper: `combined/runtime-wrapper-inspection-20261103`, pinned helper
`6dbf1971d0694edfd9e58973c54c58f751219d90`.
Glass Home: `pponce/glass-home-samsung-tv`, branch `combined/vetro-permissions`,
revision `195e499e76ad4e9297c9962ce4347ad16bdb20be`.

The user authorized broader changes and updates. Preserve all attempt records,
certificates and settings. Do not repeat uncertain installs. Undocumented
compatibility patches still require explicit approval; this change uses public
filesystem APIs and does not unwrap or alter platform objects.

## Historical checkpoint before the latest hardware result

# MessagePort reply correction checkpoint

## Objective and current state

Restore authenticated TV screen/service communication and pairing, then verify
combined permissions, startup, return, root access, saved settings and inventory.

Correction candidate: `3c6af03d0da3c1e68bd50e925f9ddf118e06d99d`, with all four
jobs successful in [Source checks 41777920870](https://github.com/pponce/vetro/actions/runs/41777920870).
It is ready for a single recorded hardware update; it has not yet been installed.

The installed diagnostic revision is
`d2b031cc8f44bff8e23ac03741fb6ceb5fa21935`. Both screen and service verified this
revision in `connection-report-20261103-210159-587556.json`; sourceDirty is false.
The installer exited zero without a recognized confirmation, but subsequent
runtime verification established the update. Do not repeat that installation.
The author certificate was unchanged. Preservation of all saved settings is
still unverified.

That capture has 11 accepted connections, 11 issued widget sessions, zero sent
authentication replies and 11 reply errors. sessionReceived, pairingVisible and
summaryReady remain false. The service starts and handles requests; the separate
screen launch callback check still times out after eight seconds.

## Repositories and branches

- Vetro: `pponce/vetro`.
- Authoritative branch: `combined/permissions-startup-return`, baseline
  `35ebe18507f9ea289c76d8920ad0bdd4e2bde191`.
- Installed diagnostic / correction branch:
  `combined/runtime-wrapper-observation-20261103`.
- Host inspection/update tools: `combined/runtime-wrapper-inspection-20261103`,
  helper revision `6dbf1971d0694edfd9e58973c54c58f751219d90`.
- Earlier diagnostics: `combined/connection-report-20261103`.
- Glass Home: `pponce/glass-home-samsung-tv`, `combined/vetro-permissions`,
  `195e499e76ad4e9297c9962ce4347ad16bdb20be`.

## Runtime evidence and correction

The service read `/usr/share/wrt/app/service/service_runner.js` successfully with
ordinary Node filesystem access: 21,406 bytes; SHA256
`ca78bf27b775c3fcc10b5b2361e2a843fe57dea3f957057f8c73d219a1592259`.
This is candidate source, not proof that every byte is the loaded runtime.
Captured live wrapper methods independently support the relevant behavior.
Do not commit the firmware source or raw connection reports.

The native callback RemoteMessagePort rejects the service LocalMessagePortRouter
as the second send argument. The public requestRemoteMessagePort factory returns
an outbound wrapper whose send method performs the local-port conversion before
calling the native sender. The fresh wrapper has messagePortName, but appId and
isTrusted are undefined; those two mismatches explain the diagnostic lookup
rejection and seven skipped rows.

The correction changes the common reply function to request its outbound port
through requestRemoteMessagePort or requestTrustedRemoteMessagePort, chosen from
the validated incoming callback's isTrusted value. The app ID and port name also
come exclusively from callback metadata. Production code accesses no private
wrapper fields or unwrap methods. Factory results must provide sendMessage;
they are not required to repeat the callback metadata absent on this firmware.

Incoming callback validation now requires a nonempty app ID and port name, a
boolean trust flag and a send method. Widget sender ID, trusted receiver setup,
request framing and client response identity checks remain enforced. There is
no raw-send fallback, no no-source authentication fallback and no payload-based
identity substitution. The same reply correction covers app-access success and
error responses.

The local wrapper reconstructs callback targets from platform routing fields.
Their producer/integrity and physical service routing are not fully established
by this JavaScript source. Runtime-model delivery cannot replace hardware sender
identity checks. Do not claim authentication success until the unchanged client
accepts a correctly sourced reply on the TV.

## Validation and acceptance

Nine targeted suites passed locally: app ports, wrapper boundary, widget
transport, comprehensive connection diagnostics, connection diagnostics,
app-access HTTP, service lifecycle, wrapper observations and runtime source reads.
The model reproduces the exact raw-remote/wrapped-local TypeMismatchError and
then exercises public-factory replies. End-to-end client tests derive response
identity from native-model port registration and pass in both plain and wrapped
service modes. Missing/wrong sender metadata, claimed payload identity, failed
factory calls, trusted destination selection and denied app-access replies are
covered. Diagnostic receipts never resolve an authentication request.

The installed diagnostic revision passed all four jobs in
[Source checks 41775045036](https://github.com/pponce/vetro/actions/runs/41775045036).
The correction also passed all four jobs in Source checks 41777920870, including
all application and integration tests, browser interaction, native launcher and
updater checks, and the full combined diagnostic package. Neither the correction
nor actual browser pairing/root/settings has yet been verified on hardware.

## Previous inspection attempts

| Report | Result |
| --- | --- |
| connection-report-20261103-155942-026898.json | Exact native type mismatch; 13 accepted connections and 13 reply errors; two no-source receipts |
| runtime-wrapper-20261103-174008-647225.json | Bounded search reached its directory cap with no source candidate |
| runtime-wrapper-20261103-180354-715512.json | File read failed; next operation rejected an unexpected SDB stream identity |
| runtime-wrapper-20261103-202551-412850.json | Directory listing confirmed the runtime file; SDB RECV explicitly refused the path; search timed out |
| connection-report-20261103-210159-587556.json | Updated diagnostic revision verified; in-service source read and live wrapper observations succeeded |

The collector's channel handling was corrected to isolate each sync operation
and account for late closure of retired channels. Fifteen host collector tests
passed. Subsequent evidence showed the path restriction independently of that
transport issue. Further broad SDB source searches are unnecessary.
Service debug attachment had already failed on three fresh connections; do not
repeat that unchanged attempt. The screen debugger's availability does not prove
service debugger access.

## Decisions and exact next steps

The user authorized application changes, updates and broader necessary work.
Revision 35 is a historical baseline, not an installation hold. Use documented
APIs first; an actual undocumented compatibility patch still needs explicit
approval. This correction uses the documented public factory and send API.
Preserve all attempts and reports. Do not uninstall, regenerate certificates,
reset settings, or retry an uncertain installation automatically.

1. Correction commit `3c6af03d0da3c1e68bd50e925f9ddf118e06d99d` and CI run
   `41777920870` are ready. All four required jobs passed.
2. Use the existing update helper with that exact commit and CI run, setting
   expected-before to `d2b031cc8f44bff8e23ac03741fb6ceb5fa21935`.
   The helper reuses the cached Partner certificate and records one installation
   attempt per target revision. A rerun only collects evidence.
3. Verify matching clean service/screen revisions, repliesSent > 0 and
   sessionReceived=true. A completed report or successful no-source probe is
   not an authentication pass.
4. Verify actual code display and browser pairing, then root and saved settings.
   Resolve the separate launch callback behavior and finish startup/return and
   full inventory acceptance before merging the correction into the
   authoritative combined branch.

## References

- [Samsung MessagePort API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/messageport-api.html)
- [Tizen SDB sync implementation](https://github.com/TizenTeam/sdb/blob/master/src/file_sync_client.c)
- [Apps2Samsung SDB engine](https://github.com/PatrickSt1991/tizen-sdb/blob/master/src/TizenSdb.Core/SdbClient/SdbTcpDevice.cs)
