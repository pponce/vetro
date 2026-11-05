# Screen authentication recovery — 2026-11-05

## Objective and state

Keep the TV screen retrying after its first authenticated summary read fails.
An explicit HTTP 401 proves that the service answered; display authentication
recovery separately from an unavailable service. Preserve manual-only full TV
inventory, scoped private credentials, and the existing remote input lifecycle.

The installed diagnostic build remains
`e4033b41f29fc418228494db38364199026902a6`. The changes on
`combined/runtime-wrapper-observation-20261103` are a candidate for the next
combined update; they have not been tested on the TV or installed by this work.

## Implementation and checks

- Polling retries the initial `/screen` read even if no previous summary exists.
  After success it returns to the lightweight `/screen?live=1` route.
- Credential-read errors and explicit 401 responses have typed classifications.
  Only the latter are described as proof of service reachability.
- One immediate credential refresh remains the limit per refused request.
  Subsequent attempts use the existing polling interval. Stale-token 401s cannot
  invalidate a newer authenticated credential.
- Hidden screens, manual checks, one in-flight status read and response epochs
  retain their guards. Background recovery starts no service, enumerates no TV
  apps/packages, and submits no reports. A report-save failure remains visible.
- Local screen recovery, live status, status builder, probe UI, live HTTP,
  private credential/bootstrap, and comprehensive diagnostics tests pass.
  GitHub's full source, UI, launcher and combined-package jobs must pass on the
  exact candidate before offering it for installation.

## Separate unresolved Glass Home issue

Glass Home remains at `30c490194f1748d523262a1ac8985fe45f735729` on
`pponce/glass-home-samsung-tv`, `combined/vetro-permissions`. After reopening,
its app check timed out to the saved list and Connect produced no Vetro request.
The owner stopped both its UI and Photos service for that attempt. Glass Home
normally checks and starts Photos when opened; successful restart still needs
verification in the capture.

Vetro still reports its app port available with zero receiver events. That flag
is not delivery confirmation. The screen authentication fix does not establish
a fix for external native MessagePort delivery. Next, verify installed source
hashes and correlate Glass Home reply polling with the instrumented receiver on
the installed build. Keep identity, signer, explicit grants and protected-app
checks intact. Do not reinstall merely to repeat empty receiver counters.

Related: `app-request-input-handoff.md`, `glass-access-capture-handoff.md`.
