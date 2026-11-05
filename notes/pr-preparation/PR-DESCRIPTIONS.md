# Prepared descriptions — not submitted

## Screen checks

Title: Show status and pairing before optional full TV diagnostics

Provisional base: `andrearicci93/vetro:release-0.5.0`.
Head: `pponce/vetro:prep/screen-quick-checks-release-20261105`.

Opening Vetro runs five bounded checks for the service, public APIs and TV identity. App/package inventory and remote API probes run when the owner presses OK. Pairing is available while the checks run, and the screen reuses an answering background service.

The screen refreshes status without repeating inventory or launcher process probes, recovers an initially failed summary read, and cancels pending requests, timers and callbacks once on exit. It retains release-branch model/firmware/Tizen reporting, root failure reasons, pairing countdown and incremental full diagnostic reports. Owner authentication and its persisted session format are unchanged.

Validation:
- The 82 application suites, 12 integration suites, diagnostic parser checks and release hygiene pass in the source-check workflow.
- Focused cases cover explicit full diagnostics, pairing display, service reuse, HTTP refusal, initial failure recovery, stale responses, cancellation during inventory, repeated Back/idle events and refused exit.
- CI: https://github.com/pponce/vetro/actions/runs/42101157088
- The integrated S95C build has reported fast checks and three successful immediate reopen cycles. This extracted release-branch variant is not hardware-tested, and no stock-upstream A/B reproduction of a native exit delay was captured.

## Remote input lifecycle

Title: Release remote input on service stop and cancel stale callbacks

Provisional base: `andrearicci93/vetro:release-0.5.0`.
Head: `pponce/vetro:prep/input-lifecycle-release-20261105`.

When the service stops while remote setup or an input action is pending, delayed callbacks must not launch a helper or dispatch a shortcut into a replacement session. This releases active input sockets and listeners on stop/exit, rejects stale listener and peer callbacks, and checks cancellation again when a queued root command is dispatched. Saved remote preferences and mappings remain intact for a subsequent service start.

The change preserves upstream's existing owner authentication, launcher plugin and compiled regular expressions. HTTP-listener ownership and credential publishing belong to the separate screen-authentication prerequisite.

Validation:
- The 83 application suites, 12 integration suites, diagnostic parser checks and release hygiene pass in the source-check workflow.
- Regression coverage includes stop before bind, late socket authentication/data, queued helper launch, synchronous stop during a data chunk, stale restoration, queued physical actions and restart with unchanged saved preferences.
- CI: https://github.com/pponce/vetro/actions/runs/42100112380
- The isolated release-branch port has not been installed on a TV. Do not claim a proven exclusive-grab leak in stock upstream based only on the combined-build investigation.

These branches are independent siblings. Before submitting either, confirm the maintainer's integration target. Do not include this notes directory in an upstream feature diff.
