#!/usr/bin/env bash
# drift.sh <.codebase-tutor dir> [repo-root]
# Compares the repo against the commit stamp in repo-map.md and reports which
# top-level areas changed — powering the welcome-back "heads up" line and the
# decision of what to re-recon. Facts only; the LLM decides what stale means
# for the tour.
#
# Exit codes:
#   0 = report printed (FRESH or STALE lines)
#   1 = input problem
#   2 = cannot compare (no git, no/unknown stamp) — full re-recon recommended
set -uo pipefail

dir="${1:?usage: drift.sh <.codebase-tutor dir> [repo-root]}"
cd "${2:-.}" || { echo "FAIL: cannot cd to ${2:-.}" >&2; exit 1; }

map="$dir/repo-map.md"
[ -f "$map" ] || { echo "SKIP: $map not found — nothing to compare" >&2; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "SKIP: not a git repo — cannot compare" >&2; exit 2; }

stamp=$(grep -E '^commit: [0-9a-f]{7,40}$' "$map" | head -1 | awk '{print $2}')
[ -n "$stamp" ] || { echo "SKIP: no valid 'commit:' stamp in repo-map.md — full re-recon recommended" >&2; exit 2; }
git cat-file -e "$stamp^{commit}" 2>/dev/null \
  || { echo "SKIP: stamp $stamp unknown to this repo (rebase/gc/shallow clone?) — full re-recon recommended" >&2; exit 2; }

head_now=$(git rev-parse --short HEAD)
changed=$(git diff --name-only "$stamp"..HEAD 2>/dev/null)
# include uncommitted work too — it's still drift from the map's perspective
worktree=$(git status --porcelain 2>/dev/null | cut -c4- | sed 's/.* -> //')
# the tutor's own memory folder isn't drift in the repo it describes
top=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
mem=$(cd "$dir" 2>/dev/null && pwd -P)
case "$mem/" in "$top"/?*) mem="${mem#"$top"/}" ;; *) mem="" ;; esac
all=$(printf '%s\n%s\n' "$changed" "$worktree" | grep -v '^$' \
  | awk -v m="$mem" 'm == "" || (index($0, m "/") != 1 && $0 != m)' | sort -u)

echo "== DRIFT: map stamped at $stamp, repo now at $head_now =="
if [ -z "$all" ]; then
  echo "FRESH: no changes since the map was stamped — trust the cache"
  exit 0
fi

total=$(echo "$all" | wc -l | tr -d ' ')
echo "STALE: $total file(s) changed since the stamp. By area:"
echo "$all" | awk -F/ '{print (NF>1 ? $1 : "(root)")}' | sort | uniq -c | sort -rn \
  | while read -r n area; do
      printf "  STALE  %-24s %s file(s) changed\n" "$area" "$n"
    done
echo
echo "Areas not listed above are untouched — trust the cache for them."
echo "Changed files (first 25):"
echo "$all" | head -25 | sed 's/^/  /'
