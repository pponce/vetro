# Permissions reply and startup handoff — 2026-11-04

## Objective and hardware state

Restore Glass Home's approved app-list and launch access, then verify power-on and return behavior. Installed Vetro is `95098ef5a6f472f49a542d8737d291fd65d6168b`. Its package-private screen bootstrap restored browser pairing; the user reports root and TV APIs available. After a cold boot, input policy reports connected with Home filtering active.

Glass Home's approval is saved, but its app list times out. The current hardware cannot reliably deliver service-to-widget MessagePort replies. The latest startup report independently shows a standby wake with monitoring ready after 168 ms, followed by expiration of the 20-second readiness deadline. It does not identify which preparation stage consumed the time.

## Source and changes

- Vetro candidate branch: `combined/runtime-wrapper-observation-20261103`, based on installed revision `95098ef5a6f472f49a542d8737d291fd65d6168b`.
- Authoritative combined branch remains `combined/permissions-startup-return`; do not reset or merge it during hardware acceptance.
- Glass Home companion branch: `combined/vetro-permissions`, based on `195e499e76ad4e9297c9962ce4347ad16bdb20be`.
- Version 2 app requests retain native MessagePort identity, installation/signer checks and explicit grants. Each request carries independent native-random reply ID/key values. HTTP retrieves only an ID-selected, HMAC-authenticated result; no operation or claimed identity is accepted over HTTP.
- Glass Home proxies only the reply ID through its authenticated local service. The widget verifies the exact reply body using bundled MIT js-sha256 v0.11.1. Native replies cannot complete a version 2 request, and polling never resubmits an operation.
- Reply records, replay records, polling, request sizes and concurrency are bounded. Permission-store revisions invalidate pending authorization and cached results, including a disable/re-enable cycle. Post-dispatch uncertainty never permits a duplicate fallback launch.
- Permission calls use a small live registry read retaining authorization fields and all package siblings. Startup reads only selected/resumed eligibility inside its dispatch guard. Neither relies on a stale registry cache. Startup retains its deadline, user cancellation and final source/foreground checks, with bounded stage timings.
- Glass installation verification requires capability version 2 and hashes the proxy, client and vendor files. Existing settings, signing material and attempt records are retained.

## Validation and remaining acceptance

Focused local tests cover actual HTTP routing, native request metadata, permission revocation, exact-body MACs, replay/expiry/resource limits, SDK browser compatibility, Glass service integration and installer resume behavior. The Glass integration test completes approval, app listing and launch with native reply delivery unavailable; native TV APIs are modeled. Full repository CI is required for the exact candidate commits before installation.

Hardware reply delivery through the new path, performance, full inventory, power-on launch and return remain unverified. Do not treat green CI, signed package installation, or a successful HTTP poll as hardware acceptance by themselves.

## Exact next steps

1. Require Vetro's four jobs and Glass Home's full CI to pass for the pinned candidate commits.
2. Update Vetro once using the existing beta updater, with expected-before `95098ef5a6f472f49a542d8737d291fd65d6168b`. Verify both running revisions and private screen authentication; preserve all earlier attempt records.
3. Update Glass Home using the revised `tools/install-glass-permissions.py` and its pinned companion commit. Require installed hashes and `/health` capability `vetroPermissions:2`.
4. Reapprove Glass Home if its installation identity changes. Verify actual app-list refresh and one intentional app launch. Revoke access and verify denial without a legacy launch.
5. Test cold boot and standby wake with no remote activity, then cancellation on remote activity. If skipped, collect the startup stage timings. Verify return behavior and saved selections afterward.

No undocumented firmware object conversion, no-source credential acceptance, owner-token sharing, or SDB security-policy change is part of this correction.
