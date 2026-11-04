# App permissions

Vetro can give an installed TV app selected controls through a versioned Tizen MessagePort API. App access starts **off**. Each app must request permissions, and the owner chooses which to approve in **App permissions** in the paired dashboard.

## Setup and use

This build requires a Samsung **Partner** certificate because it declares `http://tizen.org/privilege/appmanager.certificate`. It also needs the Application, Package, MessagePort and private Filesystem APIs in the web service. Public-only signing is not sufficient for this manifest. App access stays unavailable when identity checks or package-change notifications cannot be established. Every app operation must arrive through MessagePort; HTTP can only retrieve an authenticated reply.

1. Open Vetro on the TV and [pair the dashboard](SIGN-IN.md).
2. Open **App permissions** and turn on **App access**.
3. In the connecting app, request the controls it needs.
4. Select **Refresh requests** in Vetro. Review the app ID, package, version and signer fingerprint, select permissions, and choose **Approve selected**. All permission checkboxes start unchecked.
5. An approval can be paused, reduced, or revoked. Additional permissions require another request from the app. Turning off app access blocks all app calls while keeping saved approvals.

Requests expire after ten minutes. Pending requests and the last 100 activity records are held in memory. Approvals are saved atomically in Vetro's private package directory. An unreadable or unwritable security store blocks access; it never resets to permissive defaults. Do not put these files in shared storage or diagnostic exports.

Updates, reinstalls and signer changes require new approval. Vetro checks installation metadata on every call and revokes approval when Tizen reports a package installation, update or removal. Pausing or changing an approval also invalidates calls that are waiting to execute. A command already dispatched to the TV may still finish; revocation cannot undo it.

## Available controls

| Permission | Methods | Limits |
| --- | --- | --- |
| `apps.read` | `apps.list` | Visible TV-app names, IDs and disabled state; paginated. |
| `apps.launch` | `apps.launch` | Launch one eligible, enabled, visible TV app, including preinstalled media apps. |
| `tasks.read` | `tasks.list` | Running eligible user apps and aggregate RSS; no raw process list, PIDs or command lines. |
| `tasks.stop` | `tasks.stop` | Stop one eligible user UI app and check whether it is still running. Unsaved progress can be lost. |
| `picture.brightness` | `brightness.read`, `brightness.set` | Panel brightness only, with confirmed TV method signatures, bounded integers, expected-current-value checks, readback and attempted rollback on a failed write. |
| `remote.audio` | `audio.key` | Volume up, volume down, mute. |
| `remote.playback` | `playback.key` | Play, pause, stop, previous, next, rewind, fast forward. |
| `power.off` | `power.off` | Send standby; command submission is not proof that the TV powered down. |

Apps requesting access and task-management targets must have positive native registry evidence: visible UI apps, removable, non-system, non-preloaded, and unprotected. Vetro and packages with protected or system siblings are excluded. Missing or ambiguous flags deny access.

Listing and launching use a separate policy: visible, registered UI apps with known flags and no protected package components. This permits opening preinstalled media apps such as Netflix without granting task access to them. Services and hidden apps are excluded. Launch targets are checked against their installed package, version, installation timestamp and package-change generation before dispatch; callers and stop targets additionally require a verified author signer.

Apps cannot uninstall or disable packages, change startup flags, send navigation/Home/service-menu keys, execute shell commands, edit files, fetch arbitrary URLs, install packages, configure MQTT, or manage permissions. The owner's authenticated dashboard remains a separate administrative interface.

## Client integration

Garage Home and other clients must adopt this API. Copy [`app-access-client.js`](../service/app-access-client.js) into the client package and load it before the integration code. Start Vetro first. Do not distribute an owner's dashboard token to an app.

```html
<script src="app-access-client.js"></script>
<script>
var vetro = new VetroAppAccess();
// Run this from a user-selected Connect action, not an automatic retry loop.
vetro.call('access.request', {scopes:['apps.read','tasks.read','tasks.stop']})
  .then(function (request) {
    // state is "pending" or "approved". Tell the user to review pending access in Vetro.
    console.log(request.state);
  });
// After the owner approves, check the granted subset. Do not assume every requested scope was granted.
function refreshPermissionStatus() {
  return vetro.call('access.status', {}).then(function (status) {
    return status.scopes;
  });
}
function runningApps() { return vetro.call('tasks.list', {offset:0,limit:20}); }
function closeApp(appId) { return vetro.call('tasks.stop', {appId:appId}); }
</script>
```

The public port is `VETRO_APP_ACCESS_V1` on application `vetrotvapp.svc`. Send one MessagePort item `{key:'json', value:JSON.stringify(message)}` and supply a local reply port. In version 1, the SDK checks the service app ID and reply-port metadata on responses. Never infer caller identity from request JSON.

```json
{"version":1,"id":"request_1","method":"apps.list","params":{"offset":0,"limit":20}}
```

### Authenticated HTTP replies

Clients can select version 2 with `new VetroAppAccess({httpReplies:true, crypto:window.crypto, pollReply:readReply})`. Copy `service/vendor/sha256.js` and its MIT license into the client, and load the script before the SDK. Native `crypto.getRandomValues` is required. The bundled js-sha256 v0.11.1 implementation supplies HMAC-SHA256; randomness never falls back to `Math.random`.

The SDK creates an independent 32-byte reply ID and 32-byte key for each request. Both travel only in the native request's `reply:{id,key}` field alongside `version:2`. Vetro authorizes the request using Tizen sender metadata, installed identity and current permissions.

`readReply(id)` retrieves `GET /app-replies/<id>` from Vetro on the same TV and returns `{status,body}`. Status 202 or 404 keeps polling within the request's 15-second deadline. Status 200 carries `{body:<exact serialized reply>,mac:<hex HMAC>}`. The SDK verifies HMAC-SHA256 over `VETRO_APP_REPLY_V2\n` + reply ID + `\n` + exact body before parsing the result. Native version 1 messages cannot resolve version 2 requests. Operations are sent once; polling never resubmits them.

The HTTP endpoint accepts only the TV's own addresses, checks its Host header, and exposes no operation or reservation API. A client service may proxy the reply ID to Vetro's fixed port 8099, binding the source to the same TV address. Keep the key inside the widget and native request; do not put it in URLs, logs, persistent storage or proxy requests. Glass Home uses its own authenticated local service for this read.

Reply records expire after 30 seconds, are limited to two per app and 32 total, and are invalidated by relevant permission or installation changes. Short-lived replay records prevent an evicted reply ID from executing a request again. A missing, malformed or unauthenticated reply has an unknown dispatch outcome and must not trigger a fallback launch.

Success replies contain `version`, `id`, `ok:true`, and `result`. Errors contain `ok:false` and `error:{code,message,submitted}`. Unknown methods or extra operation parameters are rejected. Requests are capped at 4 KiB, replies at 16 KiB, pages at 20 apps, and admission at 20 requests per app per ten seconds, with one in flight per app and four total. There are at most 20 pending requests and 40 approvals.

`apps.list` and `tasks.list` return `{apps,total,nextOffset}`. Task rows add `running` and `memoryBytes`; RSS is an estimate that may include shared memory. Stop returns `verified:false` if the app remains running or restarts. Launch and remote-key methods return `submitted:true`, not a verified screen transition.

`brightness.set` requires `{value:25,expected:20}` using the current value from `brightness.read`. Audio keys are `XF86AudioRaiseVolume`, `XF86AudioLowerVolume`, `XF86AudioMute`. Playback keys are `XF86AudioPlay`, `XF86AudioPause`, `XF86AudioStop`, `XF86AudioNext`, `XF86AudioPrev`, `XF86AudioRewind`, `XF86AudioForward`. `power.off` takes `{}`.

Handle `disabled`, `unavailable`, `permission_denied`, `identity_changed`, `not_allowed`, `invalid_request`, `busy`, `limit`, and `not_confirmed` without silently broadening access. `error.submitted:false` confirms no TV command was dispatched. `true` or an absent/null value must not trigger another launch through a fallback. A timeout or lost reply is an unknown outcome: read current state before asking the user to retry a mutation. The SDK never retries automatically. Call `vetro.close()` when the client no longer needs the connection.

## Trust boundary

Tizen supplies the sender app ID through the callback's `RemoteMessagePort`; Vetro resolves that ID to its installed package and author signing certificate. Grants bind the app ID, package ID, signer fingerprint, version and installation timestamp. A matching name, a supplied app ID, a loopback connection, or an `Origin: null` header is insufficient.

The Vetro screen reads a five-minute credential from the package-private `wgt-private` directory using Tizen's Filesystem API. The service publishes it atomically with owner-only file permissions and renews it while running. The credential permits only local screen/status reads, pairing-code reads and diagnostic submissions. It cannot authorize owner operations or third-party app controls, and restarting the service invalidates it.

The trusted `VETRO_WIDGET_V1` receiver supports widget clients and diagnostic reports. Tizen enforces the matching author certificate at that receiver, and Vetro requires the exact sender ID `vetrotvapp.app` from callback metadata. MessagePort clients require `vetrotvapp.svc` and the expected reply-port metadata before accepting a response. A regular reply port uses `VETRO_WIDGET_REPLY_V1` as the expected source; a trusted reply port uses `VETRO_WIDGET_V1`. No-source replies and identities claimed in message data do not authenticate a client.

This channel supplies only an ephemeral credential for status reads, probe submission and the on-TV pairing code. It cannot call administrative or scoped app controls.

This boundary assumes the Tizen package manager, private-storage isolation and MessagePort metadata are trustworthy. It does not sandbox apps that already have root, replace Samsung's OS isolation, secure unrelated root services, or encrypt the owner's HTTP connection. Keep the administrative interface on a trusted network. Firmware-specific identity behavior and TV-side operations still need hardware acceptance testing before release.

References: [Samsung MessagePort API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/messageport-api.html), [Application API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html), [Package API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/package-api.html).

