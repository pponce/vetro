# Double-press Home correction checkpoint

## Objective and repositories

Save double-press enablement and destination while the Vetro overlay remains running, without changing the physical Home assignment or remote interception preference.

Repository: `pponce/vetro`. Combined branch: `combined/home-enhancements-0.5.0`. Upstream PR [#167](https://github.com/andrearicci93/vetro/pull/167) uses `pr/home-double-press-0.5.0`. Installer branch: `tools/home-suite-updater-0.5.0`. Working notes belong in `notes/double-home-live/`.

Published correction r3:

- Combined: `410a8ad7566e610a208839ab2b4623052515b775`, test branch `fix/double-home-runtime-output-0.5.0`, base `1768e251784adb14dc007052c5b9a45e567e2777`.
- PR #167: `79cc61594f7476f6f464fdb3c1db43b83209e7c8`, test branch `fix/double-home-runtime-output-pr167`, base `2164f937769410ba1c2ff08ab7cf4b891c11ecea`.
- The two-file source correction changes only acknowledgement parsing and its regression tests. Native launcher source is unchanged from r2.
- PR #167 retains its existing native input path and prerequisite stack. Direct interception and PR #169 are not added to it. Other Home PRs do not contain double-press configuration.

## Latest hardware evidence and confirmed cause

Hardware acceptance update: `report-20261109T035153810007Z.json` confirms r3 installed successfully with `complete: true`, installed files and runtime verified, and `liveDoubleHome.sameProcess: true` plus `savedAndApplied: true`. The user then confirmed: "save worked" in the dashboard. Automated live-save verification and a manual dashboard save have therefore passed on the S95C. The user additionally confirmed: "changing the app works after saving." Destination changes therefore take effect after a live save, completing acceptance of the reported save/destination issue. Separate disable/re-enable coverage has not been explicitly reported. No further install or cold boot is needed for the save correction.

`reply-20261109T034424602817Z.json` completed the focused diagnostic on installed r2 (`1768e251`). The helper returned exit code 0 without a timeout. Its output contained the exact fresh `double-home-applied <nonce>` line, followed by two Samsung .NET `[GC_INFO]` lines. The native acknowledgement file exactly matched the full request, including nonce, PID and Glass Home destination. The launcher PID remained unchanged and persisted preferences were unchanged. The native log recorded the application.

Therefore r2's native delivery and acknowledgement worked on this TV. The service incorrectly required the entire stdout stream to equal the confirmation. GC output made it report failure and attempt rollback. The same overly strict comparison then falsely rejected the rollback acknowledgement. This is an introduced confirmation-parser bug, not loss of root access or an installation failure.

The prior `report-20261109T031630332191Z.json` verified all r2 package files and author identity, one native stop and start, and retained Glass Home preferences. It stopped correctly at `verify-runtime-vetro` on the false-negative live save. An unchanged dashboard save reproduced the error. No more r2 installations or diagnostic repetitions are needed.

## Completed implementation

The service now splits stdout into lines and requires exactly one full acknowledgement line matching the fresh request nonce. Runtime log lines can precede or follow it. Missing, stale, truncated, embedded, extended, duplicate or conflicting acknowledgements still fail; nonzero exit status and timeouts still fail before parsing. LF and CRLF are accepted.

The r2 root-agent delivery remains intact: a bounded helper runs before launcher instance acquisition and EFL setup, validates the resident PID and command line, stages a private request, writes the fixed nonblocking FIFO command and waits for an exact native acknowledgement. Request/acknowledgement files remain mode 0600 in the native runtime directory. Ordinary settings saves never restart the launcher. The service persists only after confirmation and attempts restoration after a genuine application or persistence failure.

The installer retains the r2 improvements: it stops immediately on live-save failures, records the actual HTTP error, and preserves successful installation evidence even when runtime verification fails. The r3 package uses a fresh attempt ledger, reuses the existing Partner certificate and owner pairing, and preserves the current Home settings. The package update performs one confirmed native stop/start, then verifies a live save retains the same PID. No backups or ad hoc TV patches are created.

## Validation

The regression test reproduced the observed error against the previous parser, then passed with the r3 correction. It uses the GC log shape captured on the TV, covers logs before/after the acknowledgement and CRLF, and rejects malformed, stale and ambiguous replies and a successful-looking reply with nonzero exit status. Existing service, dock and shared Home-assignment tests passed locally.

Both full CI runs passed:

- Combined: https://github.com/pponce/vetro/actions/runs/42558228305
- PR #167: https://github.com/pponce/vetro/actions/runs/42558249333

The existing CI includes root/app EACCES boundary tests with separate processes, native launcher tests, Ecore tests, TV launcher compilation and release checks. The native root path has now also been verified on the TV by the uploaded diagnostic. The r3 installer live-save check and manual dashboard save are now confirmed on the S95C; the user also confirmed that changing the destination takes effect after saving.

## Earlier findings retained

The initial live-save version (`d0a431dc`) attempted root IPC directly from the app service and returned EACCES. Its installer also swallowed native errors inside a reconnect loop, producing repeated checks; both were corrected in r2. The initial package itself had installed correctly.

Before live save was introduced, changing double-press settings restarted the launcher and returned `Start failed`. Saving with the overlay off and enabling it again worked. The underlying cause of that original restart failure remains unproven. Stock 0.5.0 does not include this double-press settings feature. These live-save defects belong to the enhanced implementation.

## Exact next steps

1. Completed: both r3 CI runs passed and the combined branch and PR #167 were advanced with expected-head checks.
2. Completed: the combined source/run/artifact/digest is pinned in `tools/update-vetro-live-double-home.py`, using suite `vetro-live-double-home-20261109-r3`. All 14 installer tests and Python compilation passed with these final pins. Tooling and this checkpoint are published together.
3. Completed: the user ran the checksum-verified r3 installer successfully. Installer files are under `vetro-install/live-double-home-installer-r3`; records/reports are under `vetro-install/vetro-live-double-home-20261109-r3` within the existing `samsung-tv-tools` project. Retain earlier records. Keep the TV awake with Vetro/root connected; no cold boot is required.
4. Completed: the report confirms the installer live save applied successfully in the same launcher process. The user also confirmed a dashboard save succeeded.
5. Completed: the user confirmed that changing the app works after saving. The reported live-save issue is resolved. Enabling/disabling only double press is optional additional coverage; do not repeat completed installation or diagnostic steps.
6. Completed: installer same-process application, manual dashboard saving, and destination changes are recorded separately from CI and diagnostic evidence. No further correction or installation is required for this reported issue.

The GitHub connection allowed branch updates but refused an upstream PR comment with HTTP 403 (`Resource not accessible by integration`). Do not claim a comment or PR body edit was posted. Prepared comment text is in `PR167-UPDATE.md`.

Package: source `410a8ad7566e610a208839ab2b4623052515b775`, run `42558228305`, artifact `13648133816`, artifact SHA-256 `90862b3ee48b22395ed69f3cea3ee9aa6642cb60b1425c2bbca10a1077d7b97e`. A local check also fed the exact uploaded helper reply to the corrected service with its matching nonce and passed.
