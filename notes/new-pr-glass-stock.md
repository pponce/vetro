# Support stock Vetro 0.5.0 app discovery and artwork

Glass Home's local service reads the stock installed-app registry and Home ordering, so eligible unpinned apps can be selected without the custom permissions API. Selected apps use Home-row artwork when available, then package artwork. Existing guarded launches and native fallback remain in place.

Saved selection, hidden state, tile ordering and custom-artwork priority are preserved. Failed inventory reads retain the previous complete selection. Requests use fixed same-TV endpoints with bounded responses; no owner credential or arbitrary destination is accepted.

Regression coverage includes unpinned selection, restricted/self filtering, missing artwork, saved preferences, launch confirmation and uncertain outcomes. Exact Samsung store catalog/artwork parity, especially YouTube/Prime and unpinned apps, still needs TV acceptance.

[CI](https://github.com/pponce/glass-home-samsung-tv/actions/runs/42509712172) passes service/API tests and browser checks, and produces an unsigned widget on `compat/stock-vetro-0.5.0`. This PR targets this fork's `main`; no Vetro core change is required.
