I see the same brief Samsung Home/loading-screen transition on my S95C with the 0.5.0-based launcher. The native listener lets Samsung receive Home, then closes its screen.

I've prepared a [related integration](https://github.com/pponce/vetro/commit/a5055f2216ba3dbdcef2b089c9bc4e04b337a089) using the same direct-interception approach as this PR. Your FIFO validation and held-key handling were useful references. It is an adaptation, not an unchanged cherry-pick of your branch.

The main difference is compatibility with my optional double-press feature in #167: it passes timestamped press/release events through a separate private FIFO into the launcher's existing gesture handler, instead of sending a plain toggle. It also supports the shared Home assignment in #119 and permits interception with no other physical shortcut rules when a Vetro or custom launcher is configured.

[CI passed](https://github.com/pponce/vetro/actions/runs/42537866728), including native helper/launcher compilation and input/FIFO tests. Testing this new integration on the TV is still pending. The linked commit depends on my combined feature branch, so it is not a standalone patch to apply directly here.

I'd prefer to coordinate the overlapping interception work here. Would you prefer to land the basic interception in #30 first, with shared settings and double-press support following separately, or would a focused PR to your branch be useful? I can prepare the relevant changes against whichever base you prefer.
