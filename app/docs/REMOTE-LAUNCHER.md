# Open the launcher with the remote

The **Toggle Vetro launcher** action shows or hides the enabled Vetro launcher
over the current screen. When the Home key is mapped to this action and remote
interception is connected, Samsung Home can remain open behind the launcher.

## Set up the Home key

1. Turn on **Vetro launcher** in the **Launcher** tab.
2. Open **Remapper**, select **Detect automatically (listen only)** and choose
   **Start listening**.
3. Press **Home** on the remote. Confirm that the captured key and selected
   physical device correspond to that press.
4. Under **Action**, choose **Toggle Vetro launcher**, then **Save shortcut**.
5. Turn on **Remote interception** for the captured physical device. Confirm
   that its status says it is connected.

The shortcut and interception preference are saved on the TV and restored when
Vetro starts. Listening temporarily pauses interception; resume interception
before testing the shortcut. Other keys retain their native behavior unless
you have mapped them separately.

If the launcher is disabled, restarting, or confirms that it did not receive the
command, the action sends the TV's native Home key. The Remapper status reports
when this fallback is used; choose **Refresh status** to read the latest result.
An unconfirmed command releases interception and
shows an error; it is not repeated. Turn off **Remote interception** to restore
the remote's normal key delivery.

Interception applies to the selected physical device. Home commands from HDMI-CEC,
network remotes, or other input devices are not covered by that selection.

## Open an installed app with Home

The **Open app** action can assign Home to an installed launcher or another app.
The **App to open** list comes from the TV's installed, enabled apps with a visible
app entry. If an app was recently installed, refresh the app list in **Task manager**.

1. In **Remapper**, capture Home or enter its previously captured key code.
2. Choose **Action → Open app**.
3. Select the app in **App to open**, then choose **Save shortcut**.
4. Keep **Remote interception** enabled for the physical device that supplies Home.

Saving a shortcut replaces the existing physical shortcut for that key. Selecting
an app therefore replaces **Toggle Vetro launcher** as that key's action.
When using an app as the Home screen, turn off **Vetro launcher** in the Launcher
tab. Disable the selected app's own Home takeover or automatic return behavior
so Vetro controls the physical Home press. For AeroTizen builds with **App mode**,
keep that mode on.

To use Vetro's launcher again, enable **Vetro launcher** and save **Toggle Vetro
launcher** for the same Home key. Keep Remote interception enabled. An app shortcut
opens the selected app; it does not toggle that app open and closed.
