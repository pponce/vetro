# Return destination checkpoint

The user requested a configurable equivalent of Garage's return-after-app-exit behavior, in addition to the already prepared startup foreground choice. The implementation uses a separate setting and endpoint; it does not port Garage's pairing, playlist inbox/proxy, API access exceptions, or remote watch mode.

- Feature branch: `feat/return-to-app`, based on `feat/startup-foreground-app`.
- Startup feature source commit: `335d21f5d6e1262deb00f2ece6125962d96e7313`.
- Test package must preserve the confirmed Home-toggle launcher build (`9a1a6483d89650a4cc32304f04e7ada1b972429d`). The separate Home-escape build was prepared but has no confirmed hardware test in the available context; do not silently include it.
- Keep Developer Mode Host PC IP unchanged. Use the existing installation/signing workflow; do not install or patch the TV automatically.
- Do not submit upstream PRs until the user tests the relevant behavior on the TV.

## Behavior

One return app, independent of the one power-on app and all boot/restart flags. Bounded API writes, stale revision checks, atomic persistence and readback, and explicit off even without inventory. No launch when the setting is saved.

The monitor reads foreground/fullscreen, partial foreground, and source state through a fixed read-only command. It recognizes another eligible app falling back to Samsung Home/TV. It requires a stable source, no other foreground overlay, known on-power state, and a fresh command-queue guard. The guard reads state in its existing queue slot to avoid deadlock. A single launch request is followed by foreground confirmation, with no retries or continuous enforcement.

## Hardware tests still required

1. With both settings off, confirm unchanged behavior.
2. Select a power-on app. Test ordinary standby off/on and a full reboot, then normal app switching.
3. Enable the return choice. Exit Netflix and another app to Samsung Home/TV and confirm the selected destination opens once.
4. Switch directly between apps, open settings/overlays, change HDMI sources, and leave the destination for Live TV. Confirm no unwanted return.
5. Test the Home button and returning to an already selected input. The fallback detector cannot always distinguish those from Exit; record the actual behavior.
6. Select a second destination, turn the setting off, restart Vetro, and test with the selected app unavailable.

Physical TV behavior is not verified. Consult `app/docs/RETURN-APP.md` for the explicit detection limitations.

## Local validation

- 71 application test suites passed, including return-state transitions, cancellation in the root-command queue, UI selection/readback, and API bounds.
- 9 integration suites and 17 Python parser tests passed.
- Release hygiene/architecture audit and whitespace checks passed.
- The startup-only feature also passed GitHub source checks at `335d21f5d6e1262deb00f2ece6125962d96e7313`.
- No physical TV install, standby test, or app-exit test was performed. The existing launcher installer through Vetro has not been verified for updating Vetro itself.
