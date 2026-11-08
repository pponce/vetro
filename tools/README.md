# Home suite updater

`update-home-suite.py` updates existing Glass Home, Garage Home and Vetro installations from the exact CI artifacts declared in its `APPS` table. It uses the Vetro 0.5.0 Home enhancements build and the two clients that use stock Vetro APIs.

Requirements:

- Linux with Python 3.10+, OpenSSL, and an existing `samsung-tv-tools` project.
- The reviewed Apps2Samsung CLI, located by `vetro-install/bin/apps2samsung-beta.path`.
- An existing usable Partner certificate that covers the TV and has the same author identity as all three installed apps.
- Vetro running with root connected. Owner pairing may prompt for the code displayed on the TV.
- TV-Store's relay enabled on port 26201, with no other installer or debugger session. Developer Mode Host PC IP stays `127.0.0.1`.

Run with `vetro_owner.py` beside the updater:

```bash
python3 tools/update-home-suite.py --project-root /path/to/samsung-tv-tools --tv TV_IP --local-ip COMPUTER_IP --report-host user@COMPUTER_IP
```

Add `--check-only` to download and prepare the packages without installing them. GitHub Actions artifacts have limited retention; an expired or unavailable artifact stops preparation. The downloader uses nightly.link for public artifact access and checks the archive against a pinned SHA-256 digest from GitHub. Cached archives receive the same checksum check.

All three packages are prepared before the first installation. Installed client configuration files and local service keys are included in their replacement packages. The installer keeps each package ID and does not authorize uninstall or remove-and-reinstall recovery. Existing app data remains in place.

Glass Home and Garage Home are installed first and their services reopened and checked. Vetro is installed last. If the old 0.5.0 service still answers, the updater attempts one targeted app/service restart. An active native Home launcher is refreshed while retaining its selected mode. The updater does not reboot the TV or enable an inactive Home launcher.

The updater keeps a private installation ledger and prepared packages under `vetro-install/home-suite-20261108-r1`. Do not share prepared packages: they contain the installed client configuration and local keys. The JSON report omits these values and prints an `rsync` command for copying the report.

An installation attempt is recorded before it is submitted. Rerunning verifies that attempt against the installed payload and author identity; it never automatically submits that installation again. If verification fails, keep the report and investigate before starting another updater.

Run the isolated updater tests with `python3 -m unittest discover -s tools/tests -v`. These tests cover preparation order, configuration retention, archive checks, package identity, resumability, and failure handling. They do not replace hardware testing.
