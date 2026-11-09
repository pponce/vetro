# Home interception review packet

Complete replacement descriptions for the six open Home PRs:

| PR | Description | Scope |
| --- | --- | --- |
| [#113](https://github.com/andrearicci93/vetro/pull/113) | [Copy replacement](pr-descriptions/113.md) | Duplicate Home delivery |
| [#117](https://github.com/andrearicci93/vetro/pull/117) | [Copy replacement](pr-descriptions/117.md) | In-flight Samsung Home close commands |
| [#118](https://github.com/andrearicci93/vetro/pull/118) | [Copy replacement](pr-descriptions/118.md) | Editable overlay Home tile |
| [#119](https://github.com/andrearicci93/vetro/pull/119) | [Copy replacement](pr-descriptions/119.md) | Shared physical Home assignment |
| [#167](https://github.com/andrearicci93/vetro/pull/167) | [Copy replacement](pr-descriptions/167.md) | Optional independent double press |
| [#169](https://github.com/andrearicci93/vetro/pull/169) | [Copy replacement](pr-descriptions/169.md) | CoBA success without visible Samsung Home |

The descriptions distinguish each current PR branch from the combined test build. They have not been posted to the PRs.

[Suggested comment for #30](pr30-comment.md). Start with the discussion. If the author and maintainer want code incorporated there, prepare a focused contribution against the agreed base. Do not submit the entire combined feature branch to the author's fork. The combined integration needs the Home gesture and assignment prerequisites.

The tested enhanced source is [a5055f22](https://github.com/pponce/vetro/commit/a5055f2216ba3dbdcef2b089c9bc4e04b337a089), with [passing CI](https://github.com/pponce/vetro/actions/runs/42537866728). It is on `combined/home-enhancements-0.5.0` and `fix/direct-home-0.5.0-integration`. The compiled package includes both the rebuilt native launcher and rebuilt remote-input helper.

Use the [complete installation block](INSTALL.md) for the Vetro-only installer, [update-vetro-direct-home.py](../../tools/update-vetro-direct-home.py). It uses the existing project folder, saved CLI and Partner certificate, validates the pinned CI artifact, checks the installed files and running service, refreshes an active native launcher, and records input readiness. The command accepts `--project-root`, `--tv`, `--local-ip`, and `--report-host`. A saved installation attempt is verified rather than automatically repeated.

For direct physical Home, select Vetro or a custom launcher in Launcher and enable interception for the selected physical remote in Remapper. A separate code-63 Home shortcut is not required. Listening mode pauses interception. Leave **Disable Samsung Home** off so the normal Samsung Home tile remains available.

Hardware acceptance: open Apple TV, press Home once, and note any Samsung Home flash. Check a fast double press, a slower second press, a held Home key, and the Samsung Home tile. Automated checks do not establish these visual results. Samsung TV Plus appearing after app exit or wake is not claimed fixed by this change.

[Checkpoint and exact next steps](HANDOFF.md).
