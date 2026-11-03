# App permissions

Vetro can give an installed TV app selected controls through a versioned Tizen MessagePort API. App access starts **off**. Each app must request permissions, and the owner chooses which to approve in **App permissions** in the paired dashboard.

## Setup and use

This build requires a Samsung **Partner** certificate because it declares `http://tizen.org/privilege/appmanager.certificate`. It also needs the Application, Package, MessagePort and private Filesystem APIs in the web service. Public-only signing is not sufficient for this manifest. App access stays unavailable when identity checks or package-change notifications cannot be established; there is no HTTP or shared-file fallback.

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

The public port is `VETRO_APP_ACCESS_V1` on application `vetrotvapp.svc`. Send one MessagePort item `{key:'json', value:JSON.stringify(message)}` and supply a local reply port. The SDK checks the service app ID and reply-port metadata on responses. Never infer caller identity from request JSON.

```json
{"version":1,"id":"request_1","method":"apps.list","params":{"offset":0,"limit":20}}
```

Success replies contain `version`, `id`, `ok:true`, and `result`. Errors contain `ok:false` and `error:{code,message,submitted}`. Unknown methods or extra operation parameters are rejected. Requests are capped at 4 KiB, replies at 16 KiB, pages at 20 apps, and admission at 20 requests per app per ten seconds, with one in flight per app and four total. There are at most 20 pending requests and 40 approvals.

`apps.list` and `tasks.list` return `{apps,total,nextOffset}`. Task rows add `running` and `memoryBytes`; RSS is an estimate that may include shared memory. Stop returns `verified:false` if the app remains running or restarts. Launch and remote-key methods return `submitted:true`, not a verified screen transition.

`brightness.set` requires `{value:25,expected:20}` using the current value from `brightness.read`. Audio keys are `XF86AudioRaiseVolume`, `XF86AudioLowerVolume`, `XF86AudioMute`. Playback keys are `XF86AudioPlay`, `XF86AudioPause`, `XF86AudioStop`, `XF86AudioNext`, `XF86AudioPrev`, `XF86AudioRewind`, `XF86AudioForward`. `power.off` takes `{}`.

Handle `disabled`, `unavailable`, `permission_denied`, `identity_changed`, `not_allowed`, `invalid_request`, `busy`, `limit`, and `not_confirmed` without silently broadening access. `error.submitted:false` confirms no TV command was dispatched. `true` or an absent/null value must not trigger another launch through a fallback. A timeout or lost reply is an unknown outcome: read current state before asking the user to retry a mutation. The SDK never retries automatically. Call `vetro.close()` when the client no longer needs the connection.

## Trust boundary

Tizen supplies the sender app ID through the callback's `RemoteMessagePort`; Vetro resolves that ID to its installed package and author signing certificate. Grants bind the app ID, package ID, signer fingerprint, version and installation timestamp. A matching name, a supplied app ID, a loopback connection, or an `Origin: null` header is insufficient.

The separate `VETRO_WIDGET_V1` trusted port verifies the same signer and the exact Vetro widget ID. It supplies only an ephemeral credential for status reads, probe submission and the on-TV pairing code. It cannot call administrative or scoped app controls.

This boundary assumes the Tizen package manager and MessagePort metadata are trustworthy. It does not sandbox apps that already have root, replace Samsung's OS isolation, secure unrelated root services, or encrypt the owner's HTTP connection. Keep the administrative interface on a trusted network. Firmware-specific identity behavior and TV-side operations still need hardware acceptance testing before release.

References: [Samsung MessagePort API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/messageport-api.html), [Application API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html), [Package API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/package-api.html).
