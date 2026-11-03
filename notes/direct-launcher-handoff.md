# Direct launcher remap checkpoint

The first direct-write implementation was installed but did not deliver toggles
on the S95C despite confirmed interception. The current correction and evidence
are in [root-launcher-control-handoff.md](root-launcher-control-handoff.md).

## Objective and recovered state

Preserve the combined startup, return-app, Home debounce, configurable shortcut,
and Ecore completion changes while providing a Home route that opens the launcher
over the current screen. Work remains on `pponce/vetro`, branch
`combined/startup-return-launcher`. Separate upstream PR branches are unchanged.

The user confirmed installation of `e26dc0c94c5e089fd5ca05b9b27eae43aab97199`.
Return-app was unselected and AeroTizen App mode was on. That build still closes
an already-open Samsung Home after a physical Home press and can show a brief
loading transition from another app. The later capture used one launcher process;
it contained successful Home-close calls lasting 1.70, 1.04, and 2.09 seconds and
no Vetro command to launch Netflix. This supports the app-underneath explanation
but does not prove the cause of each visible black screen.

The interrupted implementation was recovered as uncommitted files in the existing
checkout. Its base tree matched the installed commit exactly. Earlier local Git
commit IDs differ from the published IDs; use the published branch and pinned
remote commit for installation.

## Implementation

- Add `launcher` to remapper actions and expose **Toggle Vetro launcher** in the
  Remapper action selector and general rule builder.
- Write `toggle\n` to the existing native control FIFO with nonblocking open,
  no symlink following, a FIFO type check, and a short atomic write.
- Successful physical presses perform one toggle without native Home injection,
  app launch, or Samsung Home close commands. Repeat/up/unblocked events do not
  trigger the action.
- Disabled, restarting, uninstalled, or unavailable launchers fall back to the
  existing native Home injection. A successful write is not replayed if closing
  the file descriptor fails.
- Keep the existing native launcher source and compiled DLL unchanged. Its FIFO
  handler already shows/hides the launcher without arming Home suppression.
- Preserve all existing settings. Installation does not enable interception or
  replace an existing shortcut. The user configures Home in the dashboard.

## Validation

Local validation passed 72 application suites, 9 rooting integration suites,
17 diagnostic parser tests, 17 installer tests, updater bundle verification,
and release hygiene. The real-FIFO test exercises the service's actual physical
event callback and nonblocking control-pipe write. Additional checks confirm the
saved launcher action works after service restart and interception restoration,
and that the dashboard can save it without an application selection.

Run GitHub source CI for the final remote commit, including the launcher logic,
real Ecore process tests, TV compilation, updater contract, and full package.
These checks do not establish physical remote interception or TV visual behavior.

## Installation and next steps

1. Install the pinned combined commit using the existing `tools/install-combined.py`
   and combined checkout beneath the existing `samsung-tv-tools` project folder.
   Reuse the Partner certificate and keep Developer Mode on with Host PC IP
   `127.0.0.1`. This is a Vetro-only update. Do not create backups or replace
   certificates. Preserve the updater's pending-attempt ledger.
2. Refresh the dashboard. In **Remapper**, detect the physical Home press; the
   user's observed code is `XF86Home`, 63. Save **Toggle Vetro launcher** for that
   key and enable **Remote interception** on the captured physical device.
   Confirm connected status. Keep the Vetro launcher enabled.
3. Test Home from Netflix and several other apps for loading or black flashes;
   repeat Home to show and hide the launcher. Select Samsung Home and press Home
   again: Samsung Home should remain underneath. Test Back, arrows, OK, volume,
   and the configured launcher app shortcut.
4. Test standby/wake restoration. Turning interception off restores ordinary
   remote delivery. Commands arriving through HDMI-CEC, network control, or a
   different physical input device are not intercepted by this mapping.
5. Keep return-app unselected and AeroTizen App mode on while isolating these
   checks. Await hardware results before upstream submission.

Local checks can be repeated with `node app/tests/run.cjs`,
`node rooting/tests/run.cjs`, `python3 tools/tests/test_install_combined.py`,
`python3 .github/scripts/test_parse_log.py`,
`python3 tools/tv-updater/bundle.py`, and
`python3 .github/scripts/audit_release.py`.
