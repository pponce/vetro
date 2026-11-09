# Install the direct Home test build

Keep the TV awake with Vetro connected to root. Use the existing SDB connection or TV-store relay; close other Apps2Samsung/debug sessions. The updater uses the saved Partner certificate and verifies the existing app identity before installing.

Paste the complete block below into the existing Linux project host's SSH terminal. Replace the three address arguments with the TV address, project host address, and SSH report destination for that installation.

```bash
{
  printf '\n=== Vetro direct Home update START ===\n'
  vetro_installer_dir="$HOME/devProjects/samsung-tv-tools/vetro-install/direct-home-installer-r1"
  vetro_tools_base='https://raw.githubusercontent.com/pponce/vetro/25586a48e5c52fa3bdac3ada4befc5dbd554b848/tools'
  if mkdir -p "$vetro_installer_dir" &&
     curl --fail --location --silent --show-error --connect-timeout 15 --max-time 90 "$vetro_tools_base/update-home-suite.py" -o "$vetro_installer_dir/update-home-suite.py" &&
     curl --fail --location --silent --show-error --connect-timeout 15 --max-time 90 "$vetro_tools_base/vetro_owner.py" -o "$vetro_installer_dir/vetro_owner.py" &&
     curl --fail --location --silent --show-error --connect-timeout 15 --max-time 90 "$vetro_tools_base/update-vetro-direct-home.py" -o "$vetro_installer_dir/update-vetro-direct-home.py" &&
     (
       cd "$vetro_installer_dir" && sha256sum --check <<'VETRO_SHA256'
53e1b4826004e52a6369180fe3df5d4dade090c56f09622978f715e1eff155f7  update-home-suite.py
56c6a1de5b079216e72029aabdf1482ebbd508e034eecda40ae2e13b0f1e3f00  vetro_owner.py
b37a5c52be1a6979f80aaf58143fe545c73b5aafc547b455d637bc2f35d20280  update-vetro-direct-home.py
VETRO_SHA256
     ) &&
     python3 "$vetro_installer_dir/update-vetro-direct-home.py" \
       --project-root "$HOME/devProjects/samsung-tv-tools" \
       --tv TV_IP --local-ip PROJECT_HOST_IP --report-host SSH_USER@PROJECT_HOST_IP
  then
    printf '\n=== Vetro direct Home update END: OK ===\n'
  else
    printf '\n=== Vetro direct Home update END: STOPPED; retain the output and any report ===\n'
  fi
  unset vetro_installer_dir vetro_tools_base
}
```

The updater prints the exact report path and an `rsync -P` command to run on the computer receiving the report. A rerun checks an existing recorded installation instead of automatically installing again.

After installation, the report distinguishes installation verification from direct-input readiness. If interception is off, select the physical remote in Remapper and enable interception. Select Vetro in Launcher for the overlay. No separate Home shortcut rule is needed. Leave **Disable Samsung Home** off.

Test Home once from Apple TV, a distinct fast double press, a slower second press, a held Home key, and the Samsung Home tile. Record any Samsung Home flash. Report Samsung TV Plus taking over separately; this build does not claim to fix that behavior.
