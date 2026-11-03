# Home and remote shortcuts

Home has one saved assignment shared by the Launcher and Remapper pages. Its
default is Samsung Home through the TV's normal key delivery.

## Use Vetro on Home

1. Open **Launcher** and turn on **Vetro launcher**.
2. Confirm that Home should use Vetro. This replaces any custom Home action.
3. If remote setup is needed, choose **Detect Home and enable Vetro** and press
   Home once. Detection waits until you press the button or cancel it.
4. Press Home to show the overlay and press it again to hide it.

The assignment is saved on the TV and restored when Vetro starts. A known remote
can be reused without another capture. If the remote cannot be identified, the
page requests detection instead of selecting an input device automatically.

The remapper handles physical Home and sends the toggle command to the launcher.
The launcher handles navigation while visible. Samsung Home can remain behind it.
Turning off Vetro on the Launcher page restores Home's native behavior. Other
saved shortcuts keep their settings.

## Choose another app

1. Open **Remapper → Home button → Edit**.
2. Choose **Open app**, select an installed app, and choose **Save changes**.
3. Press Home to open that app.

The app list includes installed, enabled apps with launcher entries. Refresh the
Task manager app list after installing an app. Saving another Home action switches
Vetro off on the Launcher page. Enable Vetro there again to assign Home back to
its toggle. An app shortcut opens the app; it does not dismiss it on a second press.
Use **Restore default** to remove the override and return Home to Samsung Home.

Keep an alternative launcher's own Home takeover off when Vetro manages the key.
For AeroTizen builds with App mode, leave that mode on.

## Edit and enable other shortcuts

Every saved mapping has **Edit**, including HTTP and MQTT rules. The editor keeps
its trigger, enabled state and actions. **Save changes** updates that mapping;
**Cancel** leaves it unchanged. Ordinary mappings can also be deleted.

**Enable remote shortcuts** controls other physical mappings. Home follows its
own assignment, so enabling Vetro does not activate unrelated paused shortcuts.
HTTP and MQTT triggers are independent of this switch.

**Start listening** temporarily pauses all physical mappings, including Home,
while retaining their saved settings. **Stop listening** restores those settings.
Unmapped keys keep their native behavior.

## Availability

A missing or restarting launcher can fall back once to the TV's native Home key
when non-delivery is confirmed. An uncertain toggle result is not replayed;
interception is released and an error is shown. **Refresh status** reads the
current connection and any error. Changing the Home assignment applies immediately
without rebooting the TV.

Physical mappings apply to the selected remote device. Home commands from
HDMI-CEC, network remotes or another input device are not covered by that selection.
