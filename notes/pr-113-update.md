I've refreshed this against post-0.5.0 `main` (`180d9845`) and reduced it to the remaining Home-event handling and regression tests.

The current version keeps upstream's 1.5-second raw-to-XF86Home echo protection. It adds the shared 350 ms duplicate gate, records a raw copy even when the window event arrived first, and avoids consuming the next physical press while hidden. The five scenarios cover both event orders, delayed echoes, duplicates after an external reopen, a genuine second raw press, and long idle.

[Current CI passes](https://github.com/pponce/vetro/actions/runs/42507553836), including native tests and TV launcher compilation. The branch contains source changes; the freshly compiled DLL is in the combined test artifact linked from #138's update. My earlier S95C result applies to the earlier combined build. This refreshed head still needs its controlled TV comparison.
