# Samsung Home tile does nothing on S95C when CoBA reports a successful launch

On my Samsung S95C running Tizen 9, the default Samsung Home tile closed Vetro's overlay but left the current app visible. The fix below is now confirmed working on this TV.

Reproduction before the fix:

1. Enable the Vetro launcher and leave its Home tile set to Samsung Home.
2. Open an app, press Home, then select Samsung Home in the overlay.
3. The overlay closes, but Samsung Home does not appear. Waiting four seconds before selecting the tile gives the same result.

Samsung Home and its related components were enabled. Remapper interception and double press were off. The recorded close sequence completed more than five seconds before launch, with no later close in the captured interval.

| Direct launch | Exit code | Visible result |
| --- | --- | --- |
| `app_launcher -s com.samsung.tv.coba.newhome` | 0 | Previous app remains visible |
| `app_launcher -s com.samsung.tv.csfs` | 0 | Samsung Home opens |

Official v0.5.0 [selects CoBA when its package exists](https://github.com/andrearicci93/vetro/blob/v0.5.0/app/service/dock-catalog.js#L73), with csfs as fallback. [SystemLaunch runs the fallback only on error](https://github.com/andrearicci93/vetro/blob/v0.5.0/dock/src/Core/SystemLaunch.cs). CoBA reports success here, so the fallback is skipped.

Expected: the default Samsung Home tile opens Samsung Home without a special setting.

**Fix confirmed on S95C:** enhanced build `a57bf4cf` keeps CoBA first, then explicitly opens First Screen for this Home pair. After installation, selecting Samsung Home from Vetro's launcher works. Installed files, the running revision and the native launcher refresh were independently verified.

Proposed fix: [PR #169 — Fix Samsung Home tile when CoBA launch succeeds without opening Home](https://github.com/andrearicci93/vetro/pull/169). The PR contains only the launch-helper fix and regression tests; the standalone branch passes CI.

Testing scope: before/after hardware testing used enhanced builds `eb222734` and `a57bf4cf`. The affected selection and fallback code was verified against official v0.5.0 (`81e16b16`), where it is unchanged. I have not repeated the test on a fresh stock installation or other TV generations.

Related contribution plan: #138.

