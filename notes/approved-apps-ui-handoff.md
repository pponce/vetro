# Approved app details

## Objective and implementation

Approved apps use compact rows with an app name, status and disclosure control.
Opening a row reveals identity details, permissions, Save permissions,
Pause/Resume access, and Revoke approval. Revocation retains its confirmation.
Global-off and changed-installation states remain explicit.

Native details/summary controls support pointer, Enter and Space interaction.
Rows start collapsed; collapsing does not discard unsaved checkbox selections.
Refresh and successful saves preserve expansion by app identity. Save, pause
and resume return keyboard focus to the app row; revocation returns it to the
remaining refresh control. Long names truncate within the row.

The change touches dashboard presentation and browser acceptance coverage only.
Native identity, grants, signer checks, scope enforcement and input lifecycle
are unchanged. The runtime includes the screen authentication recovery from
parent `e41f7f4a2021c63505261645b1e39c8e2c06a4f6`.

## Validation and next steps

Local permission UI behavior, screen authentication recovery and live screen
status tests pass. Browser coverage checks collapsed controls, keyboard access,
preserved edits and expansion, status labels, confirmation, focus, stale saves
and 390-pixel layout. Local browser execution was unavailable because the browser
download is restricted; GitHub's existing browser job must pass before offering
the combined candidate for installation.

Branch: `pponce/vetro`, `combined/runtime-wrapper-observation-20261103`.
After all four runtime jobs pass, pin the exact candidate and run in the host
screen-recovery updater. Installed Vetro is still `e4033b41`; do not assume the
owner installed `e41f7f4a`. The working Glass Home version is now main at
`30c490194f1748d523262a1ac8985fe45f735729`; its main-branch CI also passed.
