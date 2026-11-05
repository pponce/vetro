# Integrated Vetro update

This host wrapper installs the complete integrated candidate, including app permissions and standby-only foreground power-on opening. Tizen Start at boot remains independent.

- Target: `f1eeaa30165a98a27502fc3f7b51a77db5238117`.
- Expected installed baseline: `488cdccf3f08916addf4d5f2af567eecd5c105c7`.
- Diagnostic package workflow: [42096796688](https://github.com/pponce/vetro/actions/runs/42096796688); check, permissions_ui, launcher and combined_package passed.
- Helper source: the same target revision. All four helper hashes are pinned in the wrapper.
- Validation: 22 existing updater/input-handoff/owner-client tests passed; shell and embedded Python syntax, revision pins and helper checksums checked locally.

## Run

Keep the TV on with TV-Store open, Developer Mode on and Host PC IP set to 127.0.0.1. Close other Apps2Samsung and debug clients. Use the existing project directory, saved Apps2Samsung CLI locator, Partner certificate and maintenance owner pairing.

```bash
bash notes/pr-preparation/run-integrated-update.sh PROJECT_ROOT TV_IP LOCAL_IP REPORT_USER@REPORT_HOST
```

The wrapper stores its helpers under `PROJECT_ROOT/vetro-install/bin/integrated-f1eeaa30165a`. It checks the exact CI run, baseline, signing identity and remote-input ownership before installation. It retains saved mappings and prior install ledgers, requires the old filtering helper to release input, and verifies the new authenticated screen, service and restored input. It does not request a new pairing, certificate, uninstall or identity. An existing attempt ledger selects verification only; it never submits a second installation for an uncertain result.

When prompted, open Vetro once if it is not already visible and let the quick checks complete. Full diagnostics are not required. Keep the TV on until the collector finishes. The report and its rsync command are printed at the end of the updater. If helper download or another preflight stops earlier, provide the console output instead.

## Next checks

1. Require `VERIFIED: new service, authenticated screen and restored remote input.` and inspect the saved report.
2. Reopen Glass Home and refresh without reconnecting or reapproving. Require fresh successful Vetro app-list activity. This checks access across the Vetro update/service restart.
3. Test normal standby wake and deliberate-navigation cancellation using the selected foreground target.
4. Test automatic return after leaving a launched app separately from power-on behavior.
5. Check a later TV restart for retained app approval, and verify Vetro excludes cold boot from foreground opening independently of Tizen Start at boot and native Autorun.

No installation or hardware result is established by preparing this wrapper. Record results in [TV acceptance](TV-ACCEPTANCE.md).
