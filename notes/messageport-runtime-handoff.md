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
