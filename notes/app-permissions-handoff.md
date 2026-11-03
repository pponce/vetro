# Combined app permissions implementation handoff

Branch: `combined/permissions-startup-return`. This combines the app-permissions feature with `combined/startup-return-launcher` at `3ab232edf936f5a6829b94814ba5873fdf702512`, including its final native launcher DLL. The original combined and feature branches remain separate. Glass Home's companion is `combined/vetro-permissions` at `195e499e76ad4e9297c9962ce4347ad16bdb20be`, based on `690f53d7553eb94f8f17edf636defc219d15c1fb`.

## Implementation

- Owner pairing adapts zerodevb's PR #9, head `0983b97f980acbed7e43ac64181f07089f2313c8`. The pairing UI is reused; local HTTP is no longer exempt. Owner credentials and scoped app permissions are separate. Security state is private, hashed where appropriate, atomic and fail closed.
- App MessagePort is off by default. OS-supplied caller identity, author signer, package/version/install time and package-change events bind and invalidate approvals. Approval generations stop queued calls after pause/revoke/reapproval.
- Settings expose explicit requested scopes, chosen subsets, identity review, reduce/pause/resume/revoke, revision conflicts and recent bounded activity.
- Task read/stop only permits verified removable user UI apps: no system, preload, protected, hidden, ambiguous or Vetro components and no unsafe siblings. No raw PIDs, shell, uninstall, disable, installation or startup controls are exposed to apps.
- Listing/opening visible TV apps is a separate permission and permits preinstalled media apps. Launch targets require verified registry and installed package identity, with another check at dispatch. This permits Netflix without granting system-task access.
- Brightness uses the existing bounded, confirmed setter/readback/rollback path; audio/playback/standby use fixed keys. Authorize again at dispatch. A submitted marker differentiates safe refusal from uncertain mutation outcomes.
- Startup/return async queue guards retain their original strict boolean behavior. Scoped launches use the shared intentional-navigation path, preserving return cancellation, Home routing and the compiled native navigation protocol.
- Glass Home requests only `apps.read` and `apps.launch` from an explicit Connect action. Older Vetro retains legacy discovery/coordinated launch. New permission denials and timeouts cannot downgrade. Native launch fallback requires a definite pre-dispatch refusal. No owner token is stored in Glass Home.
- Maintenance tools pair as an owner when HTTP returns 401, store credentials privately on the host, and never retry uncertain mutations. A complete combined wrapper updates Glass Home first and Vetro last, preserving the certificate and Developer Mode setup. Existing install ledgers prevent duplicate submissions.

## Checks and remaining validation

Local checks: 84 Vetro application suites; 9 integration suites including Node 4 compatibility; 39 Python installer/owner-client checks; diagnostic parser and release audits; Glass Home unit checks including both old/new Vetro paths, partial approvals and no duplicate launches. Browser acceptance is configured in CI; local Chromium and .NET SDK are unavailable. Read the actual CI results before claiming those checks pass.

Hardware is still required for trusted widget pairing, service-side Tizen APIs, author-certificate privilege, private storage, registry flags, package events and actual TV operations. The Partner certificate privilege is required. Unsupported identity/transport stays unavailable. Startup timing was not changed to guess at the outstanding Netflix power-on behavior. Capture the current power-on result before manual launch or settings changes.

See `notes/combined-permissions-testing.md`, `app/docs/APP-PERMISSIONS.md`, `app/docs/SIGN-IN.md` and `tools/README.md`. Do not weaken identity verification or task-target restrictions for compatibility.
