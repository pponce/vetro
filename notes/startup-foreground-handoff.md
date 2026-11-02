# Startup foreground app checkpoint

## Objective

Add one selected foreground app under Task manager. Open it after both cold boot and normal standby wake. Keep all per-app boot/restart flags independent. Prepare a fork build for TV testing; submit an upstream PR only after the user reports the test result.

## Repository

- Fork: `pponce/vetro`
- Upstream: `andrearicci93/vetro`
- Feature branch: `feat/startup-foreground-app`
- Base: `52b02b4cf575aae64af149b77de400c873fc14fc`
- Keep launcher Home-button fixes on their separate branches. A test package must retain the desired launcher build.

## Completed

- One persisted selection, atomic write/readback, revision checks, and explicit off.
- Task manager control, current-selection text, and Startup-list badge.
- Read-only local power-state polling; real suspend detection supplements transitions missed during suspend.
- Settling delay, readiness gating, three-minute expiry, one guarded launch request, foreground verification.
- Session persistence prevents replay after a Vetro restart. A connection loss alone never counts as standby.
- Existing boot/restart flags and Home behavior are not altered by this feature.
- Public setup documentation and regression tests.

## Validation

- 68 application suites passed.
- 9 integration suites passed.
- 17 Python diagnostic parser tests passed.
- Release hygiene/architecture audit passed.
- Physical TV behavior is not verified. The local browser executable was unavailable; browser-script behavior is covered by the VM-based UI regression.

## Remaining

1. Finish review and publish the isolated feature branch.
2. Prepare a test build with the existing launcher fixes, and installation instructions using the existing signing setup.
3. Test ordinary remote power-off/on, cold boot, selecting a second app, continued manual app/input switching, and turning the feature off.
4. Confirm Samsung's local power-state API reports usable on/standby values on the target firmware.
5. Submit the feature PR after the user confirms testing. Keep the Home escape fix separate.

## Decisions

The UI label is **Open onscreen at power-on**. Only one app is selected, while many boot/restart flags may remain enabled. No firmware patch, launcher replacement, or Home-key interception is required. Failed or missing power reads stay unknown. There is no continuous foreground enforcement.
