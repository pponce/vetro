# Launcher Home command-completion checkpoint

## Objective and hardware evidence

Restore Home opening the Vetro launcher over the current app, while allowing the Samsung Home shortcut to cancel remaining suppression commands immediately. Preserve the configurable shortcut, debounce, and startup/return features on `combined/startup-return-launcher`.

The installed combined source `1a2f3ecfbcf124ca0e5d268499fca98d6c9109fb` passed the self-update file and root checks. On the S95C, the user observed that the first Home from Netflix could show loading/black and return to Netflix with the launcher, while the next Home opened Samsung Home with the launcher. Return-app had never been selected; AeroTizen App mode was on throughout the test. A read-only capture identified the new launcher, running as root with `--kill-on-home com.samsung.tv.csfs`, and Samsung Home in the fullscreen-app property. It contained no guard exception. Multiple launcher starts appeared in the historical log, but the capture does not establish whether those were manual restarts or crashes.

## Source findings

Commit `5ccbd0dc1b5f46b34c9cbc1936e918b614869a49` replaced the background shell close sequence with UI-loop timers and managed `Process.Start`/`HasExited` supervision. Both the previous and new versions read remote input without grabbing it; that unchanged behavior does not explain the regression.

The process ownership conflict is documented in the implementations:

- [Ecore signal handling, v1.25.1](https://github.com/Enlightenment/efl/blob/v1.25.1/src/lib/ecore/ecore_signal.c) installs SIGCHLD handling and reaps children with `waitpid(-1, ..., WNOHANG)`.
- [.NET Core 3.1 process state](https://github.com/dotnet/corefx/blob/v3.1.0/src/System.Diagnostics.Process/src/System/Diagnostics/ProcessWaitState.Unix.cs) records managed-child completion through its own signal/reaping path. `HasExited` does not use the non-child process existence check for a managed child that was already reaped elsewhere.
- [Ecore process API](https://www.enlightenment.org/_legacy_embed/group__Ecore__Exe__Group.html) provides process handles and exit events owned by the existing main loop. The event handler must not free the process handle; Ecore does that after dispatch.

This conflict can leave the guard waiting after the first close, preventing future bursts and explicit Home release. It matches the observed sequence, but the TV capture did not trace the signal/reaping race directly. Do not claim hardware confirmation of the exact cause or repair until the user retests.

## Repair

Use `ecore_exe_run` and `ECORE_EXE_EVENT_DEL`, with one outstanding close command. Resolve the event type from Ecore's exported variable after initialization. Match the exact process handle, retain its PID/exit code/signal, and consume completion on the UI loop before releasing a queued explicit Home launch. Do not install another child-signal handler or treat a kill request as proof of completion.

The shell uses `exec` so the tracked child is the close command itself. A command exceeding five seconds is sent a termination signal; a queued launch still waits for its actual exit event. An unrelated child event cannot release the guard. The ordinary app-launch fallback also uses Ecore to avoid reintroducing managed child tracking into the UI process.

Add bounded per-press lifecycle log entries for accepted Home actions, close starts and completions, and explicit Home cancellation. No setting, certificate, Home mapping, or app selection is changed by the repair.

## Validation and next steps

Native integration tests use a real headless Ecore main loop and real shell commands, covering two complete successive Home bursts, explicit Home during an in-flight close, a new physical press superseding a queued launch, exit status, unrelated child exits, and termination followed by another command. They complement the existing pure scheduling tests; they do not emulate Samsung's application framework or Netflix.

Run source checks, native Ecore tests, TV-target compilation, and the full package build. Import the matching compiled launcher from the dedicated combined-branch build workflow, then pin a final commit in the installer. Keep all separate PR branches isolated. After installing, test Home from Netflix repeatedly, quick Samsung Home selection, Back/Home toggling, and the custom shortcut before submitting any upstream PR. Standby startup and return-app behavior also still need user confirmation.

## Build checkpoint

Repair source `0e50c1c3eea6f485fb509bbe706eb06d058775ea` passed [all source CI jobs](https://github.com/pponce/vetro/actions/runs/41559761569). The [dedicated native build](https://github.com/pponce/vetro/actions/runs/41559761593) passed the launcher logic tests, all four actual Ecore process suites, and the TV-target compile. The first test run exposed two fixture commands that incorrectly treated shell `exec` as a standalone executable; those fixtures now use direct executable paths. The production commands already contain shell redirections and were unaffected by that fixture correction.

The builder committed the matching DLL at `8e9af78ba65d2e58c9fc1cbdbe6623f1096ef306`. Its SHA-256 is `187a48e7f830d662c03a26c6d13d44dfd769cda9e462f7047ef4ec80da068281`. The runtime configuration, startup/return service code, configurable shortcut, and updater helper remain unchanged. Local validation passed 71 app suites, 9 integration suites, 17 parser tests, 17 installer tests, updater bundle verification, and release hygiene. The final checkpoint commit triggers CI again with this compiled DLL in the package. No repaired build has been installed on the physical TV yet.
