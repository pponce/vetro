# Test the combined Vetro and Glass Home work

Use a clean checkout of `pponce/vetro` branch `combined/permissions-startup-return`. Its complete `tools/update-both.sh` runs the existing update workflows: Glass Home first, Vetro last. It reuses existing signing tools/certificates and keeps startup/return selections. It needs the current TV IP, Mint IP and existing samsung-tv-tools project directory:

```sh
bash tools/update-both.sh TV_IPV4 MINT_IPV4 /path/to/samsung-tv-tools USER@MINT_HOST
```

The last argument is optional and prints report-copy commands. Before updating, let a power-on-only test run for about 30 seconds, without manually opening Netflix or restarting Vetro. The combined wrapper saves the currently observed startup/return status before updating either app. Updating Glass Home deliberately opens it and can cancel pending return; the capture precedes that step. The Vetro installer also saves another observation before replacing Vetro.

The installer may ask for the six-digit code shown by Vetro on the TV after the upgrade. Enter it in the Mint terminal. This pairs the maintenance tool; the browser pairs separately. Do not copy its owner credential into Glass Home. If an installation reply is lost, rerun the same build to resume verification; do not clear the saved attempt to force another install.

## Approval and compatibility

1. Open Vetro and pair its browser dashboard. Confirm root and the combined build revision.
2. Under **App permissions**, turn on app access. In Glass Home choose **+ → Connect to Vetro**.
3. In Vetro refresh requests, verify `GlassHome1.GlassHome` and its displayed installation/signing identity. Select **List TV apps** and **Open TV apps**, then approve. In Glass Home choose **Refresh apps**.
4. Open Netflix from Glass Home. Verify it stays in the foreground and a pending automatic return is cancelled. Test Home, Exit, another selected app and an input change. Test standby wake and cold boot separately.
5. Pause Glass Home's approval and refresh it. It should explain the permission state and keep its saved app choices. It must not use legacy HTTP to evade the refusal. Its own native app launch may still work; return coordination requires Vetro launch approval.
6. Approve app-list only, then check Glass Home explains that coordinated launch needs separate approval. Add permission through another explicit request. Updating/reinstalling Glass Home must require fresh approval.
7. With the new Glass Home and the older Vetro build, confirm the existing app-list and coordinated-launch behavior works without new approval. The new Glass Home can be installed before Vetro for this check; run the two Python installers separately if you want to pause between them.

## Task boundaries

Use a disposable removable user UI app to test `tasks.read`/`tasks.stop` through the SDK. System, preinstalled, protected and unknown targets must be absent from task results and denied as stop targets, including Netflix even though it can be opened. Test revocation while queued, service restart persistence and app update/uninstall invalidation. Do not try system task changes to establish this: inspect the API denial and activity result.

## What remains unverified locally

Real TV MessagePort identity, certificate retrieval, package events, storage and action behavior require this acceptance pass. Automated tests are fixtures, not hardware evidence. The permission-settings browser test runs in CI and uploads desktop/mobile captures. The existing startup timing remains unchanged; a failing power-on case should be diagnosed from the saved observation before further code changes.
