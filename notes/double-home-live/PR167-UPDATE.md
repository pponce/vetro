Updated this PR in bd4c234455226cb4cdbd1c96295f819ccc099971 so double-press settings can be changed while the Vetro overlay is running.

Save asks the running launcher to apply the setting and waits for an acknowledgement tied to that process and request, then saves the preference. Enabling, disabling, changing the destination, and selecting the Home shortcut all use this path. Applying a change clears an unfinished gesture and cancels a pending launch of the previous double-press destination. An unconfirmed change attempts to restore the previous runtime setting and reports the result.

The physical Home assignment, remote interception preference and overlay Home tile remain independent.

Validation:

- [PR source checks passed](https://github.com/pponce/vetro/actions/runs/42547343657), including application tests, native launcher tests, Ecore tests and TV launcher compilation.
- Tests cover live changes, persistence failure and recovery, missing FIFO readers, stale acknowledgements, process identity and malformed requests.
- [The combined enhanced build also passed](https://github.com/pponce/vetro/actions/runs/42547293171), including direct Home input tests and packaging.

On my S95C, double press itself works after saving while the launcher is off and then enabling it. The new live-save implementation still needs installation and hardware testing. The underlying cause of the earlier restart-command failure has not been established.

This update is scoped to double-press configuration. The PR keeps its existing native input path and prerequisite stack; direct-interception integration and #169 remain separate.
