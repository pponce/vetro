Saving double-press settings while the overlay is running now uses Vetro's root agent and waits for a confirmation tied to the current launcher process and request. The preference is saved only after confirmation. Normal settings saves keep the same launcher process and preserve the physical Home assignment, interception preference and Home tile.

The S95C diagnostic confirmed native delivery works: the running launcher applied the setting, wrote the exact acknowledgement and retained the same PID. Samsung's .NET runtime appended `[GC_INFO]` lines to stdout, which made the service incorrectly reject the successful reply and attempt rollback.

This correction recognizes one exact acknowledgement line for the current nonce while allowing runtime log lines. Missing, stale, partial, duplicate and conflicting acknowledgements still fail, as do nonzero exits and timeouts. Regression coverage reproduces the captured TV output and checks these rejection cases.

Both source-check runs passed.

- PR commit: `79cc61594f7476f6f464fdb3c1db43b83209e7c8` — [source checks](https://github.com/pponce/vetro/actions/runs/42558249333).
- Combined build: `410a8ad7566e610a208839ab2b4623052515b775` — [source checks](https://github.com/pponce/vetro/actions/runs/42558228305).

The corrected combined package is now installed on my S95C. Its installer verified that the saved setting was applied in the same running launcher process, and I confirmed that saving from the dashboard succeeds. Changing the selected app also takes effect after saving. The live-save and destination-change issue is confirmed resolved on my S95C. The original restart-command failure's underlying cause remains unproven; this feature removes restarting from ordinary double-press saves.

This update is scoped to double-press configuration. The PR retains its existing native input path and prerequisite stack; direct-interception integration and #169 remain separate.
