# Vetro 0.5.0 contribution and compatibility plan

Updated 2026-11-08. Implementation has begun following the stable release and the requested PR work.

The current source/build checkpoint, exact branches, validation and remaining acceptance checks are in [upstream-0.5.0-handoff.md](upstream-0.5.0-handoff.md). Review messages and prefilled new-PR links are in [upstream-0.5.0-delivery.md](upstream-0.5.0-delivery.md).

## Completed source work

- Reviewed the final 0.5.0 baseline and current main. Input lifecycle cleanup is already upstream.
- Updated existing #113, #117, #118 and #119 branches independently against upstream main. All four pass CI.
- Prepared optional independent double press on the Home prerequisite stack. Its CI and the combined integration build pass.
- Prepared separate Glass Home and Garage Home adapters for stock APIs, retaining client preferences, filtering and confirmations. Client validation/artifacts are tracked in the delivery index.
- Produced a complete unsigned Vetro integration artifact with the launcher compiled from the corresponding source. No comments or new PRs have been submitted, and no TV installation has been performed.

## Review order

1. #113: compare residual event/echo behavior against stock on the TV; retain the 1.5 s echo protection.
2. #117: review actual in-flight close completion, then the requested Q80A/source-build comparison.
3. #118: review independent editable overlay Home tile and unavailable-app fallback.
4. #119: agree on stock native launcher ownership and the shared editor; keep draft during that discussion.
5. Double press: review the feature commit separately, then rebase after prerequisites. Do not submit the combined build branch as a PR.
6. Client adapter PRs: review against each fork's intended base, then verify installed app choices, artwork, preferences, native Sources and controls on S95C.

## Held work

- Screen reliability/service reuse: first reproduce and record the stock screen/input behavior. Keep upstream authentication. No screen patch is justified solely by the older fork's results.
- Per-app permissions and separate screen authentication: parked; design discussion first if revisited.
- Standby opening and automatic return: deferred for future plugin key/app events. Keep Tizen Start at boot separate.
- Catalog/artwork extensions: only propose a small independent change if stock endpoint acceptance demonstrates a specific gap.
- Signing/install helpers stay outside application packages. Verify signing identity before a requested install; ask before backups. Samsung Home must remain enabled for reboot tests.

## Evidence limits

Current CI and browser results are source validation. They are not S95C/Q80A hardware validation. Previous combined-build hardware reports do not validate the rebased heads. The exact test matrix is in the handoff.
