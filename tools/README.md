# Home suite updater

`update-home-suite.py` updates existing Glass Home, Garage Home and Vetro installations from the exact CI artifacts declared in its `APPS` table. It uses the Vetro 0.5.0 Home enhancements build and the two clients that use stock Vetro APIs.

Requirements:

- Linux with Python 3.10+, OpenSSL, and an existing `samsung-tv-tools` project.
- The reviewed Apps2Samsung CLI, located by `vetro-install/bin/apps2samsung-beta.path`.
- An existing usable Partner certificate that covers the TV and has the same author identity as all three installed apps.
- Vetro running with root connected. Owner pairing may prompt for the code displayed on the TV.
- An active SDB connection on port 26201: Vetro's **Quick settings → Allow SDB from the local network**, or TV-Store's relay when Vetro's tunnel is unavailable. Developer Mode Host PC IP stays `127.0.0.1`. Close other installer and debugger sessions.

Vetro can own port 26201 and share its existing SDB connection. In that configuration, use Vetro's SDB access setting; TV-Store's relay cannot also bind the same port. The updater checks the active Vetro connection first and falls back to TV-Store. It records the connection states in the report and leaves network access settings under user control. SDB LAN access permits development clients on the network without Vetro HTTP pairing; it can be switched off after installation.

Run with `vetro_owner.py` beside the updater:

```bash
python3 tools/update-home-suite.py --project-root /path/to/samsung-tv-tools --tv TV_IP --local-ip COMPUTER_IP --report-host user@COMPUTER_IP
```

Add `--check-only` to download and prepare the packages without installing them. GitHub Actions artifacts have limited retention; an expired or unavailable artifact stops preparation. The downloader uses nightly.link for public artifact access and checks the archive against a pinned SHA-256 digest from GitHub. Cached archives receive the same checksum check.

All three packages are prepared before the first installation. Installed client configuration files and local service keys are included in their replacement packages. The installer keeps each package ID and does not authorize uninstall or remove-and-reinstall recovery. Existing app data remains in place.

Glass Home and Garage Home are installed first and their services reopened and checked. Garage Home's controls service normally starts on demand, so the updater explicitly starts that service before its authenticated health check. The report records the health request's HTTP status and curl result without recording its key. Vetro is installed last. Its own SDB connection can close during that update; if the screen closes, reopen Vetro once with the remote and let its checks finish while the updater verifies the installed files. If the old 0.5.0 service still answers, the updater attempts one targeted app/service restart. An active native Home launcher is refreshed while retaining its selected mode. The updater does not reboot the TV or enable an inactive Home launcher.

The updater keeps a private installation ledger and prepared packages under `vetro-install/home-suite-20261108-r1`. Do not share prepared packages: they contain the installed client configuration and local keys. The JSON report omits these values and prints an `rsync` command for copying the report.

An installation attempt is recorded before it is submitted. Rerunning verifies that attempt against the installed payload and author identity; it never automatically submits that installation again. If verification fails, keep the report and investigate before starting another updater.

Run the isolated updater tests with `python3 -m unittest discover -s tools/tests -v`. These tests cover preparation order, configuration retention, archive checks, package identity, resumability, and failure handling. They do not replace hardware testing.

## Enhanced Vetro Samsung Home update

`update-vetro-home-fix.py` installs only enhanced Vetro revision `a57bf4cf4967620f158e750b7e37f0399efc4176`. It uses the same signing, download verification, installation and runtime checks as the suite updater. Keep `update-home-suite.py` and `vetro_owner.py` beside it. Glass Home and Garage Home are not prepared, installed or restarted by this entry point.

```bash
python3 tools/update-vetro-home-fix.py --project-root /path/to/samsung-tv-tools --tv TV_IP --local-ip COMPUTER_IP --report-host user@COMPUTER_IP
```

The update retains the enhanced Home features and applies the default Samsung Home launch correction: when the tile uses CoBA with First Screen as its fallback, it starts CoBA and then explicitly opens First Screen. No additional setting is required. It retains the TV's saved launcher settings and reloads an active launcher after verifying the updated service. The installer uses a separate ledger in `vetro-install/vetro-home-fix-20261108-r1` and reuses the existing owner pairing. Reruns verify the recorded installation instead of installing it again. Test the Samsung Home tile after completion; automated checks cannot confirm what appears on the TV.

## Samsung Home tile diagnostics

`diagnose-home-tile.py` collects the native launcher's log, Home tile target, launcher configuration, relevant process state, installed launcher checksum, and Samsung Home registry flags. Run it with `vetro_owner.py` beside it:

```bash
python3 tools/diagnose-home-tile.py --project-root /path/to/samsung-tv-tools --tv TV_IP --report-host user@COMPUTER_IP
```

Keep Vetro connected to root and its launcher enabled. The tool prompts for two manual attempts: a normal Samsung Home tile selection, followed by a selection after waiting four seconds. It does not launch apps, change TV settings, restart processes, or install packages. Owner pairing may prompt if no valid maintenance credential is available. The report contains the selected Home configuration and launcher log, omits credentials and unrelated app inventory, and is saved with private file permissions. An interrupted run retains the snapshots collected so far.

Add `--launch-check` for an active comparison of Samsung's two Home entry points. This mode verifies that both are installed and enabled, then sends one standard `app_launcher -s` request to `com.samsung.tv.coba.newhome` and one to `com.samsung.tv.csfs`. It records the actual command exit code and output alongside the owner's observation of the TV. It does not change settings or installed files. Close the overlay and follow the prompts; avoid pressing Home during each attempt because doing so starts another close sequence. A timeout or lost response stops the comparison without retrying the launch. Reports use the `home-launch-` filename prefix.
