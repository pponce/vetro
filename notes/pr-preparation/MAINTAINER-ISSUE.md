# Contribution planning: TV reliability, app permissions, and Home/startup improvements

Draft only; the user plans to open this issue. Nothing has been submitted.

---

Hi Andrea,

I've been developing and testing a set of Vetro improvements on my Samsung S95C running Tizen 9. I'd like to contribute the parts you think belong upstream. Before opening more PRs, could we agree on the scope, target branch and review order?

The combined build includes:

1. **Faster checks when opening Vetro.** Five quick readiness checks, with the longer TV API and app/package checks available by pressing OK. Status and pairing can appear without waiting for the full inventory, and status continues updating while the screen is open.

2. **Screen, service and remote-input reliability.** Reuse an already-running service, cancel outstanding screen work on exit, recover from initial check failures, release input listeners/helpers when the service stops, and prevent old callbacks from interfering with a replacement service. The saved remote configuration can reconnect after a service restart or update.

3. **Owner-approved app permissions.** An optional API for installed TV apps, off by default. Owners review each app's verified identity and requested permissions, approve selected controls, view recent activity, and reduce, pause/resume or revoke access. Available scopes cover app listing/launching, eligible user-app task controls, brightness, audio/playback and standby. Task controls exclude system and protected apps; clients do not receive owner credentials or shell access. Glass Home is the working client example for app-list and app-launch access.

4. **Separate authentication for Vetro's own TV screen.** A limited, short-lived credential delivered through package-private storage, with credential renewal/recovery and service ownership checks. This supports the permission boundary while keeping the screen's status, diagnostics and pairing-code access working.

5. **Home and launcher improvements.** Short-press/duplicate-event handling, coordination between the launcher and physical Home key, a configurable launcher Home tile and label, and one shared Home assignment across Launcher and Remapper. Home can use Samsung Home, toggle Vetro's launcher, or open a selected app; saved mappings can be edited and restored.

6. **Open a selected app after standby wake.** One optional foreground destination, with a bounded 20-second readiness window and cancellation when the user starts navigating. Cold boot is explicitly excluded. Tizen's separate **Start at boot** setting is unchanged.

7. **Return to a selected app after another app exits.** A separate option for returning to a preferred home app when another app falls back to Samsung Home or TV. It coordinates with observed Home/app/input choices and the native launcher so a pending return can be cancelled.

8. **Update and diagnostic tooling.** Helpers for signing/install verification, checking the running screen/service revision, restoring saved remote setup and collecting connection/startup/return evidence. These can remain separate from the feature PRs.

The existing Home work is in #113, #117, #118 and #119. I'd like to keep those review threads and coordinate any overlapping changes.

If you'd like to try the integration:

- **Pinned source:** [pponce/vetro at `f1eeaa3`](https://github.com/pponce/vetro/tree/f1eeaa30165a98a27502fc3f7b51a77db5238117). This is the source currently on my TV, also on my fork's main and `combined/runtime-wrapper-observation-20261103` branches.
- **Combined package and CI:** [build run 42096796688](https://github.com/pponce/vetro/actions/runs/42096796688), artifact **vetro-combined-unsigned**. It contains the unsigned WGT, source revision and checksums. It needs your own author certificate and a **Partner-level distributor certificate** covering your TV because app identity verification uses `appmanager.certificate`. The artifact is currently retained until November 19.
- **Permission walkthrough:** [Glass Home test guide](https://github.com/pponce/vetro/blob/f1eeaa30165a98a27502fc3f7b51a77db5238117/app/docs/APP-PERMISSIONS-TEST.md), with the pinned client and setup instructions.

All four CI jobs passed. On the S95C, testing has confirmed quick green checks, repeated close/reopen cycles, remote reconnection, and Glass Home app-list/launch activity. Pause/resume, revoke/reapproval and refreshing after reopening Glass Home worked. Standby opening, cancelling it with remote navigation, and automatic return have also worked. Cold-boot nonlaunch was checked previously.

There are still testing limits: one return attempt missed before a successful repeat, and the wider permission scopes have not had the same TV acceptance as app-list/launch. The extracted upstream branches have automated checks but have not been installed independently on the TV.

For submission:

- Which of these areas fit your plans, and which would you prefer to leave in the fork?
- Should new PRs target `main`, `release-0.5.0`, or another branch?
- Would you prefer to start with the screen checks and input lifecycle fixes, then review permissions and the optional Home/startup/return features? I've prepared focused screen and input branches against `release-0.5.0`; both pass source checks and leave upstream authentication unchanged.
- Should the screen-authentication prerequisite and app permissions be separate dependent PRs or one review? The combined fork currently differs from upstream's owner-session storage and pairing flow. For upstream submission, I plan to preserve existing owner sessions and pairing behavior and adapt the needed screen/app boundary changes around them.

The work was developed with AI assistance and tested as described above. I'm happy to adjust the split and order to make review manageable.
