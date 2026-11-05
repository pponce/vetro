# TV screen checks

Opening Vetro checks its background service, public API availability and TV identity. The screen displays root, remote-input and launcher status, plus the dashboard address. A pending browser-pairing code appears while checks run.

Press **OK** for full diagnostics, including installed apps, packages, supported remote keys and the TV remote API. Each step has a time limit. Partial reports retain the model and completed checks if a later step is slow. App/package inventory from a previous full check remains available until a new full check replaces it.

While visible, the screen refreshes status every five seconds without repeating inventory. It reports an unavailable status read instead of retaining a stale success. A background service that already answers is reused.

Press **Back** to close the screen. Closing cancels screen requests and timers; the background service continues running. Browser pairing and owner sessions follow the [sign-in guide](SIGN-IN.md).
