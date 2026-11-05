# Service listener ownership checkpoint

## Objective and repositories

Make TV-screen authentication and pairing dependable while preserving app
permissions, remote input and owner pairing. Investigate normal exit/reopening
separately until evidence connects it to the credential conflict.

- Runtime: `pponce/vetro`, `combined/runtime-wrapper-observation-20261103`.
- Installed baseline and parent of this change:
  `542fd3da54fafc2bb01a6b3eb5665869beda9f0f`.
- Host tools: `pponce/vetro`, `combined/runtime-wrapper-inspection-20261103`,
  last prepared passive watcher `610841c6b80a04bbea18a707c63e4bd9ee6c99e6`.
- Glass Home: `pponce/glass-home-samsung-tv`, main and tested permission branch
  at `30c490194f1748d523262a1ac8985fe45f735729`. No Glass Home change is required.

## New device evidence

`screen-lifecycle-20261105-031901-479063.json` completed 33 passive samples,
without capture errors or recorded terminal markers. The user supplied event
timing: close early, finally reopen between 82 and 87 seconds after about 15
attempts, diagnostics fail once then work, close again near 142 seconds and
remain unable to reopen before capture ends.

The HTTP service reports PID 16051 and the same start time throughout. Its
lifecycle counters stay at one start, one request and zero stops. These facts
do not exclude multiple worker contexts within a process.

| First observed | Credential file modification epoch | HTTP status and pairing | Serving instance publications |
| --- | --- | --- | --- |
| 0 seconds | 1793848705 | 401 / 401 | 53 |
| 11 seconds | 1793848749 | 200 / 200 | 54 |
| 87 seconds | 1793848825 | 401 / 401 | 54 |
| 132 seconds | 1793848869 | 200 / 200 | 55 |

Each publishing sequence repeats at 120 seconds. The rejected file replaces
an accepted file without a publication by the serving instance. Both files
carry future expirations. The probe reads the private file afresh and sends
the credential only to TV loopback. This rules out an explanation confined to
the screen's stale cache, credential expiry, or a restart of the observed HTTP
service. A competing publishing context is strongly supported; its exact
process/worker identity is not established.

Screen candidate PID 31659 persists through 82 seconds, with state D in the
65–82 second samples. PID 10007 replaces it at 87 seconds and remains through
the end, including after the reported close near 142 seconds. Process matching
is best effort. The capture lacks a wait channel, kernel stack and precise
exit markers, so it does not establish what delayed screen termination.

## Change and reproduction

The baseline starts credential publishing from native lifecycle callbacks
without waiting for HTTP bind success. It also starts the platform and MQTT
before that success. Previously captured Samsung runtime source contains an
uncaught-exception handler that logs without terminating. That source is
supporting evidence, not proof of which worker wrote each observed file.

The regression test failed against the baseline because the credential was
published before the real HTTP listener became ready. The corrected service:

- Gates native ports, private credentials, input and background operations on
  successful HTTP ownership and an active lifecycle.
- Handles bind errors without starting a competing publisher, root adapter or
  MQTT connection.
- Allows a later lifecycle request to retry binding; registers its listening
  handler once so failed retries cannot accumulate startup callbacks.
- Prevents a late bind callback from reactivating a stopped lifecycle.

The test uses real HTTP servers sharing a private credential directory. It
checks a real EADDRINUSE conflict, repeated credential rotations with successful
status/pairing requests, independent shutdown, takeover after the owner closes,
and stop-before-listening timing. Existing credential scopes, signer checks,
grants, stored owner sessions and remote mappings are unchanged.

## Validation and next steps

Twelve targeted suites passed locally: listener ownership, service lifecycle,
private widget bootstrap, app-access HTTP, input persistence, physical-input
lifecycle, screen authentication recovery, live screen HTTP, Home routing HTTP,
return HTTP, authentication and Node 4 compatibility. The full local runner
cannot run from this partial source checkout because dock resources are absent;
the complete repository must pass all four CI jobs before package installation.

1. Record the exact new commit and full CI run in the host-tools handoff.
2. Prepare a checksum-pinned updater from installed baseline `542fd3da` using
   the existing certificate and input-preserving update procedure.
3. Verify installed service/screen revision and authentication. Observe normal
   Back exit and reopening across multiple credential renewal periods.
4. If reopening still blocks, collect targeted screen-process wait/exit evidence;
   do not treat forced inspector relaunch success as proof of normal exit.

This checkpoint does not claim the new revision is installed, TV-verified, or
that the normal reopening delay has been fixed. No firmware wrapper was patched,
no TV process was killed by this analysis, and no credential was exported.
