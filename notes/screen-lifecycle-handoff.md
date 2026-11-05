# Screen lifecycle checkpoint

## Objective and branches

Make normal Back exit and reopening reliable while retaining fast authenticated
diagnostics, pairing, saved remote input and Home routing.

- Runtime: `pponce/vetro`, `combined/runtime-wrapper-observation-20261103`.
- Installed baseline / parent: `6104eeaa7507d10f28edb68f08e37cff4d627aa5`.
  All four jobs passed in CI run `41962819197`.
- Host tools: `pponce/vetro`, `combined/runtime-wrapper-inspection-20261103`.
- Glass Home: `pponce/glass-home-samsung-tv`, main at
  `30c490194f1748d523262a1ac8985fe45f735729`. No new Glass Home build is needed.

## Hardware evidence

After a cold boot, the user reports very fast green Vetro checks. The pasted
`input-recovery-20261105-160845-206224.json` console output shows its first
sample already had mode=filter, connected=true, Home ready=true and
recovering=false. That path verifies the saved setup without submitting resume.
The JSON itself has not been supplied or read.

Subsequent user testing: reopening after leaving Vetro closed a long time was
fast and green. Immediately reopening after another Back exit failed; another
attempt about 45 seconds later failed; the third attempt opened and went green
quickly. Thus normal reopening remains unresolved even after cold boot. This
does not establish a fixed 45-second timeout or a diagnostic/authentication
failure during that session.

The earlier passive capture documented long-lived screen process candidates,
including D state. It did not collect a wait channel or stack. Successful forced
Web Inspector relaunches do not validate ordinary Back exit.

## Implemented changes

The screen used to issue a service-start request on every opening and manual
check, even while an authenticated service was already running. Back, visibility
changes and queued idle callbacks could also request exit repeatedly.

- Read authenticated `/status` before requesting a service start. Reuse a
  successful service. An HTTP refusal or invalid HTTP body proceeds to normal
  connection recovery without issuing another start. It is not counted as
  successful authentication.
- Retain `wrt:service` and the existing older-runtime fallback for an unavailable
  service. The startup probe is bounded at 12 seconds, allowing the initial
  private credential/HTTP read before the existing runtime callback wait.
- Make exit idempotent, clear screen polling and idle timers, close the screen's
  optional diagnostic client, cancel its outstanding HTTP/probe/retry/WebSocket
  work, and suppress late callbacks and further checks after exit begins.
- Restore screen polling if the platform synchronously refuses exit.

These are screen lifecycle fixes. They do not patch firmware, stop the background
service, bypass authentication, change permissions, or change remote mappings.
They address concrete code behavior but are not yet proof of what blocked native
screen termination on the TV.

## Testing and exact next steps

Eleven targeted suites passed locally: probe UI, screen lifecycle, screen auth
recovery, screen live status, screen live HTTP, private widget bootstrap, widget
transport, connection diagnostics, comprehensive diagnostics, listener ownership
and Node 4 compatibility. Lifecycle coverage includes authenticated reuse, both
startup paths, HTTP refusals, repeated exit events, cancelled reads, delayed
filesystem/HTTP callbacks, queued retries, blocked inventory and exit refusal.

1. Publish only the screen, related tests and this note to the runtime branch.
2. Require all four CI jobs on the exact new commit before preparing an updater.
3. Pin the updater to the new revision with installed baseline `6104eeaa`.
   Preserve the existing certificate, install ledger, saved input and owner pairing.
4. Validate several ordinary Back/immediate-reopen cycles on the TV, with rapid
   authenticated diagnostics and saved filter/Home still connected. A fresh cold
   boot may be needed to remove older runtime contexts after package replacement.
5. If reopening still blocks, collect targeted exit/process wait evidence without
   forcing a relaunch, and do not claim that the native delay has been fixed.

Glass Home's saved access and app launch should also be checked after the Vetro
update; its earlier permission flow was confirmed, but this post-update check
has not yet been performed. No TV installation has been performed by this change.
