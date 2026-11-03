# Pairing the dashboard

On the TV, Vetro's dashboard and HTTP APIs require an owner credential, including requests from localhost. Open `http://TV_IP:8099/` in a browser on the same trusted network (use the configured port), choose **Show a code on the TV**, and enter the six digits displayed by the Vetro widget. If the widget does not open automatically, open Vetro manually on the TV.

A pairing code expires after two minutes and allows five failed attempts. Only one pairing can be pending. The browser receives a random owner credential in an HttpOnly, SameSite=Strict cookie. Vetro stores only its hash in private package storage. A paired browser has full administrative access; only pair devices you trust. Sign out or **Sign out all devices** from the dashboard to revoke those credentials. App approvals are managed separately in **App permissions**.

There can be at most 20 paired devices. Credentials expire after one year. Sign-out is saved before success is reported. Missing identity support never creates a localhost bypass. If private security storage is unreadable or cannot save, Vetro blocks access rather than granting it or forgetting revocation.

Use the TV's IP address or localhost as the host. Remote websites and packaged apps with an opaque origin cannot use owner endpoints. Native scripts may omit Origin but still need their own paired bearer token. The transport remains HTTP: pairing does not protect credentials from someone who can intercept the network. Do not expose the management port to the internet or an untrusted LAN.

## Scripts

A script can pair by POSTing JSON to `/auth/pair` with a short `name`, then POSTing `{id,code}` to `/auth/confirm` using the request ID and the code read from the TV. A successful confirmation returns `token`. Send it as `Authorization: Bearer TOKEN` on subsequent requests. Do not place tokens in URL parameters, committed files, screenshots or reports.

The bundled benchmark and boot-test Python scripts read `VETRO_TOKEN` from the environment. Their reports do not include this value. Sign out all devices to revoke a lost script credential. Third-party TV apps should use the [scoped MessagePort API](APP-PERMISSIONS.md), which does not require an owner credential.

`GET /auth/devices` lists paired-device labels and expiration times. `POST /auth/signout` revokes the current credential; `POST /auth/signout-all` revokes every browser/script credential. `/auth/pending` is restricted to Vetro's verified widget and is unavailable even to paired owner clients.

Running `node service/main.js` without Tizen and with the app-only adapter remains an unauthenticated local development mode with device operations unavailable. This exception does not apply to an app-only package running on a TV.

The pairing screen and flow adapt [zerodevb's dashboard-auth PR #9](https://github.com/andrearicci93/vetro/pull/9), commit `0983b97f980acbed7e43ac64181f07089f2313c8`, under this project's MIT license. The local trust exception from that proposal is replaced here by the verified-widget and scoped-app paths.
