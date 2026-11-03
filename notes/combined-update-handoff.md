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

The second user attempt at `36c4e0ab0f3ac7201ae01b68898f148c0d7df482` loaded the .NET helper but stopped in the read-only SDB probe with `Loopback SDB remote stream changed`. It also submitted no install. That check compared the sender ID on every packet. The replacement accepts the documented zero-sender WRITE format and zero-sender CLOSE compatibility behavior, retains the peer learned from the first READY for acknowledgements, and sends no reply to CLOSE. It still rejects wrong recipient IDs, unexpected nonzero sender IDs, and responses before a valid READY. New errors include only packet header metadata, never the response payload. The failing hardware report did not include a packet header, so the precise variant on that TV remains unconfirmed until the retry.

Protocol references used for this correction:

- [AOSP legacy protocol](https://android.googlesource.com/platform/system/core/+/515bed0e6aae4a835ab4393499c7dd99941a8423/adb/protocol.txt): `WRITE(0, remote-id, data)` and no reply to CLOSE.
- [AOSP transport compatibility](https://coral.googlesource.com/android-core/+/8a9a1c5056a05d292b031810cfd59bc2181e2934/adb/adb.cpp): normal zero-sender CLOSE packets on the same transport.
- Existing `rooting/service/adb.js`: routes received responses by recipient ID, retains the first READY peer, and does not reply to CLOSE.

The third attempt at `69eeaa9d7d11c4795a4079f371d7002d5c542d5d` passed the SDB stream exchange but stopped while validating the returned DUID. It submitted no install and did not reach signing. The helper had imposed a minimum length of 16. [Apps2Samsung's DUID validator](https://github.com/Apps2Samsung/Apps2Samsung/blob/beta/Apps2Samsung.Core/Models/TizenDuid.cs) accepts 10-64 alphanumeric characters; the helper now matches that format and keeps the same trimmed first-line extraction. Tests use a synthetic 13-character ID through the actual socket-backed probe, update identity check, and host certificate selection, with 10/64-character boundaries and invalid/error-text cases. Failure diagnostics report lengths and character-class validity without exposing the DUID. The actual returned ID was not logged, so the next hardware run must confirm that validation succeeds.

The fourth attempt at `ae97e388d0a8880279be009609f08af9dc1c0441` reached host parsing of the helper result and stopped with `Extra data: line 2 column 1 (char 303)`. It submitted no install and did not reach signing. The host had assumed all helper stdout was one JSON document. The helper now writes one `VETRO_UPDATE_RESULT_V1` line containing protocol version, operation, and result. The host requires exactly one valid frame and typed identity/completion fields; it tolerates surrounding runtime messages without scanning arbitrary JSON for a result. The extra text from the hardware run was not captured, so its exact origin is unconfirmed. No raw DUID is included in parser errors.

## Validation

The merged application passed 71 suites. The 9 integration suites and 17 Python parser tests passed. The updater has 13 .NET suites, including real loopback socket fixtures that exercise the actual DUID probe with short IDs and zero-sender WRITE/CLOSE combinations. The host installer has 17 Python tests. These cover cached certificate eligibility, identity and checksum mismatches, fragmented/invalid SDB frames, exact/repeatable transfers, detached process completion, one-time install submission, acknowledgement loss, and resumed verification. A cross-language CI check feeds the real C# serializer's marked result and surrounding test/runtime messages into the Python decoder. A simulated complete host update exercises the actual decoder at probe, installed-file verification, and completion, plus short-ID certificate selection and a rerun without duplicate dispatch. GitHub additionally runs the launcher tests and compilation.

The user successfully installed `1a2f3ecfbcf124ca0e5d268499fca98d6c9109fb` on the S95C. The installer verified the installed source revision, native DLL, both setting endpoints, and root connection. The cached Partner certificate and loopback-SDB route worked without changing the Developer Mode host address.

Physical launcher testing then revealed a Home regression: the first Home from Netflix could load/black out before returning to Netflix with the launcher; a later Home left Samsung Home behind the launcher. The user confirmed that no return app was selected and AeroTizen App mode remained on. A read-only capture showed the new native launcher running as root with its suppression option, while Samsung Home was the fullscreen app. No managed exception was logged. See `launcher-home-regression.md` for the process-completion repair and its validation limits.

## Next steps

1. Use the final pinned combined commit containing the Ecore command-completion repair and the compiled launcher from `8e9af78ba65d2e58c9fc1cbdbe6623f1096ef306`. Source CI and the native build passed; verify final-package CI before handing over the installer. The startup, return, debounce, and configurable shortcut changes remain included.
2. Keep the TV on and Vetro's root connection available. Reuse the cached Partner certificate and loopback SDB; do not change Developer Mode's Host PC IP.
3. Confirm the script reports VERIFIED after checking the installed source revision, launcher DLL, settings endpoints, and launcher refresh. An unresolved submission must only resume verification; never clear its ledger or submit again without evidence.
4. Test ordinary standby power-on, cold boot, the return destination, Home-key debounce, opening Samsung Home, and the configured Home shortcut.
5. Keep upstream PR branches isolated. Submit startup/return PRs only after hardware feedback. AeroTizen remains a separate update at the pinned main commit above.
