# Remaining TV acceptance

## Installed baseline

Vetro remains at `488cdccf3f08916addf4d5f2af567eecd5c105c7`. Glass Home source main is `30c490194f1748d523262a1ac8985fe45f735729`; verify the installed client when reporting results. Fast green diagnostics and three immediate reopen cycles were reported. No installation or TV settings change occurred during this preparation.

The source integration `f1eeaa30165a98a27502fc3f7b51a77db5238117` includes standby-only foreground opening, but that change is not yet installed. Its four-job CI result is not hardware acceptance.

## Confirmed permission results — 2026-11-05

The user reported fresh Recent activity for `GlassHome1.GlassHome` and confirmed that the launched app appeared on the TV. Times below are the reported local display times (America/Los_Angeles).

| Acceptance check | Evidence | Result |
| --- | --- | --- |
| Fresh app-list access through Vetro | Five `apps.list` entries marked `completed`, from 12:18:17 PM through 12:18:22 PM | Passed |
| One app launch through Vetro | `apps.launch` marked `completed` at 12:18:47 PM; user confirmed the app appeared | Passed |

### Pause/resume — passed

The user paused Glass Home's approval and attempted to refresh its app list. Glass Home reported that it could not read the Vetro app list, and the user saw no new Recent activity. This is the expected visible behavior while paused. No explicit server-side denial event was supplied, so the empty activity list alone is not treated as proof of a rejected apps.list dispatch. The user then resumed the approval and confirmed that Glass Home could access Vetro again and activity appeared in Recent activity. Pause/resume passes for the observed client behavior; no resume timestamp or additional raw activity rows were supplied.

### Revoke and reapproval — passed

The user revoked Glass Home's approval. Glass Home recognized that it no longer had access and offered Connect to Vetro. A new access request appeared in Vetro; the user approved it, returned to Glass Home and confirmed that access was restored. This confirms the observed revocation, new-request and owner-reapproval flow. No additional timestamp or raw activity rows were supplied for this step.

### Glass Home reopen — passed

After reapproval, the user closed and reopened Glass Home and confirmed that refreshing the app list worked. Client reopen access passes. No additional activity rows or timestamps were supplied for this observation, and it does not establish durable approval across a Vetro service or TV restart.

These observations establish a successful Vetro app-list and launch path, pause/resume behavior, revoke/reapproval flow and access after reopening Glass Home on the existing installation. Installed commit hashes were not independently collected with these results. Approval persistence across a TV/service restart, reduced scopes and standby/return behavior remain untested in this acceptance session.

## Glass Home on the existing installation

Use the existing paired browser and existing approval first. Open App permissions and check that Glass Home is enabled with List TV apps and Open TV apps. Do not reinstall or reset pairing.

1. Note the latest time in Vetro's Recent activity. In Glass Home choose +, wait for the app check, then Refresh apps once. Refresh requests in Vetro. Require a new `GlassHome1.GlassHome / apps.list / completed` entry and a successful client result. Saved tiles alone are insufficient.
2. Open one ordinary TV app from Glass Home once. Verify it becomes visible without a permission/uncertain-result error. Refresh requests in Vetro and require a new `GlassHome1.GlassHome / apps.launch / completed` entry. Visibility alone could be native fallback.
3. Reopen Glass Home and repeat the read without reapproving. This checks the approval already retained after the latest boot. Record that no new reboot was performed in this session.
4. Pause Glass Home in its approved-app details, then refresh apps from Glass Home. Record the client's refusal/unapproved state, the paused grant and any new denial activity. Cached tiles may remain. Resume and require a new successful apps.list entry.
5. Revoke Glass Home and repeat the refresh. Confirm approval is absent and Vetro access no longer succeeds. Connect to Vetro once, approve only the two intended scopes and repeat the read/launch checks.
6. If testing List TV apps alone, record that a native app opening does not demonstrate Vetro launch authorization. Adding a removed scope requires a fresh app request.

Record every result as observed, failed or not tested. Access-status responses are not always added as completed activity, so absence of activity alone is not proof of refusal. Do not share credentials, signer fingerprints or device identifiers.

## Standby-only opening on the integration candidate

Install the candidate only when a TV update is explicitly requested. Use the existing verified update/signing procedure and preserve install ledgers, owner pairing and saved remote preferences.

Test ordinary standby wake, remote-action cancellation, an expired wake window and cold boot separately. Vetro must dispatch within the fixed 20-second ordinary-wake window and skip every cold boot even if root is already ready. A target app visible after cold boot can result from Tizen Start at boot or native Autorun; use Vetro's startup decision to distinguish these mechanisms. The Tizen flag remains independent.

## Automatic return

Exercise return after another app exits, explicit Home, launch of a different app, input/menu navigation and standby. Require the selected return target only in the intended exit case; deliberate navigation cancels or suppresses pending return. When Glass Home initiates the launch, correlate with a completed Vetro permission launch before judging coordination. Record startup and return as separate results.

Fresh app-list, app-launch, pause/resume, revoke/reapproval and Glass Home reopen acceptance passed as recorded above. TV/service restart persistence, reduced scopes, standby-only and return checks remain pending.
