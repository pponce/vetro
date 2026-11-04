# Security and responsible reports

Vetro is experimental privileged software. On a TV, its browser management
interface requires pairing with a code displayed by the Vetro screen. Paired
browsers and scripts have owner access. The HTTP transport does not encrypt
credentials or commands: use a trusted isolated LAN and do not expose the
management port to the internet or untrusted networks.

The TV screen uses a separate short-lived credential from the package's private
storage. It can read pairing and screen status and submit screen diagnostics;
it cannot perform owner actions. Other TV apps use the scoped MessagePort API,
with platform sender identity and owner-approved permissions. Merely reaching
localhost does not grant access.

Owner credential hashes and app permissions are stored in private package data.
Unreadable or unwritable security state blocks access. Root-agent authentication
is a separate internal protocol.

Use GitHub private vulnerability reporting if the repository maintainer enables
it. If no private channel is configured, ask for one in an issue without including
credentials, exploits, device identifiers, raw logs or sensitive reproduction data.
No public security contact or private-report endpoint has been configured locally.

Only use the tool on devices you own or are authorized to administer. Do not share
signing keys or developer-account credentials. Diagnostic JSON excludes many
private fields but can still reveal installed software; review it before posting.

