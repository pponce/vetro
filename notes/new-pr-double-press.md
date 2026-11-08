# Add optional Home double press with an independent destination

Single Home immediately toggles the Vetro overlay. A second distinct press within 350 ms opens either an independently selected app or the overlay Home tile's destination. For example, the tile can open Samsung Home while double press opens Glass Home.

The gesture uses kernel event timestamps and requires down/up/down from the same input node. It handles repeats, duplicate downs, rapid third taps, navigation cancellation, reconnects and Samsung Home fallback. It is active only in overlay mode. Applying its setting restarts the active overlay.

The follow-up is one commit on the prepared #113/#117/#118/#119 prerequisite stack. Please keep it a draft until #119's ownership model is agreed and rebase after those changes merge; an upstream-main diff currently includes the prerequisites. The combined build branch is for testing only.

Validation: [CI](https://github.com/pponce/vetro/actions/runs/42508843333) passes application/integration tests, native gesture and zero-allocation checks, real Ecore process tests, TV launcher compilation and release hygiene. The [combined integration build](https://github.com/pponce/vetro/actions/runs/42508536173/artifacts/13627979773) includes the freshly compiled launcher. S95C/Q80A acceptance is outstanding.
