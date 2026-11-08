# Fix Samsung Home tile when CoBA launch succeeds without opening Home

On my S95C running Tizen 9, selecting the default Samsung Home tile closes Vetro's overlay but leaves the previous app visible. `app_launcher -s com.samsung.tv.coba.newhome` returns success without showing Home; an explicit `app_launcher -s com.samsung.tv.csfs` then opens it. The existing error-only fallback skips that second request.

This change keeps CoBA first, then explicitly launches First Screen for the exact CoBA-to-csfs Home pair. Other system-app pairs retain their error-only fallback, and csfs-only TVs still receive one launch request. No additional setting is required.

The branch is based on upstream main `180d9845`, immediately after v0.5.0, and changes only `SystemLaunch.cs` and its regression tests. It does not include my Home enhancement PRs or change Home interception, close guards, pairing, or app permissions.

Validation:
- [Stock branch CI passed](https://github.com/pponce/vetro/actions/runs/42523197467): application tests, integration fixtures, native launcher checks, diagnostic parser tests, and release checks.
- Shell-backed regression tests cover successful CoBA with no foreground action, failed CoBA, ordinary success/failure fallback, csfs-only launch, and an unrelated CoBA fallback.
- [The same fix compiles for the TV and passes enhanced-build CI](https://github.com/pponce/vetro/actions/runs/42523234818), including Ecore child-completion tests.

Hardware evidence: the failure and the CoBA-then-csfs command sequence were tested on my S95C using enhanced revision `eb222734`. The relevant selection and fallback code is unchanged in official v0.5.0 (`81e16b16`). This is not a claim of a fresh stock-install reproduction. The rebuilt fixed package still needs its on-TV acceptance test; other Home generations also need comparison.

The native launcher must be rebuilt from source to include this change.

