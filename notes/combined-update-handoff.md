# Combined Vetro update checkpoint

The user explicitly requested one combined fork branch and an installation script containing this conversation's changes and the Vetro changes from the other conversation.

## Included source

- Current fork `main`: `4bbf073abc523fe75bf2a6032685678a69d52a31`, including the Home-event debounce, cancellable Samsung Home close guard, configurable Home app shortcut, and the compiled matching launcher.
- Startup feature: `335d21f5d6e1262deb00f2ece6125962d96e7313`.
- Return-app feature: `69d44eb5ee0c8d911bb5b7aca91c29c4ddd729a8`.
- Combined branch: `combined/startup-return-launcher`.

This supersedes the older combined test package's choice to keep only the tested Home-toggle launcher. The user now requested all the current Vetro work together. AeroTizen and Glass Home application changes remain in their own repositories.

The explicit cross-chat handoff confirmed AeroTizen App mode on `pponce/AeroTizen:main` at `3f35b2d95d26a9d076ec2649267698a09929539e`. Use that commit for any separate AeroTizen update, rather than its older manual-app branch. App mode defaults on; switching it off enables its watcher. If updating both applications, install AeroTizen first and Vetro last. This installer updates Vetro only.

## Installation

The installer uses the existing signing profile and current root service. A detached helper outside the app package submits a single loopback-SDB update, survives the launching shell's exit, and requests Vetro to reopen. Host PC IP is not changed. The host script checks the exact new source revision, the installed DLL hash, root, both setting endpoints, and the enabled launcher's replacement process.

No TV update has been executed from this workspace. The provided script is for the user to run on the existing Linux host. Do not submit the startup or return-app upstream PRs until the user reports their TV tests. No backups or certificate replacements are performed.

The first user attempt with combined commit `101ec30ee6f660fac237b48613ebfea9fbe427f8` stopped during Node CLI discovery: a candidate executable aborted on `-e`. It submitted no install. The updater now uses a precompiled .NET helper and the TV's existing `/usr/bin/dotnet`; it no longer assumes that the web service runtime is a standalone Node CLI. The compiled helper is built and tested on GitHub, with source and binary hashes checked on the host and transferred helper hashes checked on the TV. No .NET SDK is required on the user's computer.

## Validation

The merged application passed 71 suites. The 9 integration suites and 17 Python parser tests passed. The replacement updater passed 9 .NET suites, including real loopback socket fixtures, and the host installer passed 11 Python tests. These cover cached certificate eligibility, identity and checksum mismatches, fragmented/invalid SDB frames, exact/repeatable transfers, detached process completion, one-time install submission, acknowledgement loss, and resumed verification. GitHub additionally runs the launcher tests and compilation.

The physical S95C install and behavior checks remain outstanding. Use `tools/README.md`, `app/docs/STARTUP-APP.md`, and `app/docs/RETURN-APP.md` for the procedure and limits.
