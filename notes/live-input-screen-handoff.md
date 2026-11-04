# Live input screen and approval follow-up — 2026-11-04

## Objective and current state

Keep Vetro's input health display current after reconnection, and restore Glass Home's permission request/approval flow. The TV's report `connection-report-20261104-001344-292474.json` verifies clean Vetro revision `fc0b236878a2249906edf774888f5a39f46842c0`, matching screen revision and authenticated screen/service communication. Storage reports ready. The owner reports Home opens the Vetro launcher despite a saved-remote-disconnected warning.

The report does not contain the live input policy, so it cannot establish whether the warning reflected a transient disconnect or another input path. The screen source does establish a stale-display bug: it reads `/screen` once after checks, whereas input recovery continues every five seconds. Saved event-node changes alone do not control the connected flag.

## Changes and validation

- The visible screen refreshes only root/input connection facts every five seconds. It preserves explicit API and launcher check results, suppresses overlapping reads, and discards responses from an older check/visibility epoch.
- `/screen?live=1` stays under the existing widget/owner authorization gate, disables caching and runs no root command or launcher process probe.
- Failed reads show unknown status. Reconnecting is reported only while recovery is actually in progress. Disconnected input no longer claims that the physical remote is absent.
- Connection reports retain only allowlisted input booleans and the last successful read timestamp, without remote names, nodes, events, raw errors or credentials.
- Focused live-screen VM/HTTP, screen summary, connection diagnostics, widget/bootstrap, input persistence and Home routing tests pass. Full CI and TV verification remain required for this revision.

No input preferences, native helper processes, grabs or lifecycle callbacks were changed. Native helper source already releases its grab when the callback socket closes. Service stop callbacks omit input cleanup, but that separate gap has not been established as the cause of the reported warning.

## Concurrent permissions finding

After revoking Glass Home, the owner sees `GlassHome1.GlassHome / access.request / unavailable` and no pending approval. This establishes request receipt and a failure before creating approval. It does not identify whether the failure is storage/readiness, native installed identity, or live registry validation.

Glass Home needs companion revision `30c490194f1748d523262a1ac8985fe45f735729` for authenticated HTTP replies; its `/health` reports `vetroPermissions:2`. Installation of that companion is not yet confirmed in this follow-up. Updating the client does not by itself repair a service request that fails before creating pending approval.

The new permission registry reader is stricter than the old full inventory reader: existing owner-database errors, duplicate/invalid rows, incomplete output, and its four-second execution limit can reject the read. No evidence yet identifies one of those causes. Do not ignore ambiguous flags or owner database errors to make approval succeed.

## Repositories and next steps

- Vetro: `pponce/vetro`, candidate branch `combined/runtime-wrapper-observation-20261103`; installed base `fc0b236878a2249906edf774888f5a39f46842c0`.
- Glass Home: `pponce/glass-home-samsung-tv`, branch `combined/vetro-permissions`, candidate `30c490194f1748d523262a1ac8985fe45f735729`.
- Authoritative Vetro branch remains `combined/permissions-startup-return`.

1. Read current owner `/app-access` readiness/error, `/status.self.uid` and root connection, and `/input` policy/error. A read-only browser-console check has been provided.
2. Confirm Glass Home capability version 2. If absent, use the previously prepared pinned Glass update block.
3. If permission readiness is healthy, diagnose the exact live registry queries using the service UID, reporting schema failures, counts, invalid/duplicate rows, output size and elapsed time. Keep identity lookup failure as an alternative until ruled out.
4. Fix the observed approval failure without weakening identity, grant or protected-sibling checks; then require CI before another combined TV update.
5. Verify live warning recovery, Glass approval/list/launch/revocation, and then resume startup/return acceptance. Keep all installation attempt records.
