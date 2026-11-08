# Fix Samsung Home tile when CoBA launch succeeds without opening Home

On my S95C running Tizen 9, the default Samsung Home tile dismissed Vetro's overlay but left the previous app visible. CoBA's app_launcher request returned success without showing Home, so the error-only csfs fallback never ran.

For the exact CoBA-to-csfs Home pair, this change keeps CoBA first and then explicitly opens First Screen even when CoBA returns success. Other system-app pairs retain error-only fallback, and csfs-only TVs still receive one launch request. No special setting is needed.

This is an isolated two-file fix against post-0.5.0 main at `180d9845`: `SystemLaunch.cs` and its regression tests. The relevant launch path is also present in official v0.5.0 (`81e16b16`).

**Confirmed fixed on my S95C:** I installed enhanced build `a57bf4cf`, containing this same fix, and confirmed that selecting Samsung Home from Vetro's launcher now opens Samsung Home. The installation report verified the package files, running revision and refreshed native launcher. Before the fix, direct CoBA launch returned 0 without opening Home; the subsequent csfs launch returned 0 and opened it.

Validation:
- [Standalone PR CI passed](https://github.com/pponce/vetro/actions/runs/42523197467). Shell-backed tests cover CoBA success and failure, ordinary fallback, csfs-only launch and unrelated fallback targets.
- [Enhanced-build CI passed](https://github.com/pponce/vetro/actions/runs/42523234818), including TV launcher compilation and real Ecore child-completion tests.

Hardware validation used the enhanced integration build; I have not separately installed the standalone stock-based branch. Other TV generations remain untested. Please rebuild the native launcher from source when testing or merging.
