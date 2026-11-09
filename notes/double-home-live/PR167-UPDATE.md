Double-press settings now apply through Vetro's root agent while the existing launcher stays running. The root helper validates the launcher process and uses a private request plus an exact acknowledgement before the service saves the preference.

This corrects a permission failure found on my S95C when the app service tried to deliver the live setting directly. It covers unchanged saves, enabling or disabling double press, changing the target app, and choosing the Home shortcut. A failed application or persistence step attempts to restore the previous runtime setting and reports the result.

The physical Home assignment, remote interception preference and overlay Home tile remain independent. No normal double-press save restarts the launcher.

Both source-check runs passed. Validation for the correction:

- PR commit: `2164f937769410ba1c2ff08ab7cf4b891c11ecea` — [source checks](https://github.com/pponce/vetro/actions/runs/42550281754).
- Combined build: `1768e251784adb14dc007052c5b9a45e567e2777` — [source checks](https://github.com/pponce/vetro/actions/runs/42550258938).
- The new native test runs an unprivileged process that gets EACCES, then confirms the root helper changes settings in the same resident launcher process. It also covers stale acknowledgements, wrong PID, malformed requests, missing readers and invalid FIFO paths.
- Service tests cover denied app filesystem access, live updates, rollback and concurrent saves. Installer tests cover failure reporting without repeated live-save attempts.

Hardware testing of this correction still fails: the package installed and restarted successfully, but the service received exit code 0 with a reply that did not exactly match the expected acknowledgement. An unchanged dashboard save returned the same error. Exact reply and native acknowledgement capture is the next step. The preceding direct live-save implementation failed with EACCES. The original restart-command failure's underlying cause remains unproven; this change removes restarting from ordinary double-press saves.

This update is scoped to double-press configuration. The PR keeps its existing native input path and prerequisite stack; direct-interception integration and #169 remain separate.
