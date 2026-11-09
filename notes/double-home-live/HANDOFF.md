# Double-press Home live-save checkpoint

Objective: change double-press enablement and destination while the Vetro overlay is running, with confirmation that the current native launcher applied the setting.

## Current state

- Repository: `pponce/vetro`.
- Combined branch: `combined/home-enhancements-0.5.0`, commit `d0a431dc66a7cf1f82b6e921538bf76c67127530` (parent `a5055f2216ba3dbdcef2b089c9bc4e04b337a089`). The same commit is on `fix/double-home-live-settings-0.5.0`.
- Open upstream PR [#167](https://github.com/andrearicci93/vetro/pull/167): branch `pr/home-double-press-0.5.0`, commit `bd4c234455226cb4cdbd1c96295f819ccc099971` (parent `3aa46f572eb4518dd91c84dc67f28d9884c33827`). Also on `fix/double-home-live-settings-pr167`.
- PR #167 was updated with only the live-save fix. Its native Home input path and prerequisite stack remain intact. Direct interception and #169 were not added to its branch.
- Other open Home PRs do not contain double-press configuration, so this scoped fix does not apply to them.
- The last hardware-confirmed installed build is `a5055f22`. The user confirmed fast double press opens Glass Home after stopping the overlay, saving, and enabling it again. Live save in the new build has not yet been tested on the TV.

## Implementation and verification

The service sends a fixed `reload-double-home` command to the existing nonblocking control FIFO. A bounded request in the service state directory includes a fresh nonce, target process id, and validated setting. The native event loop applies the setting, clears an unfinished gesture and any pending launch of the previous double-press target, then atomically publishes an exact acknowledgement readable by the service. The service persists the setting only after confirmation. An unconfirmed application or persistence failure attempts live restoration of the old setting. No normal double-press save stops the launcher, rebuilds its app catalog, changes the physical Home assignment, or changes interception preferences.

Startup arguments still load the saved setting when the launcher starts. Off/custom modes save double-press preferences for future overlay use without starting the overlay. A missing running launcher produces an explicit error rather than silently reporting a successful live application.

- [Combined CI](https://github.com/pponce/vetro/actions/runs/42547293171): all checks passed, including application and integration tests, direct Home FIFO tests, native launcher logic, real Ecore child-process tests, TV compilation, release audit and package creation.
- [PR CI](https://github.com/pponce/vetro/actions/runs/42547343657): all checks passed on the independent PR commit.
- Local tests passed for live-save enable/change/disable, rollback after lost confirmation and persistence failure, absent readers, wrong process/stale acknowledgements, shared Home assignment and existing dock behavior.
- Installer tests passed: ten cases covering pinned artifact identity, one stop/start for binary replacement, identical-PID live save, lost responses, safe reruns, later user preference changes, off/custom modes and failure detection. Python compilation passed.

Package artifact: `13643688897`, run `42547293171`, source `d0a431dc66a7cf1f82b6e921538bf76c67127530`, SHA-256 `b88c1e8723c0bd541386deeb1980368301201c4f92d058799c7bd7bcfe68df73`.

## Installer and next steps

Tooling branch: `tools/home-suite-updater-0.5.0`. Installer: `tools/update-vetro-live-double-home.py`, alongside the existing `tools/update-home-suite.py` and `tools/vetro_owner.py`. It pins and verifies the passing CI artifact, reuses the existing signing identity and owner pairing, and updates only Vetro. It uses separate confirmed public stop/start operations once to load the new native binary, then resaves the current double-press preference and verifies the launcher PID is unchanged. Interrupted steps are checked before proceeding; an installation is not blindly repeated.

Keep all host work under the established `samsung-tv-tools` project. The download folder is `vetro-install/live-double-home-installer-r1`; installation records and reports are in `vetro-install/vetro-live-double-home-20261109-r1`. The installer prints an exact rsync command for the report. No backup was created and no ad hoc patch was applied to the TV.

1. Run the pinned installer with the TV awake, root connected, and the existing SDB/TV-Store connection available.
2. Confirm `VERIFIED: double-press settings saved and applied without restarting the launcher.` Return the generated report if any operation stops or is unresolved.
3. With the overlay and Remote interception still enabled, save another double-press destination, then save Glass Home again. Test each on the same physical remote.
4. Disable and re-enable only double press, saving each time. Test normal single Home, fast distinct double presses, slower second presses and held keys. Leave the physical Home assignment on Toggle Vetro overlay.
5. Record hardware acceptance separately from the passing desktop/CI tests. Do not claim the original stop/start failure was diagnosed: the fix removes that operation from double-press saving, while its original underlying cause remains unproven.

The GitHub connection allowed updating the PR branch but refused posting the validation comment to the upstream repository with HTTP 403 (`Resource not accessible by integration`). The prepared note is in [PR167-UPDATE.md](PR167-UPDATE.md). No comment was posted and the PR body was not edited.
