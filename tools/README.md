# Install the combined Vetro branch

`install-combined.py` signs a clean, pinned checkout using an existing Apps2Samsung Partner profile and updates the existing Vetro package through the TV's running Vetro root service. It does not install other launcher apps.

The combined branch includes:

- Home-event debounce, so one physical press does not toggle the launcher twice.
- Cancellation of pending Samsung Home closes when Samsung Home is explicitly opened.
- A configurable app shortcut inside the launcher, with Samsung Home as the default/fallback.
- A **Toggle Vetro launcher** remapper action for opening the launcher over the current screen using remote interception. See the [setup guide](../app/docs/REMOTE-LAUNCHER.md).
- One app to open onscreen after cold boot or normal standby wake.
- An independent app to return to when another app falls back to Samsung Home/TV.

Use the supplied installation block on the existing Linux computer. It fetches the pinned combined commit over Git SSH and uses a separate worktree under the existing project directory. It stops rather than overwrite local edits in that worktree.

For direct use from that clean checkout:

```sh
python3 tools/install-combined.py --tv TV_IPV4 --project-root /path/to/samsung-tv-tools --expected-commit COMBINED_COMMIT
```

Optional arguments: `--port` for the current Vetro port, `--installer` for an existing Apps2Samsung CLI executable, and `--report-host USER@LINUX_HOST` to print the report-copy command. No certificate password is accepted as a command-line argument.

## What the installer does

1. Verifies the checkout and current Vetro root connection; reads the launcher's existing state.
2. Checks the TV's local SDB connection and signing identity using a temporary .NET helper outside Vetro's package. This uses the same `/usr/bin/dotnet` runtime as Vetro's root agent. The helper is compiled in the repository, so the Linux computer does not need a .NET SDK.
3. Reads the existing Partner profile, confirms it covers this TV, signs the full integration widget, and checks the package ID, source revision, and native launcher hash.
4. Transfers the signed widget in checked blocks. The TV helper verifies the complete SHA-256 before installation.
5. Starts one detached updater through the existing root service. That updater uses loopback SDB, so Developer Mode's Host PC IP stays unchanged. Its files and process are outside the package being replaced.
6. Waits for the exact new source revision and root connection. Verifies both new app-setting endpoints and the installed launcher DLL. If the launcher was enabled, refreshes it to load the new DLL while retaining its settings.

The TV must remain on during the update. The Vetro dashboard can disconnect while its service is replaced. The updater requests Vetro to reopen afterward; if necessary, open Vetro once with the TV remote while the script continues checking.

The existing app is updated in place. The script does not uninstall it, replace its signing identity, create certificates, change Developer Mode/Host PC IP, change startup or return selections, or make configuration backups. New foreground choices default to off if no previous choice is saved.

The TV helper returns one marked, versioned result separately from runtime messages. The installer validates the operation and required identity fields before proceeding. Missing, duplicate, malformed, or failed results stop the update; surrounding runtime output is not treated as result data.

## If the connection is interrupted

A local attempt record and a TV-side lock prevent duplicate installation. Rerunning the same installation block resumes verification of an unresolved attempt. It does not blindly send another install. Cleanup waits for the detached helper to finish, even if the new Vetro service starts first. Reports stay under the existing `vetro-install/combined-updates` directory; they are not uploaded anywhere.

If the helper proves that installation was never submitted, the report says so and a later run can make a fresh attempt. If the outcome is uncertain, inspect the report and TV state before clearing any attempt record or lock.

To verify a submitted update without signing or installing a package, use:

```sh
python3 tools/install-combined.py --verify-existing --tv TV_IPV4 --project-root /path/to/samsung-tv-tools --expected-commit INSTALLED_COMMIT
```

This requires the matching saved attempt in the same project directory. The installer checkout may be newer than `INSTALLED_COMMIT`; that argument identifies the TV build to verify. A completed record is checked against the running build and root connection.

Verification compares launcher choices with the snapshot taken before installation. If you have changed those choices, inspect the reported differences and add `--accept-current-launcher` to the verification command to retain the current values. This option is available only with `--verify-existing`. An enabled launcher is refreshed; a disabled launcher stays disabled. The installer retains the original snapshot and records the accepted differences separately. Source revision, installed files, root connection and update-lock checks remain required, and another setting change during verification stops completion.

If a reboot removed the temporary updater directory and no TV update lock remains, verification first confirms the exact running revision and root. It uploads a checksum-verified helper to read the installed source revision and launcher hash, checks the app-setting endpoints, and refreshes an enabled launcher while preserving its settings. It then rechecks the running build and absence of update state before completing the local record. It does not recreate an installation job or clear another update's lock. Missing or malformed state inside an existing updater directory remains an error.

## Validation limits

Automated checks cover the .NET helper's source/file hashes, fragmented SDB packets, zero-sender response variants, protocol failures, transfer integrity, certificate selection, package identity, process detachment, one-time dispatch, lost acknowledgements, revision verification, and launcher restart. A cross-language check decodes the C# serializer's result with the Python installer, and a simulated host update covers probe, certificate selection, dispatch, verification, and repeat-run behavior with runtime messages around each result. Test the update and startup/return behavior on each TV model; automated checks do not establish hardware compatibility.

The helper source is in `tools/tv-updater/`. `build-update-helper.yml` compiles and tests changes on the combined branch, then commits only the helper DLL, runtime configuration, and hash manifest. It uses a normal fast-forward push and cannot overwrite a newer branch head. `python3 tools/tv-updater/bundle.py` verifies that the checked-in source and helper match the manifest.

## Combined permissions test build

`update-both.sh` updates the existing Glass Home first and Vetro last. `install-glass-permissions.py` preserves Glass Home configuration, its local service key, and app data; its attempt record checks installed file hashes before any repeat run. Both tools require a pinned, clean source revision and reuse existing signing tools. The Glass Home source revision is pinned in the wrapper.

`vetro_owner.py` handles older unauthenticated Vetro and the new owner-paired API. On an explicit HTTP 401 it prompts for the on-TV pairing code and stores the returned credential in a private host file. It never prints the code or token, uses no proxy, rejects redirects, and never replays a request after a timeout/disconnect. `VETRO_TOKEN` can supply an already paired owner credential. Do not share this maintenance credential with a TV app.

The Vetro installer checks service-side Tizen APIs before installation, saves startup/return observations, and verifies app communication availability after reconnection. App access stays off until the owner enables it. See [combined testing](../notes/combined-permissions-testing.md) and [app permissions](../app/docs/APP-PERMISSIONS.md).

### Pairing and the TV screen

Opening Vetro starts its service, checks for a requested pairing code, and reads
the service summary. Full app/package inventory is optional: press **OK** after
pairing to run it. Some TVs take several minutes in package enumeration; a native
call can block the page's JavaScript thread, including its timeout callbacks.
The initial screen does not enumerate apps or packages, and does not overwrite
the service's previous full diagnostic report.

Connection and trusted-widget errors appear on the TV. An unreadable service
summary is reported as unverified, rather than as proof that the service is down.
HTTP reads have timeouts, and an explicit HTTP 401 clears and renews a stale
widget session once. Pairing still requires the same trusted MessagePort and
widget identity; there is no unauthenticated code or credential endpoint.

The five-minute idle close starts after successful checks. It is disabled while
checks are running, a code is visible, or an error needs attention. **Back** still
closes Vetro. If pairing fails, stop the installer at its prompt; retain its
attempt record and inspect the TV connection before attempting another install.

## Capture a power-on test

After pairing the maintenance tool during installation, select a power-on app,
leave another app onscreen for at least ten seconds, use normal standby, then
turn the TV on using only Power. Wait thirty seconds before capturing:

```sh
python3 tools/capture-power-on.py --tv TV_IPV4 --project-root /path/to/samsung-tv-tools --report-host USER@LINUX_HOST
```

The capture preserves timestamped startup/return results before reading current
foreground, source and monitoring state. It does not navigate, change settings
or start pairing. If the credential expired, pair the maintenance tool before
repeating the test. Reports omit owner credentials, app approvals and remote-key
history. Run the capture before changing selections or testing automatic return.

## Connection diagnostics builds

Set `VETRO_CONNECTION_DIAGNOSTICS=1` when running the chosen package builder to
include limited connection telemetry in an unpaired `GET /status` response.
The response keeps its HTTP 401 or storage-failure HTTP 503 status. Other API
routes, widget credentials, pairing and app permissions retain their access checks.

The `connectionDiagnostics` object identifies the running service source revision,
lifecycle calls, private-storage readiness, listener registration, and counts of
received, rejected and replied-to widget requests. It includes fixed error names
and frame-shape flags. It omits request contents, app identities, pairing codes,
credentials, private paths, device details and command output. Counters are capped
and held in memory for the service's lifetime; no diagnostic files are written.

This telemetry is readable by an unpaired client that can reach the service.
Ordinary builds omit it. Build without the flag to remove its public exposure;
the installed service has no HTTP or runtime-environment switch to enable it.

On the first reply type mismatch, a diagnostic build also records bounded
wrapper implementation text and fresh-target metadata, including rejected
targets. It attempts one read of the fixed system file
`/usr/share/wrt/app/service/service_runner.js`, capped at 128 KiB, using the
service's existing filesystem access. The report includes a source hash and
scrubbed candidate text, or a fixed read-error code. It does not establish which
runtime was loaded. These diagnostic fields are visible to an unpaired status
reader; no file path can be supplied by that reader, and no filesystem writes
or new reply sends are performed by the observation.

## Read service runtime source

`inspect-messageport-runtime.py` collects system `service_runner.js` candidates
through an idle TV-Store SDB relay using Python's standard library:

```sh
python3 tools/inspect-messageport-runtime.py --tv TV_IPV4 --revision INSTALLED_COMMIT --output runtime-source.json
```

The running service must report the exact revision with connection diagnostics
enabled. Keep TV-Store open and close other relay clients before starting. The
collector uses directory listing and file reading operations only, with a
90-second transport budget, directory/depth limits, and a 2 MiB file limit. It
first reads `/usr/share/wrt/app/service/service_runner.js` directly, then
prioritizes WRT and Node directories in its bounded search. A runtime source
file may be a regular file or a symbolic link; actual bytes read remain capped.
Each operation opens its own sync stream over the same relay connection. The
report records attempted source paths, bounded file-error messages, matching
entries from the search roots, and a sample of directories left when the search
limit is reached. It retains the last 48 transport frame headers, without their
payloads, to identify connection or stream failures. An empty SDB directory reply
does not establish that the directory exists or that access was granted.

The collector does not open a shell, create authentication keys, install packages, or change
settings. Output creation is exclusive so existing reports are preserved.

The report distinguishes candidate source, partial reads, and unavailable access.
Retrieving a candidate does not verify that the service loaded it; compare its
implementation with the observed runtime functions before drawing that conclusion.
