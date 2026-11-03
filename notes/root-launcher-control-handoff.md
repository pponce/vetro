# Root launcher control checkpoint

## Objective and hardware evidence

Fix delivery of **Toggle Vetro launcher** on the combined branch while preserving
the saved mapping, startup/return choices, debounce, configurable shortcut, and
existing Samsung Home behavior outside interception.

The S95C was running `d4a775ae08c6d7c444fb7d95552070153db648be`. The physical Home
rule was enabled, its action was `launcher`, and the connected filter marked Home
down/up as blocked. The launcher was installed, enabled, running, and not busy.
The latest launcher log contained no control toggle from those presses.

The service ran as an app user, while the launcher pipe belonged to root beneath
a directory with mode 0750. The FIFO had mode 0666 and the `User::Home` label.
The first implementation attempted direct application-process access and hid
every open/stat/write error behind a native Home fallback. The evidence places
the failure in command delivery; it does not establish the precise filesystem
or mandatory-access-control error because that build did not retain it.

## Correction

The service uses its existing authenticated root adapter to invoke a headless
`--control toggle` command in the launcher DLL. The control path executes before
instance acquisition, log trimming, or EFL initialization. It opens the FIFO
nonblocking, rejects final-component symlinks and non-FIFO descriptors, writes
one small atomic command, and reports a versioned result. No file permissions,
security labels, or TV policy are changed.

Only confirmed non-delivery permits a single native Home fallback. A timeout,
disconnect, malformed/duplicate result, partial write, or inconsistent exit code
cannot replay Home or toggle. Physical interception is released on uncertain
delivery and its error is displayed. `/dock` exposes the last control outcome.
Confirmed fallback also appears in the Remapper status.

The nonblocking/no-follow open uses libc. The ARM32 no-follow value is defined by
[Linux ARM fcntl.h](https://github.com/torvalds/linux/blob/v6.1/arch/arm/include/uapi/asm/fcntl.h).
File-type inspection uses the runtime's portable `SystemNative_FStat` prefix,
avoiding architecture-dependent libc stat layouts. The Mode field is at byte 4
in [.NET Core 3.1](https://github.com/dotnet/corefx/blob/v3.1.0/src/Common/src/CoreLib/Interop/Unix/System.Native/Interop.Stat.cs)
and [.NET 10](https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/Common/src/Interop/Unix/System.Native/Interop.Stat.cs);
the allocated structure accommodates both versions. Only that common prefix is
read. Hardware verification remains necessary for the TV's runtime and access
policy.

## Validation and release sequence

The service test exercises actual physical-event dispatch through the root
command queue, result parsing, exactly-once toggles, visible fallback, and
uncertain-delivery handling. The native CLI suite runs the compiled TV DLL with
real FIFOs and separate Unix identities, proving that an unprivileged process is
denied while the root execution route delivers. It also checks missing readers,
full pipes, absent paths, regular files, symlinks, repeated commands, and that
control cannot replace the resident PID/log files or start a display.

Run all app/integration tests and installer checks. Publish the source on
`pponce/vetro:combined/startup-return-launcher`, await the dedicated native build
and tests, then import its compiled DLL and trigger final package CI with a
checkpoint commit. Do not hand out an installer pinned to source with the older
DLL. Keep all upstream branches unchanged.

Install using the existing combined updater, cached Partner certificate, and
loopback SDB. Keep Developer Mode on and Host PC IP `127.0.0.1`. Re-enable the
saved interception preference if it was switched off during diagnosis; there is
no need to recapture Home or recreate its mapping. Test Home over Netflix and
Samsung Home, repeated toggles, navigation, and standby/wake. Keep return-app
unselected and AeroTizen App mode on during those checks. Upstream submission
still awaits hardware confirmation.
