# Use stock Vetro 0.5.0 for optional TV controls

Garage Home's authenticated local service maps its controls to stock Vetro endpoints. Running apps and verified close use `/monitor` and `/components/action`; audio and sleep standby use `/control`; optional panel brightness uses `/tv-settings`.

Only visible, enabled, removable user apps can be closed. Existing confirmation, verification, sleep cancellation, brightness opt-in and uncertain-command handling are preserved. Sources continues to use native Tizen APIs. The adapter accepts no arbitrary host, route or shell command and does not require a Vetro owner credential.

[CI](https://github.com/pponce/garage-home/actions/runs/42508972819) passes package/installer tests, control/source/sleep tests and browser checks, and produces an unsigned widget. Hardware validation remains outstanding.

This PR targets this fork's `feat/vetro-controls`, which contains the existing controls and native Sources work.
