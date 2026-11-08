I've rebased this directly onto post-0.5.0 `main` and moved the setting through the release's bundled launcher plugin.

The scope remains the overlay's Home tile: choose an installed, enabled app, use a 1–12 character label, save it, or restore Samsung Home. The refreshed launcher list falls back to Samsung Home when the app is unavailable while retaining the saved preference. The editor preserves drafts, verifies saves and reports failures without discarding edits.

[Current CI passes](https://github.com/pponce/vetro/actions/runs/42507751828). This branch is independent of physical Home assignment and double press. The rebased implementation still needs TV validation; the earlier combined-build result is not validation of this head.
