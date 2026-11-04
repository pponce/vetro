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

## Decisions and next steps

1. Keep the installed revision and all prior installation records.
2. Run the inspection collector from the established project directory with the
   TV-Store relay idle. Keep its JSON report locally and return it for analysis.
3. Compare any retrieved runtime source with the captured function bodies. Inspect
   RemoteMessagePortRouter's constructor, metadata, and outbound send path, plus
   the producer and integrity checks of the org_remote routing fields.
4. If source cannot be read, report the actual access limitation. Do not infer an
   API conversion or run a new installation, key registration, or shell exploit.
5. Prefer the documented outbound API. Present an exact proposed change and obtain
   approval before applying an undocumented wrapper compatibility patch.
6. Before an install candidate, require model tests for authenticated delivery,
   strict sender checks and app-access replies, plus application/integration CI.
7. Hardware acceptance still requires repliesSent > 0, sessionReceived=true,
   code display, browser pairing, root, saved settings, startup/return, and inventory.

## References

- [Samsung MessagePort API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/messageport-api.html)
- [Tizen SDB sync protocol implementation](https://github.com/TizenTeam/sdb/blob/master/src/file_sync_client.c)
- [Apps2Samsung's SDB engine implementation](https://github.com/PatrickSt1991/tizen-sdb/blob/master/src/TizenSdb.Core/SdbClient/SdbTcpDevice.cs)
