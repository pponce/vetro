Thanks Andrea. I’ve now refreshed the remaining work on top of the released 0.5.0 architecture. The baseline is current `main` at `180d9845`, which also includes the subsequent upstream YouTube-plugin change.

- **#113:** kept the 1.5-second delayed-echo handling and reduced the change to the remaining duplicate/window-first cases and five regression scenarios.
- **#117:** focused on a Home close that is already executing. Launch waits for actual Ecore child completion, preserving the release’s multiple Samsung Home targets.
- **#118:** rebased the editable overlay Home tile and label through the bundled launcher plugin, with persistence, verified saves and Samsung Home fallback.
- **#119:** replaced the stacked implementation with a smaller proposal using the release’s native launcher modes as the single Home owner. Launcher and Remapper share the saved destination; competing legacy Home rules are inactive. This remains a draft for agreement on the design.
- **Double press:** prepared separately on the Home prerequisite stack. Single press remains immediate; a distinct second press within 350 ms opens an independently selected app or the Home tile destination. The intended combination is overlay on single press, Samsung Home on the tile, and Glass Home on double press.
- **Clients:** prepared separate Glass Home and Garage Home branches using stock endpoints. Glass reads the installed registry and Home ordering, with Home-row/package artwork fallback. Garage adapts optional controls while retaining native Sources, confirmations and verification. Exact Samsung catalog/artwork coverage still needs checking on the TV.

All four refreshed PR branches, the separate double-press branch and the combined Vetro build pass CI. Both client branches also pass their hosted tests and browser checks and produce unsigned widgets. The combined run includes native tests, real Ecore process tests and a fresh TV launcher compilation.

**Combined test build:** [download the unsigned integration package](https://github.com/pponce/vetro/actions/runs/42508536173/artifacts/13627979773) · [passing CI](https://github.com/pponce/vetro/actions/runs/42508536173) · [source](https://github.com/pponce/vetro/tree/eb2227342f66cb9a0eb9a855c62fe2f105619793). It includes the rebuilt launcher, source revision and checksums. It needs signing for the target TV.

The combined branch is for testing, not an upstream PR. Current-head S95C acceptance and the requested Q80A comparison are still outstanding; earlier hardware results should not be treated as validation of these rebased heads.

The input lifecycle fix is already upstream. I’ve left stock authentication and screen checks in place. Per-app permissions/separate screen authentication remain parked, and standby opening/automatic return remain deferred for the future plugin event APIs. I’ll only propose further screen or catalog changes when the stock comparison demonstrates a specific gap.
