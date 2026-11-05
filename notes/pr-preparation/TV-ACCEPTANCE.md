# Remaining TV acceptance

## Verified update and installed state

Report: `connection-report-20261105-124305-997919.json`, captured at 2026-11-05T20:43:32.928626Z.

| Check | Evidence | Result |
| --- | --- | --- |
| Running service and screen revision | Both match `f1eeaa30165a98a27502fc3f7b51a77db5238117`; service sourceDirty=false | Passed |
| Screen authentication and quick checks | capture.complete=true; sessionReceived=true; serviceAuthenticated=true; summaryReady=true; quick checks finished | Passed |
| Private screen credential | bootstrapTransport=private-storage; bootstrap ready with no error | Passed |
| Remote-input handoff | Old filtering helper exited; final mode=filter, connected=true, savedEnabled=true, homeReady=true; verified=true | Passed |
| Automatic input restoration | resumeRequested=false; observationRequested=false at completion | Passed |
| Existing signing identity | authorCertificateUnchanged=true | Passed |
| Glass Home app-list access after update | User reports that Glass Home retained access in response to the post-update check | Passed, user-observed |

The user reported all green checks after opening Vetro, with a brief red remote-input check that quickly turned green without intervention. The report contains an earlier screen sample with connected=false and a later successful input-handoff verification with connected=true. It supports recovery during this startup, without establishing the precise recovery duration or every future reconnect.

The collector completed after 9.1 seconds of observation; this is not total build/install time. It recorded one transient URLError. The CLI returned zero but did not provide the structured install/launch confirmation expected by the updater. The matching live service and authenticated screen independently establish the installed revision, so this is not a reason to reinstall. The outer status response says to pair the requesting device because that diagnostic fetch was unauthenticated; the screen and maintenance input checks authenticated successfully. The incomplete MessagePort reply matrix does not invalidate the private-storage screen path.

The preceding Vetro baseline was `488cdccf3f08916addf4d5f2af567eecd5c105c7`. Glass Home source main remains `30c490194f1748d523262a1ac8985fe45f735729`; its installed revision was not independently collected by this Vetro report. No new raw Glass Home activity rows or post-update app-launch result were supplied. App-list access across the Vetro update/service restart is now user-confirmed; a full TV restart and standby/return behavior remain separate pending tests.

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

The permission-control observations in this section preceded the integrated update and establish a successful Vetro app-list and launch path, pause/resume behavior, revoke/reapproval and client reopen access on the earlier installation. The verified update and subsequent user-confirmed app-list access are recorded above. A full TV restart, reduced scopes and standby/return behavior remain untested in this acceptance session.

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

The requested integrated update is verified above. Use the existing installation for this test. Select Glass Home as the foreground target, open a different ordinary app and let it settle, then perform a normal standby/wake cycle with short Samsung remote Power presses. Leave Start at boot and native Autorun unchanged. Keep the remote idle after wake; capture the startup event before any further TV navigation.

Test ordinary standby wake, remote-action cancellation, an expired wake window and cold boot separately. Vetro must dispatch within the fixed 20-second ordinary-wake window and skip every cold boot even if root is already ready. A target app visible after cold boot can result from Tizen Start at boot or native Autorun; use Vetro's startup decision to distinguish these mechanisms. The Tizen flag remains independent.

## Automatic return

Exercise return after another app exits, explicit Home, launch of a different app, input/menu navigation and standby. Require the selected return target only in the intended exit case; deliberate navigation cancels or suppresses pending return. When Glass Home initiates the launch, correlate with a completed Vetro permission launch before judging coordination. Record startup and return as separate results.

Fresh app-list, app-launch, pause/resume, revoke/reapproval and Glass Home reopen acceptance passed before the update. The integrated update, automatic input restoration and post-update app-list access now pass as recorded above. Post-update app launch, full-TV-restart persistence, reduced scopes, standby-only and return checks remain pending.
