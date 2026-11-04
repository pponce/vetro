# App request receiver and update input handoff — 2026-11-04

## Objective and current state

Restore Glass Home's explicitly approved app-list and launch access, while
preserving working remote input across the next diagnostic update.

Installed Vetro is clean `ce92708f55211738f3866756e287b5fb634c0b23` from
`pponce/vetro`, `combined/runtime-wrapper-observation-20261103`. Glass Home is
`30c490194f1748d523262a1ac8985fe45f735729` from `pponce/glass-home-samsung-tv`,
`combined/vetro-permissions`. The authoritative Vetro branch
`combined/permissions-startup-return` remains unchanged.

The latest successful inspector capture waited 16.6 seconds for widget startup
and observed 60.5 seconds. It saw one Connect busy interval, 36 successful outer
HTTP responses and 36 inner 404 responses. No reply record, pending permission
request, grant or Glass Home handler event was observed. Earlier approval had
been deliberately revoked; zero grants is expected. This narrows the current
problem to native request delivery or rejection before dispatch. It does not
identify which native receiver check failed.

Normal-mode relaunch at capture cleanup was intentional. The missing app list
during debug mode was not intentional. Glass Home retains a local cached app
list; the list's reappearance does not verify fresh permission or a successful
refresh. The report did not capture its state after normal relaunch.

## Candidate change and validation

Runtime candidate `89eff781563e96ef36d9ce04b078c20329fedccf` adds opt-in, bounded app-request diagnostics for receive,
sender metadata, frame/parameter validation, reply reservation and handler
dispatch/completion. Reply-cache refusals have fixed reason labels. No request
contents, credentials, reply IDs/keys, user app names or raw error text are
retained. Diagnostic failures cannot change validation or dispatch. Native
identity, signer, explicit approval and protected-app checks are unchanged.

Local suites pass for the new telemetry, existing native app ports, authenticated
HTTP replies, connection diagnostics, physical-input lifecycle, input persistence
and service lifecycle. Require all four CI jobs on the exact candidate revision
before installation; modeled tests do not establish hardware success.

Runtime CI run `41909711698` passed `check` and `permissions_ui`. `launcher`
failed at **Headless launcher control and privilege boundary**; `combined_package`
was skipped. No launcher source was changed by this candidate. The failure's
cause is unknown: connected GitHub reads expose job/step results but not logs,
and browser/direct unauthenticated log retrieval was unavailable. Do not infer
that it is harmless or bypass the four-job installation gate. Obtain that
step's failure output or rerun the failed jobs through GitHub before proceeding.

## Remote input and screen checks

The fresh cold boot restored input. Earlier evidence showed an input helper and
its service connection surviving a package update. The native helper releases
its input grab when the owning socket closes; the current service lifecycle
contains stop/cancellation guards. The input failure is not proven to have been
caused by screen checks. Quick checks do not write remote configuration. Full
diagnostics, selected with OK, enumerate apps/packages and can block the widget's
JavaScript thread; they are unnecessary for this installation verification.

Use the existing temporary observation mode before replacing the package, then
resume the saved input plan after verifying the new service. Verify the old
filtering helper actually exits before installation. Preserve saved mappings;
do not persist an Off setting, kill remembered PIDs, or treat a delay as proof
that the grab was released. The host updater must save its input-handoff outcome
and return failure if the new input connection is unverified.

Host helper revision `fc7b8663a7708e85a1f3427bfb62b001a2442345` on
`combined/runtime-wrapper-inspection-20261103` implements that
sequence in `input_update_handoff.py` and `update-connection-diagnostics.py`.
The current helper must be uniquely associated with the active service by its
native callback connection. After temporary observation is confirmed, the host
checks the exact old PID/start-time pair through read-only `/proc` access and
requires that process to have exited. No input Off preference is persisted and
no PID is killed. If the new service already restored a healthy filter, it is
verified without restarting it. An in-progress filter gets a bounded wait.
Resume is requested only when a filter is not already active. Failed preparation
restores the baseline when possible; an uncertain installation remains a single
attempt and never triggers another install. A small transition journal retains
only status/process facts, not a configuration backup.

The normal-mode collector `watch-app-requests.py` reads the receiver diagnostics
and permission summaries around a user-initiated Connect. It does not relaunch
apps, use Web Inspector or mutate settings. The host suites cover the no-reinstall
guard, helper release proof, no interference with an automatically restored
filter, restoration failure, baseline cleanup and normal-mode capture.
All 70 available local host tests pass. The repository runner
`tools/run-app-request-update.sh` pins that helper revision and all five helper
hashes. It accepts project root, TV address, local computer address and report
destination as arguments. It runs the normal-mode collector only after the
update verifies service, screen authentication and input. Do not run it while
the required runtime CI jobs are failing.

## Next steps

1. Resolve the failed launcher CI step; do not install the candidate yet.
2. Require source, UI, launcher and combined-package CI for the runtime candidate,
   plus successful host-tool checks. The complete runner pins both the source
   and helper checksums and refuses installation when these runtime jobs fail.
3. Submit one in-place update with the existing signing identity. Verify both
   service/screen revisions, authentication and restored input. An uncertain
   installation is collected, never automatically submitted again.
4. Collect receiver diagnostics around Connect to Vetro in normal Glass Home
   mode. Use the first failed stage to choose the functional fix.
5. Verify approval, live list refresh, one intentional launch, revocation and
   denial. Then finish power-on/return and saved-settings acceptance.

Prior detail: `glass-access-capture-handoff.md` on the host-tools branch and
`input-lifecycle-handoff.md`. Raw reports and personal network details are not
included in the source changes.
