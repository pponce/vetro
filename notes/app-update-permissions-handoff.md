# App permissions across verified updates

## Objective

Preserve already approved app permissions during verified in-place updates. Keep fresh approval for new scopes, uninstall/reinstall, signer changes and changes that cannot be verified. Prepare a complete replacement for upstream issue #138 using its latest live body, including the Samsung catalog and icon work. Do not post the issue body automatically.

## Repository and baseline

- Repository: `pponce/vetro`.
- Integration branches: `main` and `combined/runtime-wrapper-observation-20261103`.
- Baseline: `3268cf3d84d18a8f3046af8425c49d0ac4f6932d`.
- Preserve the Glass Home client at `5edd0180dd67c7f2eb1e478253a054ba77272594` and its CI run `42132657237` in the issue replacement.
- The live issue was reread after the owner updated it. Its body at `2026-11-05T23:59:47Z` includes both `apps.catalog` and `apps.icon`; retain those additions and the existing upstream contribution questions.

## Implementation and decisions

- Native package callbacks now distinguish updates from installs and removals.
- While package monitoring is active, establish continuity only for a currently matching approved installation. Grant approval also records that installation during the same monitoring session.
- On a native update, require the same app ID, package ID and verified author signer. Match the callback's version, last-modified timestamp and app membership to fresh native identity data. Retain only the existing scopes and paused state, update the complete installation fingerprint and rotate the grant generation.
- Persist the new grant atomically. Keep the strict full-fingerprint checks and live eligibility checks on every API call. Invalidating old queued calls, package epochs and authenticated replies still applies.
- Installs, removals, mismatched or unavailable identity, stale event metadata and changes missed while Vetro was stopped require approval. A later update must not restore a stale or revoked grant. Late callbacks from a stopped listener are ignored.
- No client API, owner pairing, screen authentication or permission-store schema changes. Existing valid approvals can be used without migration. This does not recover approvals already revoked by an older Vetro version.
- The permission screen, API documentation and TV acceptance guide describe the current update behavior and the requirement to keep Vetro running during updates.

## Validation checkpoint

- All 29 new update scenarios pass locally, covering retained scopes, same-version updates, paused/reduced/global-off settings, fresh requests, installation events, identity changes, stale metadata, restart and monitoring gaps, live eligibility, pending requests, queued/dispatched calls, persistence failures and native listener lifecycle.
- Existing access, MessagePort, scoped API, authenticated reply, diagnostics, widget transport, HTTP authorization and permission-UI suites pass locally.
- The local source snapshot is partial; use the complete GitHub checkout in CI for the full application, rooting, installer, release-audit, browser, launcher and package checks. Publish only intended changed paths on the real remote tree; never replace the repository with this partial snapshot.
- Physical update-retention behavior is not yet verified on the TV. Install the new Vetro before a later client update; keep Vetro running, verify retained scopes and actual API calls, then test a paused approval and restart persistence. Destructive uninstall/reinstall tests are optional and can remove client data.

## Remaining steps

1. Verify the current heads of both integration branches and preserve concurrent changes.
2. Publish the candidate, run all four CI jobs and verify the unsigned combined artifact and immutable source revision.
3. Reread issue #138 before generating the full replacement. Update Vetro source/build/documentation links; retain Glass Home's tested client and all catalog/icon text. Describe automated results and pending TV acceptance accurately.
4. Deliver the complete copyable replacement body and the new build link without editing the upstream issue.
