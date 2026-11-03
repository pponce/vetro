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

## Validation limits

Automated checks cover the .NET helper's source/file hashes, fragmented SDB packets, zero-sender response variants, protocol failures, transfer integrity, certificate selection, package identity, process detachment, one-time dispatch, lost acknowledgements, revision verification, and launcher restart. A cross-language check decodes the C# serializer's result with the Python installer, and a simulated host update covers probe, certificate selection, dispatch, verification, and repeat-run behavior with runtime messages around each result. Test the update and startup/return behavior on each TV model; automated checks do not establish hardware compatibility.

The helper source is in `tools/tv-updater/`. `build-update-helper.yml` compiles and tests changes on the combined branch, then commits only the helper DLL, runtime configuration, and hash manifest. It uses a normal fast-forward push and cannot overwrite a newer branch head. `python3 tools/tv-updater/bundle.py` verifies that the checked-in source and helper match the manifest.
