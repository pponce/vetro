# Authentication preservation checkpoint

The original permission integration adapted zerodevb/vetro PR #9 and separated owner access from scoped app access. It moved security state into private storage, used hashed owner credentials and atomic writes, and failed closed on invalid security data. This predates the successful screen-transport change.

The TV generated owner-pairing codes while its screen could not authenticate to retrieve them. Native MessagePort replies first failed with a LocalMessagePortRouter type mismatch; removing that error still did not yield accepted screen sessions. Short-lived screen credentials in package-private `wgt-private` storage removed that dependency. The recorded TV result confirmed receipt of a screen credential, authenticated service access and successful browser pairing.

Subsequent 401 recovery and HTTP-listener ownership changes address stale credentials and competing private-credential publishers. Keep these behaviors with the screen-authentication prerequisite. The evidence does not establish that changing the owner-session storage format made the code appear.

Upstream release-0.5.0 at `87ddaa6273be4976a43885aeb763177dd453347d` stores owner sessions in `{sessions:[...]}` at `VETRO_AUTH_PATH`, uses a `vetro_pair` cookie to resume pending pairing after reload, and supports paired hostname access. The combined implementation uses a schema-versioned private store and a different owner-pairing implementation. Do not substitute the combined auth.js wholesale.

The extraction must preserve private screen credentials, bounded refresh after explicit 401, route restrictions, revocation and listener ownership. Existing upstream browser and script sessions must continue through a tested compatibility path or explicit migration. Preserve the pairing cookie, pending-request ownership, pairing-page reload behavior, sign-out controls and hostname support. Closing the local-app owner bypass is a required security change before scoped app permissions can be enabled.

References: `notes/app-permissions-handoff.md`, `notes/messageport-runtime-handoff.md`, `notes/screen-auth-recovery-handoff.md`, `notes/service-listener-ownership-handoff.md`, and the recorded TV pairing result. No TV installation or change to working owner sessions is part of branch preparation.
