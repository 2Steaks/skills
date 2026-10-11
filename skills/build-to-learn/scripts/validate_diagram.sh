#!/usr/bin/env bash
# validate_diagram.sh <diagram.mmd> [more.mmd ...]
# Best-effort Mermaid validation: renders each file to SVG so syntax errors
# and broken layouts are caught BEFORE the diagram is shown to a learner.
#
# Exit codes:
#   0 = all diagrams valid (SVGs written next to inputs)
#   1 = at least one diagram failed validation — fix or simplify it
#   2 = tooling unavailable/incomplete — skip validation, keep diagrams simple
#
# --open: after a successful render, open the SVG in the platform viewer
# (open/xdg-open/wslview/explorer.exe). Prints OPENED or COULD-NOT-OPEN —
# never assume the learner saw the diagram unless OPENED was printed.
set -uo pipefail

do_open=0
if [ "${1:-}" = "--open" ]; then do_open=1; shift; fi

if [ "$#" -lt 1 ]; then
  echo "usage: validate_diagram.sh [--open] <diagram.mmd> [more.mmd ...]" >&2
  exit 1
fi

open_file() { # $1 = file -> prints OPENED or COULD-NOT-OPEN
  if command -v open >/dev/null 2>&1; then                       # macOS
    open "$1" >/dev/null 2>&1 && { echo "OPENED: $1 (open)"; return 0; }
  fi
  if command -v wslview >/dev/null 2>&1; then                    # WSL with wslu
    wslview "$1" >/dev/null 2>&1 && { echo "OPENED: $1 (wslview)"; return 0; }
  fi
  if command -v explorer.exe >/dev/null 2>&1; then               # bare WSL
    explorer.exe "$(wslpath -w "$1" 2>/dev/null || echo "$1")" >/dev/null 2>&1
    echo "OPENED: $1 (explorer.exe)"; return 0
  fi
  if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then  # Linux desktop
    xdg-open "$1" >/dev/null 2>&1 && { echo "OPENED: $1 (xdg-open)"; return 0; }
  fi
  echo "COULD-NOT-OPEN: $1 — no GUI opener/display available; tell the learner the path (IDEs and editors preview SVGs)" >&2
  return 1
}

err="$(mktemp)"; trap 'rm -f "$err"' EXIT

render() { # $1 = input file -> 0 ok, 1 diagram error, 2 tooling missing/incomplete
  local in="$1" out="${1%.mmd}.svg" rc
  if command -v mmdc >/dev/null 2>&1; then
    mmdc -i "$in" -o "$out" --quiet >"$err" 2>&1; rc=$?
  elif command -v npx >/dev/null 2>&1 && npx -y @mermaid-js/mermaid-cli --version >/dev/null 2>&1; then
    npx -y @mermaid-js/mermaid-cli -i "$in" -o "$out" --quiet >"$err" 2>&1; rc=$?
  else
    return 2
  fi
  [ "$rc" -eq 0 ] && return 0
  # Renderer present but its browser backend is missing = tooling, not the diagram
  grep -qiE 'could not find chrome|puppeteer|browser was not found|error while loading shared libraries' "$err" && return 2
  return 1
}

status=0
for f in "$@"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: $f not found" >&2; status=1; continue
  fi
  render "$f"
  case $? in
    0) echo "OK:   $f -> ${f%.mmd}.svg"
       [ "$do_open" = 1 ] && open_file "${f%.mmd}.svg" ;;
    2) echo "SKIP: mermaid tooling unavailable or incomplete (missing mmdc/npx, or puppeteer Chrome not installed — try: npx puppeteer browsers install chrome-headless-shell). Keep diagrams simple: <=12 nodes, plain flowchart/sequence syntax." >&2
       exit 2 ;;
    *) echo "FAIL: $f has syntax/render errors — simplify it before showing the learner" >&2
       head -3 "$err" >&2; status=1 ;;
  esac
done
exit "$status"
