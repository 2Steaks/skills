#!/usr/bin/env bash
# archaeology.sh <path> [repo-root]
# Mines the real git history of a file or directory: the facts that feed area
# histories and the architectural-decisions section. Output is evidence with hashes
# to cite — the LLM narrates, this script never speculates.
set -uo pipefail

path="${1:?usage: archaeology.sh <path> [repo-root]}"
cd "${2:-.}" || { echo "FAIL: cannot cd to ${2:-.}" >&2; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "FAIL: not a git repository — no history to mine" >&2; exit 2; }
[ -e "$path" ] || { echo "FAIL: $path not found" >&2; exit 1; }

echo "== ARCHAEOLOGY: $path =="

first=$(git log --follow --diff-filter=A --format='%h %ad %an — %s' --date=short -- "$path" 2>/dev/null | tail -1)
last=$(git log -1 --format='%h %ad %an — %s' --date=short -- "$path" 2>/dev/null)
count=$(git log --follow --oneline -- "$path" 2>/dev/null | wc -l | tr -d ' ')
echo "born:        ${first:-unknown}"
echo "last change: ${last:-unknown}"
echo "commits:     $count"

echo; echo "-- top authors --"
git shortlog -sn HEAD -- "$path" 2>/dev/null | head -5 | sed 's/^/  /'

echo; echo "-- churn by year --"
git log --follow --format='%ad' --date=format:'%Y' -- "$path" 2>/dev/null | sort | uniq -c | sed 's/^/  /'

echo; echo "-- biggest changes (lines touched — refactor candidates) --"
git log --follow --numstat --format='@%h %ad %s' --date=short -- "$path" 2>/dev/null \
  | awk '/^@/{if(c!="")print tot[c], c; c=substr($0,2); tot[c]=0}
         /^[0-9]/{tot[c]+=$1+$2}
         END{if(c!="")print tot[c], c}' \
  | sort -rn | head -5 | sed 's/^/  /'

echo; echo "-- reverts and rescues --"
rev=$(git log --format='%h %ad %s' --date=short -- "$path" 2>/dev/null | grep -iE 'revert|rollback|undo' | head -5)
[ -n "$rev" ] && echo "$rev" | sed 's/^/  /' || echo "  (none)"

if [ -f "$path" ]; then
  echo; echo "-- oldest surviving lines (git blame) --"
  git blame --date=short -- "$path" 2>/dev/null \
    | sed -E 's/^\^?([0-9a-f]+)[^(]*\(.* ([0-9]{4}-[0-9]{2}-[0-9]{2}) +[0-9]+\) (.*)$/\2 \1 \3/' \
    | sort | head -3 | sed 's/^/  /'
fi

echo; echo "-- notable commit messages --"
msg=$(git log --format='%h %ad %s' --date=short -- "$path" 2>/dev/null \
  | grep -iE 'refactor|rewrite|rework|migrate|finally|hack|workaround|temporary|sorry|oops|why' | head -8)
[ -n "$msg" ] && echo "$msg" | sed 's/^/  /' || echo "  (none matched)"

echo; echo "== END ARCHAEOLOGY =="
