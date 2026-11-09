# Double-press Home correction checkpoint

Objective: save double-press enablement and destination while the Vetro overlay remains running, without changing the physical Home assignment or remote interception preference.

## Repositories and branches

Repository: `pponce/vetro`. Combined branch: `combined/home-enhancements-0.5.0`. Upstream PR [#167](https://github.com/andrearicci93/vetro/pull/167) uses `pr/home-double-press-0.5.0`. Installer branch: `tools/home-suite-updater-0.5.0`.

Published correction:

- Combined: `1768e251784adb14dc007052c5b9a45e567e2777`, test branch `fix/double-home-root-ipc-0.5.0`, base `d0a431dc66a7cf1f82b6e921538bf76c67127530`.
- PR #167: `2164f937769410ba1c2ff08ab7cf4b891c11ecea`, test branch `fix/double-home-root-ipc-pr167`, base `bd4c234455226cb4cdbd1c96295f819ccc099971`.
- PR #167 retains its existing native input path and prerequisite stack. Direct interception and PR #169 are not added to it. Other Home PRs do not contain double-press configuration.

## Confirmed hardware state and diagnosis

Latest report: `report-20261109T031630332191Z.json`. Correction r2 (`1768e251`) installed with every packaged file and author identity verified; one native stop/start was confirmed. Live save failed with HTTP 409, and a subsequent unchanged dashboard save returned the same error. The installer correctly stopped at `verify-runtime-vetro` without retrying the save. Glass Home remains the saved preference.

The new error comes from the service's exact stdout comparison after it received exit code 0 without a timeout. The raw stdout is absent from the report, so delivery versus reply formatting is not yet established. Do not claim the r2 hardware fix passed, and do not reinstall r2 or repeatedly click Save.

The uploaded `report-20261109T020040550319Z.json` confirms that revision `d0a431dc66a7cf1f82b6e921538bf76c67127530` installed: all packaged files and the author identity matched. One stop and one start of the native launcher were confirmed. The existing Glass Home double-press preference was retained. Only runtime/live-save verification failed. The installer has stopped.

A dashboard save without any edits returned `EACCES` from the new service-side live settings delivery. The exact denied filesystem operation was not distinguished by that implementation. Root connectivity itself was confirmed. This is a defect in the first live-save correction, not evidence that installation failed or root access was lost.

The installer additionally caught live-save errors inside its service-reconnection loop and retried them. That produced repeated checks and misleading reconnect messages. The corrected loop retries only status-read/reconnection failures and lets native refresh/save errors stop immediately.

The earlier `Start failed` error occurred when double-press saves restarted the launcher. The workaround of stopping the overlay, saving, and enabling it worked. That original restart failure's underlying cause is still unproven. Stock 0.5.0 does not have this double-press settings feature; the introduced live-save defect belongs to the enhanced implementation.

## Implemented correction

The app service invokes a bounded `--apply-double-home` mode in the packaged launcher through Vetro's existing root executor. This mode runs before instance acquisition or EFL setup; it never starts/stops the resident launcher or shows its window. All request-file, FIFO and acknowledgement operations occur in the root process. The service performs none of those operations itself.

The root client validates the PID and launcher command line, opens the control FIFO nonblocking without following symlinks, verifies the opened descriptor is a pipe, writes a private request, sends the fixed reload command and waits for an exact nonce/PID/settings acknowledgement. Request and acknowledgement files are in the launcher's runtime directory with mode 0600. Staged requests are removed on completion or timeout.

The existing native event loop applies the setting and resets any unfinished double gesture and pending launch of the old target. The service persists the preference only after confirmation; on failure it attempts to restore the previous runtime setting. Off/custom modes retain their existing save behavior.

The updater preserves installed-file evidence when runtime verification fails, records the actual HTTP error, and uses a separate r2 ledger for the corrected build. It reuses the existing Partner certificate and owner pairing. Loading the new binary requires one confirmed stop/start; ordinary settings saves do not. No backups or ad hoc TV patches are created.

## Validation

Local service tests passed for live changes, rollback, concurrent saves, unchanged Home assignment, and root dispatch while app filesystem calls throw EACCES. Existing dock and Home-assignment tests passed. All 14 installer tests passed, including real HTTP-error reporting, failure propagation without repeat saves, transient connection recovery, and retaining successful installation evidence. Python compilation passed.

Both CI runs passed, including the permissions test, existing native tests, Ecore tests, TV launcher compilation and release checks:

- Combined: https://github.com/pponce/vetro/actions/runs/42550258938
- PR #167: https://github.com/pponce/vetro/actions/runs/42550281754

CI adds a real root/app permissions test: a process running as uid 65534 gets EACCES, while the root client updates a separate resident process. It exercises unchanged saves, destination changes, disablement, exact acknowledgements, stale acknowledgements, wrong PID, malformed input, regular files, symlinks and absent FIFO readers. Full native compilation, existing native tests and release checks also remain required. Hardware testing of r2 failed at the exact helper-reply check; the native acknowledgement and raw reply require collection.

## Exact next steps

1. Completed: both CI runs passed and the combined and PR branches were advanced with expected-head checks.
2. Completed: the combined artifact, digest and source revision are pinned in `tools/update-vetro-live-double-home.py`, using suite `vetro-live-double-home-20261109-r2`. All 14 installer tests and Python compilation passed again with the final pins. The tooling commit contains the scripts and this checkpoint.
3. Run `tools/inspect-vetro-live-double-home.py` with the TV awake, Vetro connected, and the existing overlay settings retained. It verifies r2, captures current acknowledgement/process evidence, reapplies the already-saved preference exactly once through the packaged helper, and records the exact reply and resulting acknowledgement. It does not install a package, restart the launcher, or change the persisted preference.
4. Return its report using the printed rsync command. Compare `helper.output`, `helper.stderr`, `checks.exactReply`, `checks.acknowledgementMatches` and `checks.sameLauncher`. Extra output, missing output and a missing/mismatched native acknowledgement must remain distinct diagnoses.
5. Implement the evidenced correction in the combined branch and PR #167, add coverage for the observed response, run both CI workflows, then supply the next pinned updater if a package change is needed. Do not weaken acknowledgement checks based only on an assumed output format.
6. After the corrected build passes a live save, test unchanged saves, target changes, disable/re-enable of double press, and two quick distinct Home presses without changing overlay ownership or interception.

The GitHub connection permitted branch updates but refused an upstream PR comment with HTTP 403 (`Resource not accessible by integration`). Do not claim a comment or PR body update was posted. Prepared comment text is in `PR167-UPDATE.md`.

Package artifact: `13644104863`, source `1768e251784adb14dc007052c5b9a45e567e2777`, run `42550258938`, SHA-256 `9945da1734b88d507fdbc8eba28656c9582b86df60eba49ce33f6fad79e0743d`.

Installer files go under `vetro-install/live-double-home-installer-r2`; installation records and reports go under `vetro-install/vetro-live-double-home-20261109-r2`, within the existing project. Earlier r1 records remain intact.

Diagnostic preparation: Python compilation and simulated captures passed for exact and decorated replies, confirming one helper request and correct report comparisons. The diagnostic has not yet run on the TV.
