#!/usr/bin/env bash
# Run from a clean checkout of combined/permissions-startup-return.
# Usage: bash tools/update-both.sh TV_IPV4 MINT_IPV4 [PROJECT_ROOT] [REPORT_SSH_HOST]
{
printf '%s\n' '=== Glass Home and Vetro combined update START ==='
vetro_tv="${1:-}"
vetro_mint="${2:-}"
vetro_project="${3:-$HOME/devProjects/samsung-tv-tools}"
vetro_report_host="${4:-}"
vetro_tools="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vetro_checkout="$(dirname "$vetro_tools")"
vetro_glass_commit="195e499e76ad4e9297c9962ce4347ad16bdb20be"
if [ -z "$vetro_tv" ] || [ -z "$vetro_mint" ]; then
    printf '%s\n' 'Usage: bash tools/update-both.sh TV_IPV4 MINT_IPV4 [PROJECT_ROOT] [REPORT_SSH_HOST]'
elif ! vetro_commit="$(git -C "$vetro_checkout" rev-parse HEAD)"; then
    printf '%s\n' 'STOPPED: Run this complete script from its Vetro checkout.'
elif [ -n "$(git -C "$vetro_checkout" status --porcelain)" ]; then
    printf '%s\n' 'STOPPED: The Vetro checkout has local changes; they were not overwritten.'
else
    printf '%s\n' 'Keep the TV on. Leave Developer Mode ON and Host PC IP at 127.0.0.1.'
    printf '%s\n' 'Glass Home is updated first; Vetro is updated last. Existing certificates are reused.'
    if python3 -B "$vetro_tools/capture-combined-state.py" --tv "$vetro_tv" --project-root "$vetro_project" --report-host "$vetro_report_host" &&
       python3 -B "$vetro_tools/install-glass-permissions.py" --tv "$vetro_tv" --mint "$vetro_mint" \
            --project-root "$vetro_project" --expected-commit "$vetro_glass_commit" --report-host "$vetro_report_host"; then
        if python3 -B "$vetro_tools/install-combined.py" --tv "$vetro_tv" --expected-commit "$vetro_commit" \
                --project-root "$vetro_project" --report-host "$vetro_report_host"; then
            printf '%s\n' 'Both updates verified. Pair the browser with Vetro, enable App access, then use Glass Home > + > Connect to Vetro.'
            printf '%s\n' 'Approve only List TV apps and Open TV apps for Glass Home, then Refresh apps there.'
            printf '%s\n' 'Test Netflix launches, Home/Exit, power-on selection and automatic return. See notes/combined-permissions-testing.md.'
        else
            printf '%s\n' 'STOPPED: Check the Vetro report above. Rerunning resumes an uncertain Vetro attempt without reinstalling.'
        fi
    else
        printf '%s\n' 'STOPPED: Check the status capture or Glass Home report above. Vetro was not updated.'
    fi
fi
printf '%s\n' '=== Glass Home and Vetro combined update END ==='
}
