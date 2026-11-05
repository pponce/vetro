# Test app permissions with Glass Home

This guide exercises Vetro's optional app API with a real client. Glass Home requests only **List TV apps** (`apps.read`) and **Open TV apps** (`apps.launch`). The TV owner approves them in Vetro; Glass Home does not receive the owner's browser or API credential.

## Build the test client

Use [pponce/glass-home-samsung-tv at `8aa83f1ec60566e5a8a56d2520856ae9dcf1f3d9`](https://github.com/pponce/glass-home-samsung-tv/tree/8aa83f1ec60566e5a8a56d2520856ae9dcf1f3d9). Pin that commit when comparing results. Its app ID is `GlassHome1.GlassHome`, and its photo service is `GlassHome1.Photos`.

Follow the client's [installation guide at that revision](https://github.com/pponce/glass-home-samsung-tv/blob/8aa83f1ec60566e5a8a56d2520856ae9dcf1f3d9/docs/INSTALL.md), using the fork above for the source checkout. Configure `scripts/tizen-env.sh` with your own TV and signing profile. `scripts/build.sh` creates `dist/GlassHome.wgt`; `scripts/install.sh` installs and opens it. Keep the generated local key and signing credentials out of source control. Use your own author certificate and a distributor certificate that covers your TV.

Glass Home uses public-level privileges. **The Vetro permission build requires Partner-level signing**, including `appmanager.certificate`, so it can verify installed app identity. The two apps do not need the same author certificate. See [App permissions](APP-PERMISSIONS.md) for the exact API and prerequisites.

Keep Glass Home's photo service enabled: this client uses it to retrieve authenticated replies. Its `/health` response includes `vetroPermissions: 2`. That capability alone does not prove that Vetro received or approved a request. Keep the development connection configuration appropriate for your installation method; testing permissions does not require changing Samsung's Home, Autorun or startup settings.

## Approval and use

1. Install the candidate Vetro build and open its TV screen. Verify that the running screen and service match the candidate, authentication succeeds, and root and the saved remote setup are ready. Open the dashboard in your own paired browser.
2. In **App permissions**, enable app access. Start from no Glass Home approval, or revoke its existing approval for this test.
3. In Glass Home, open **+**, wait for its app check to finish, then choose **Connect to Vetro** once. In the Vetro dashboard, refresh requests. Confirm the installed Glass Home identity and only the two requested permissions above.
4. Approve both permissions and save. Return to Glass Home and choose **Refresh apps**. Verify the list comes from Vetro using `apps.catalog`. A previously saved list can remain visible when access fails, so tiles alone are not proof of a successful read.
5. Open one ordinary installed TV app from Glass Home. Verify that it appears and that there is no reported permission or uncertain-result error. Glass Home has native fallback behavior in some situations, so an app opening by itself does not prove Vetro handled it; correlate the client result with Vetro's permission activity when available.
6. Reopen both screens and refresh the list again. After a TV restart, repeat once root is ready. Vetro should retain approval when the installed Glass Home identity has not changed.

## Samsung Apps and Home selection

The catalog uses Samsung's installed web-app metadata and Home-row cache. Verify
its coverage on the actual TV; firmware can differ. It does not include apps
that are only recommended in the store and have not been installed.

1. In Samsung Home, compare the installed/downloaded apps in **Apps** with the
   apps pinned to the Home row. Identify an installed app that is not pinned.
2. In Glass Home, choose **Refresh apps**, then **Choose apps**. Confirm that both
   pinned and unpinned installed apps appear with consumer names. Registry-only
   Cobalt components must not appear solely because their native label is “App”.
3. Choose **Use Samsung Home selection**. Confirm that only eligible Home-row
   apps are checked, in Home order. Save. Inputs and system controls have their
   own UI and should not become app choices.
4. Select an unpinned app, save, close and reopen Glass Home, then refresh. The
   explicit selection should remain. Check Netflix when it is installed,
   including when it is absent from the Home row.
5. **Select all** saves the current list. **Clear selection** saves no apps.
   **Use Samsung Home selection** restores the Home default. Cancel and Back
   discard edits; failed saves must not claim success.
6. Pause or revoke app access during a refresh. A failed or incomplete read
   keeps the last complete cached catalog and choices. No legacy endpoint should
   be used to bypass the denial. Reapprove and refresh to recover.

Clients follow all pages, compare the catalog revision across pages, and respect
Vetro's request rate. Automated tests exercise more than 100 entries; a small TV
catalog does not require installing extra apps to reproduce that test.

## Permission controls

| Test | Expected result |
| --- | --- |
| Click an approved app row | Opens its permissions and Save, Pause/Resume and Revoke controls; the collapsed row shows its status. |
| Approve only List TV apps | Fresh app-list reads work; Vetro app launches are denied. A native Glass Home launch is not evidence of a Vetro grant. |
| Pause Glass Home | New Vetro calls are denied while the saved approval remains paused. Resume restores only the saved scopes. |
| Revoke Glass Home | New Vetro calls are denied; the app needs a new request and owner approval. |
| Disable app access | New app calls are denied; saved approvals remain available when the feature is enabled again. |
| Update or reinstall Glass Home | Installation identity changes invalidate approval; request it again. Re-signing may require the platform's normal uninstall/install flow, so this test is optional and can remove client data. |
| Lose a reply during a launch | The client reports an uncertain outcome and does not send a second launch automatically. Inspect the TV before retrying. |

Pause, revoke and scope changes cancel operations still waiting for dispatch. They cannot undo a command already sent to the TV. Saved app tiles and native fallback must not be mistaken for continued Vetro access.

## Automated coverage and reporting

Run Vetro's `node app/tests/run.cjs` and the repository CI jobs. These include identity, grant storage, protected-app rules, native port framing, authenticated reply verification, HTTP authorization, screen authentication and lifecycle tests. The browser job exercises the permission controls. Glass Home has focused tests in `dev/test-vetro-permissions.js`, `dev/test-vetro-replies.js` and `dev/test-vetro-reply-integration.js`.

The Glass Home flow does not exercise task stopping, brightness, volume/playback keys or power-off permissions. Review those scope tests separately and test applicable operations on a suitable TV before claiming hardware support. Rooted apps already outside the platform isolation boundary are not sandboxed by this API.

Report the exact Vetro and Glass Home commits, TV model, firmware/Tizen version, signing privilege level, and each observed result above. Distinguish automated results from TV results. Share only redacted diagnostics; omit credentials, reply keys, certificates, device identifiers and private network details.
