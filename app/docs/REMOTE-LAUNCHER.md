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
when this fallback is used. An unconfirmed command releases interception and
shows an error; it is not repeated. Turn off **Remote interception** to restore
the remote's normal key delivery.

Interception applies to the selected physical device. Home commands from HDMI-CEC,
network remotes, or other input devices are not covered by that selection.
