# Samsung Home tile does nothing on S95C when CoBA reports a successful launch

On my Samsung S95C running Tizen 9, the default Samsung Home tile dismisses Vetro's overlay but leaves the current app visible.

Steps:
1. Enable the Vetro launcher and keep the Home tile at its default Samsung Home destination.
2. Open an app, press Home, then select Samsung Home in the overlay.
3. The overlay closes, but Samsung Home does not appear. Waiting four seconds before selecting the tile gives the same result.

Samsung Home and its related components are enabled. Remapper interception and double press were off during these tests. The logs show the close sequence finished more than five seconds before the launch request, with no subsequent close in the captured interval.

Direct comparison:

| Command | Exit code | Visible result |
| --- | --- | --- |
| `app_launcher -s com.samsung.tv.coba.newhome` | 0, successfully launched | Previous app remains visible |
| `app_launcher -s com.samsung.tv.csfs` | 0, successfully launched | Samsung Home opens |

Official v0.5.0 [selects CoBA when its package exists](https://github.com/andrearicci93/vetro/blob/v0.5.0/app/service/dock-catalog.js#L73), with csfs as fallback. [SystemLaunch only runs that fallback on an error](https://github.com/andrearicci93/vetro/blob/v0.5.0/dock/src/Core/SystemLaunch.cs), so a successful CoBA command that does not show Home leaves the tile ineffective.

Expected: the default Samsung Home tile should open Samsung Home without a per-TV override.

Proposed fix: [PR for fix/samsung-home-csfs-handoff](https://github.com/andrearicci93/vetro/pulls?q=is%3Apr%20author%3Apponce%20head%3Afix%2Fsamsung-home-csfs-handoff) ([source comparison](https://github.com/andrearicci93/vetro/compare/main...pponce:vetro:fix/samsung-home-csfs-handoff)). It preserves CoBA first and then explicitly opens First Screen for this Home pair. The branch passes CI.

Testing scope: hardware reproduction used my 0.5.0-based enhanced build `eb222734`, not a fresh stock installation. I verified the relevant selection and fallback code against official v0.5.0 (`81e16b16`), where it is unchanged. The rebuilt fix and other TV generations still need hardware validation.

Related contribution plan: #138.

