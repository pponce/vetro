# MessagePort runtime inspection checkpoint

Objective: restore authenticated screen/service communication and pairing, then
verify the combined permissions, startup, and return work.

## Repositories and baseline

- Vetro: `pponce/vetro`, authoritative branch `combined/permissions-startup-return`.
- Installed and authoritative source: `35ebe18507f9ea289c76d8920ad0bdd4e2bde191`.
- Inspection-only branch: `combined/runtime-wrapper-inspection-20261103`.
- Earlier diagnostic branch: `combined/connection-report-20261103`.
- Glass Home: `pponce/glass-home-samsung-tv`, `combined/vetro-permissions`,
  `195e499e76ad4e9297c9962ce4347ad16bdb20be`.

## Evidence and completed work

The reviewed capture recorded 13 accepted connections, 13 issued widget sessions,
13 reply errors, and zero authentication replies. Its exception is
`TypeMismatchError: Cannot convert LocalMessagePortRouter to LocalMessagePort.`
Two no-source diagnostic messages reached the screen without sender metadata.

The captured native send validator requires its own LocalMessagePort class.
The service API returns a LocalMessagePortRouter. The captured listener takes a
single callback argument, removes `org_remote*` fields, and constructs a raw
remote port from `org_remote_app_id` and `org_remote_port`. The origin and integrity
of these routing fields have not been established. Do not infer authenticated
native sender identity solely from this reconstructed object's appId.

The existing transport mocks accepted arbitrary source objects and missed this
boundary. The new characterization test exercises the unchanged reply function
with separate native and wrapper classes. It reproduces the exact exception for
widget replies and both successful and denied app-access replies. It also covers
refreshed wrapper handles and missing/mismatched client metadata.

The report discards fresh remote metadata when its guard fails. Separate fixtures
demonstrate that different mismatched properties all yield the same seven skipped
rows. None establishes the actual fresh object's properties on hardware.

`tools/inspect-messageport-runtime.py` uses a single relay connection and standard
SDB sync LIST/RECV operations. It checks the installed revision and idle relay,
searches bounded system runtime directories, and reads only service_runner.js
candidates. It creates no keys and opens no shell. It reports refused or partial
reads and does not equate retrieved candidate source with the loaded runtime.
No runtime correction, TV installation, or application source edit is included.

## Validation

Locally passed: new wrapper-boundary characterization, existing app-ports,
widget-transport, and comprehensive-connection-diagnostics suites; eight Python
collector tests including fragmented frames, real socket exchange, invalid stream
metadata, read limits, refusal of writes/unrelated files, and partial reports.
These are host/model tests, not hardware success. Consult the inspection branch's
Source checks run for full repository CI results.

## First hardware source inspection

The first inspection report verified the installed revision and reached 600
directory replies with no source candidates. `searchLimitReached=true`; there
were no explicit errors. This does not establish that the source is absent or
inaccessible. SDB can return an empty directory response for a failed opendir,
so the reply count also does not establish access to 600 existing directories.

The collector now attempts `/usr/share/wrt/app/service/service_runner.js` before
walking directories. This concrete candidate is in the stack fixture in
`SushyDev/tizen-homebrew`, commit `f90b005c8c354cafc027f12b37fe04b6cf0162f2`,
`service/test/log.js`; it is not yet confirmed on this TV. Fallback search gives
WRT and Node directories priority and accepts a service_runner.js file symlink.
Reports now include each source attempt and bounded remaining-directory samples.
Ten collector tests pass, including direct-read short-circuiting, runtime subtree
priority, symlink source retrieval, and explicit reporting of the directory cap.
No application/service changes or installations are included.

## Targeted inspection transport failure

`runtime-wrapper-20261103-180354-715512.json` verifies the same running revision.
Its direct source request returned a sync FAIL, recorded as missing-or-refused.
The first fallback directory request then stopped with
`Unexpected SDB stream identity`; no directory reply or source was retrieved.
The collector discarded the FAIL text and did not retain frame identifiers.
This report therefore cannot distinguish missing source from access denial, or
identify the exact frame that triggered the transport check. A close of the first
sync stream is a possible explanation, not an observed frame in this report.

The collector now opens a fresh sync stream for each LIST/RECV operation over
the existing connection, following the SDB client's per-operation channel use.
It accepts delayed empty close/ack frames only for known retired streams and
keeps both identifiers strict for active data. A complete FAIL remains readable
even if it precedes a separate request acknowledgement. Schema 3 retains bounded
file-error messages, the last 48 transport frame headers without payloads, and
matching entries from search-root directory replies.

Fifteen collector tests pass locally. They include a real socket exchange with a
failed RECV, peer closure, and successful LIST on a new channel; late close/ack
orders; rejected foreign-stream data; and retention of both the original file
error and a subsequent transport failure. These validate host behavior only.
The revised collector has not yet been run on the TV. The application remains at
the installed revision, with no runtime workaround or installation included.

## Confirmed source path and SDB download restriction

`runtime-wrapper-20261103-202551-412850.json` verifies the same running revision.
The directory reply for `/usr/share/wrt/app/service` lists `service_runner.js`
as a regular file, 21,406 bytes, mode 0644. The direct RECV request returned
`You cannot pull files from this path.` This identifies an SDB path restriction;
it does not establish whether the application process itself may read the file.
No runtime source was retrieved, and the loaded implementation remains unknown.

The collector completed 484 directory replies (467 nonempty, 17 empty) out of
485 attempts before a TimeoutError at 90.001 transport seconds. This matches its
90-second budget; the directory-count cap was not reached. The retained frames
show successful exchanges on new channels and delayed zero-sender CLSE frames
for retired channels. The earlier stream-identity error did not recur in this
capture. An increased timeout would not resolve the explicit RECV restriction.

The earlier Apps2Samsung service-debug attempt also failed: the TV closed the
debug-start connection for `vetrotvapp.svc` on three fresh connections. The screen
debugger was available, but that does not establish service-debugger access.
Do not ask for another identical service-attach or broad SDB source scan.
Repository and web searches found no matching published wrapper implementation.

An unapplied proposal is saved at
`notes/proposals/observe-messageport-wrappers.patch`. It captures the local wrapper
constructor and the fresh remote wrapper's constructor/send method, plus bounded
metadata and equality checks before the existing guard can reject the object.
It reads no new filesystem paths and introduces no new send path or probe.
Known credentials and dynamic reply-port names are scrubbed from the new fields.
It does not read or pass through `messagePortObj`.

Validation: `python3 notes/proposals/validate-wrapper-observation.py` applies the
proposal only inside a temporary local fixture. The added observation suite and
four existing suites (wrapper boundary, comprehensive diagnostics, app ports,
widget transport) pass against that fixture. These tests do not establish a
working correction or hardware delivery. The proposal has not been applied to
application sources, packaged, installed, or submitted as an upstream fix.

## Decisions and next steps

Ready diagnostic source: `d2b031cc8f44bff8e23ac03741fb6ceb5fa21935`, branch
`combined/runtime-wrapper-observation-20261103`. All four jobs passed in
[Source checks 41775045036](https://github.com/pponce/vetro/actions/runs/41775045036):
application/integration/source checks, permissions UI, launcher, and the full
combined diagnostic package. The first run caught the package-manifest test's
missing entry for the new module; the expected manifest was corrected before
this successful run. No TV update has been performed from this workspace.

`tools/update-connection-diagnostics.py` reuses the saved Apps2Samsung beta CLI
locator, its existing certificate store, the established checkout, and the
`vetro-install/beta-recovery` attempt-record directory. It verifies the clean
baseline and all four CI jobs, creates a detached pinned worktree, validates the
complete package and diagnostic flags, submits at most one install for the
target revision, and collects both screen and service evidence. Six local host
tests pass, including an unresolved CLI result followed by a rerun with no second
installation. It never requests uninstall, a new app ID or certificate creation.
Existing target attempt files trigger collection only and are not cleared.

1. The user authorized changes and the diagnostic update. The installed revision
   is now a baseline, not a hold on updates. Preserve all installation records.
2. The observation proposal has been applied on diagnostic branch
   `combined/runtime-wrapper-observation-20261103`. Its added suite and four
   existing transport/diagnostic suites pass locally. The historical proposal
   and its pre-application validator remain in `notes/proposals` as records.
   The user also authorized broader necessary changes. The build now attempts
   one bounded read of the known runtime file from inside the service, using
   ordinary Node filesystem access. A separate suite covers missing/denied files,
   growth beyond the size cap, non-files, redaction and descriptor cleanup.
   This may recover source that SDB cannot download; success is not assumed.
3. Run full CI and build the complete diagnostic package, then use the existing
   TV-Store relay and cached Partner certificate installation route. Collect and
   verify the new report/revision. Pairing remains blocked pending a verified
   authenticated reply correction; no compatibility workaround was applied.
4. Use captured implementation and metadata to determine the documented outbound
   path, and inspect the producer/integrity of `org_remote` fields. Native-looking
   reconstructed metadata does not by itself establish authenticated identity.
5. Prefer the documented outbound API. Present an exact proposed change and obtain
   approval before applying an undocumented wrapper compatibility patch.
6. Before a correction install candidate, require model tests for authenticated delivery,
   strict sender checks and app-access replies, plus application/integration CI.
7. Hardware acceptance still requires repliesSent > 0, sessionReceived=true,
   code display, browser pairing, root, saved settings, startup/return, and inventory.

## References

- [Samsung MessagePort API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/messageport-api.html)
- [Tizen SDB sync protocol implementation](https://github.com/TizenTeam/sdb/blob/master/src/file_sync_client.c)
- [Apps2Samsung's SDB engine implementation](https://github.com/PatrickSt1991/tizen-sdb/blob/master/src/TizenSdb.Core/SdbClient/SdbTcpDevice.cs)
