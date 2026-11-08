# Vetro 0.5.0 implementation handoff

Updated 2026-11-08. Companion to issue #138 and the contribution plan.

## Objective

Keep immediate single Home → Vetro overlay, onscreen Home tile → Samsung Home, and optional independent double Home → Glass Home. Port only the remaining Home work onto released Vetro architecture; use stock authentication and adapt clients to stock endpoints.

## Baseline

Upstream main `180d9845f1b2a3769c8e4775620757f8f1092c4a` follows official v0.5.0 `81e16b164236e2fd1edae50a06d986da5e607469`. The main baseline also contains upstream's subsequent YouTube-plugin change. This is a 0.5.0-based main build, not an exact tagged-tree build.

## Existing PRs updated

| PR | Fork branch | Commit | Result |
| --- | --- | --- | --- |
| 113 | fix/launcher-home-toggle | 78d8574ace73abdacea59066db787f181299d37d | Five Home-event regression scenarios, retained 1.5 s echo protection, residual duplicate/window-first handling. CI passed. |
| 117 | pr/home-guard-completion | 6dd0fc907cb8e99b73869de0b7e78c674c40812d | Wait for actual tracked close-child completion across all firmware targets. CI passed. |
| 118 | pr/home-shortcut-settings | ee4743745cebac857b4e029ecc7469d76ca8a91b | Editable Home tile destination/label, persistence, restoration, fallback. CI passed. |
| 119 | pr/shared-home-assignment | 33e6f05ca91b85757333c583d20d721f6cb36590 | Native launcher mode is the saved physical Home destination, shared by Launcher/Remapper. Competing code-63 rules inactive. CI passed; design review remains open. |

These four branches each start directly from the selected upstream main baseline, preserving existing PR threads. They do not include the parked permission/startup features.

## Combined build and new feature

- Combined: `pponce/vetro`, `combined/home-enhancements-0.5.0`, `eb2227342f66cb9a0eb9a855c62fe2f105619793`.
- CI: https://github.com/pponce/vetro/actions/runs/42508536173 — all steps passed, including application tests, integration fixtures, pure native checks, real Ecore child-process tests, TV launcher compilation, release hygiene and package production.
- Download: https://github.com/pponce/vetro/actions/runs/42508536173/artifacts/13627979773
- Artifact: `vetro-0.5.0-home-enhancements-unsigned`. Contains the complete rooted integration WGT, freshly compiled launcher, SOURCE_COMMIT.txt, LAUNCHER_SHA256.txt and SHA256SUMS. Unsigned; use the TV's existing compatible Samsung signing profile before installation. Artifact retention is 30 days. No TV install was performed.
- Double-press branch: `pr/home-double-press-0.5.0`, `3aa46f572eb4518dd91c84dc67f28d9884c33827`.
- Double-press parent: combined prerequisites `b2c23b45da30e1c20114f4b5ee9a084abadad499`, also `prep/home-settings-0.5.0`.
- Review the final commit separately. An upstream-main comparison includes the open prerequisite PRs until they merge. Prepare as a draft and settle #119 ownership first; do not submit the combined build branch as an upstream PR.
- Distinct same-device down/up/down within 350 ms; first press immediate; repeat/duplicate/third-tap handling, event timestamps, navigation/reconnect cancellation. Independent app or linked Home tile, Samsung fallback. Available in overlay mode; inactive in Custom mode. Applying the setting restarts the active overlay.

## Client adapters

Separate branches named `compat/stock-vetro-0.5.0`:

- Glass Home: `pponce/glass-home-samsung-tv`, based on main `318778fb2028f944dff7c3d373ac8057f48ee4e4`. Uses `/apps` installed registry + `/dock` ordering, including eligible unpinned apps; `/dock/icon` then `/apps/icon`; existing guarded launch path. Saves selection, hidden state and custom-artwork priority. No per-app approval UI. Exact Samsung store artwork/catalog parity is not established by registry fixtures; test YouTube, Prime and unpinned entries on the TV.
- Garage Home: `pponce/garage-home`, based on `feat/vetro-controls` / `755fc205bccf72b83b197ee06b1bb14041902707`. Fixed same-TV service adapter for `/monitor`, `/components/action`, `/control` and `/tv-settings`. Removable visible user-app filtering, close confirmation/verification, no automatic repeat after uncertain writes; brightness opt-in plus confirmed TV support. Native Sources is unchanged.
- Neither client's default branch was changed. New PRs remain unsubmitted. Client CI results and exact heads are recorded in the delivery index. Garage Home head `66f6a378c60cc94dcbb1fc3c3a19fd7c4bcbdbc3` passed all package, unit and browser checks in run `42508972819`. Glass Home head `06621f448c956ca582abf1f5fc0b2aab6cec1ae4` passed the full service/API/browser suite and packaging in run `42509712172`; the focused picker acceptance also passed.

## Decisions and unresolved evidence

- Input lifecycle cleanup is already upstream; do not resubmit it.
- Keep stock owner authentication and screen checks. No new screen reliability PR without a stock reproduction/controlled comparison.
- Per-app permissions and separate screen authentication remain parked pending design discussion.
- Standby opening/automatic return remain deferred for future plugin key/app events. Tizen Start at boot is a separate feature.
- Never disable Samsung Home for a reboot test. No backups, TV configuration changes, TV installation or comment posting occurred in this work.
- CI and browser fixtures do not establish S95C or Q80A hardware behavior. #117 still needs the maintainer's Q80A/source-build comparison.

## Exact next steps

1. Review the paste-ready comments and optional prefilled new-PR links. Existing PR code is pushed; comments are not posted.
2. Before a requested installation, verify the existing signing profile and retained author identity. Ask before creating backups. Install the full integration package only after authorization; do not replace it with the app-only WGT.
3. First record stock S95C results: initial/reopen screen diagnostics, pairing, root/service/input recovery, ordinary wake and cold boot with Samsung Home enabled. Retain the unresolved stock remote-input/interception symptom as evidence, not as proof of a specific code fix.
4. For Home event comparison test raw-first, window-first, delayed echo through 1.5 s, duplicate window after external reopen, genuine second raw press and first after idle. Use controlled traces where raw/window ordering is not visible from the screen.
5. Test Samsung Home selection while a close is pending and while one is executing; confirm no later close hides the selected Home. Test CSFS/CoBA fallback as the firmware exposes it. The Q80A check remains with its owner.
6. Configure overlay mode, Home tile Samsung Home, double press Glass Home. Test immediate single, distinct double within 350 ms, slow double, long hold/repeat, triple tap, navigation cancellation, unavailable destination, app removal and reconnect. Confirm Custom mode does not run the overlay double gesture.
7. Test both Home editors, failed-save rollback, persistence after restart, restoration to Samsung Home, old code-63 rule behavior and other remapped keys.
8. Test Glass full installed choices and unpinned entries, YouTube/Prime art, selected/hidden persistence and uncertain launch handling. Test Garage native Sources, audio, confirmed user-app close, sleep cancellation and optional brightness readback. Do not infer artwork equivalence from package icons.
9. Only propose additional catalog/artwork or screen changes if these stock tests demonstrate a missing capability. Rebase the double-press commit after prerequisite review/merge.

## Resume environment

All local work is under `/workspace/scratch/9c8c3227522d/vetro`. `.work/reviews/{117,118,119}` contains isolated review worktrees. `.work/clients/{glass,garage}` contains verified text snapshots plus client edits. Remote GitHub commits are authoritative: local baseline history is synthetic and must not be pushed as git history. Remote trees preserve all unchanged binary payloads. Do not force-push local reconstruction history. Use expected-SHA ref updates.
