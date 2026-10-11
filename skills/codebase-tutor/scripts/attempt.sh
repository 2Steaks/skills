#!/usr/bin/env bash
# attempt.sh start | diff | status | end
# Guided-build change detection: records a baseline when a task starts, then
# reports ONLY the learner's changes — never pre-existing dirty work swept in.
# State lives in .git/ so it can never be committed.
#
#   start   record baseline (HEAD + already-dirty files). Refuses if one is active.
#   diff    show the learner's changes since start (commits + worktree),
#           excluding files that were already dirty at baseline.
#   status  show the active baseline.
#   end     clear the baseline.
#
# Exit codes: 0 ok, 1 error/no baseline, 3 (diff only) = no learner changes yet.
set -uo pipefail

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "FAIL: not a git repo" >&2; exit 1; }
gitdir=$(git rev-parse --git-dir)
state="$gitdir/codebase-tutor-attempt"

cmd="${1:-}"
case "$cmd" in
  start)
    [ -f "$state" ] && { echo "FAIL: an attempt is already active (started at $(head -1 "$state" | cut -d= -f2)) — run 'attempt.sh end' first" >&2; exit 1; }
    {
      echo "head=$(git rev-parse HEAD)"
      echo "date=$(date +%F)"
      echo "dirty<<"
      git status --porcelain | cut -c4- | sed 's/.* -> //'
      echo ">>"
    } > "$state"
    ndirty=$(git status --porcelain | wc -l | tr -d ' ')
    echo "OK: baseline recorded at $(git rev-parse --short HEAD) ($ndirty pre-existing dirty file(s) will be excluded from review)"
    ;;

  status)
    [ -f "$state" ] && { echo "ATTEMPT ACTIVE:"; sed -n '1,2p' "$state"; } || echo "no active attempt baseline"
    ;;

  end)
    [ -f "$state" ] && { rm -f "$state"; echo "OK: baseline cleared"; } || echo "no active attempt baseline"
    ;;

  diff)
    [ -f "$state" ] || { echo "FAIL: no baseline — run 'attempt.sh start' when the task begins" >&2; exit 1; }
    base=$(grep '^head=' "$state" | cut -d= -f2)
    excl="$(mktemp)"; trap 'rm -f "$excl"' EXIT
    sed -n '/^dirty<</,/^>>$/p' "$state" | sed '1d;$d' > "$excl"

    # tracked changes since baseline (covers learner commits AND worktree edits)
    tracked=$(git diff --name-only "$base" 2>/dev/null | { grep -vxF -f "$excl" || true; })
    # untracked new files
    untracked=$(git ls-files --others --exclude-standard | { grep -vxF -f "$excl" || true; })
    files=$(printf '%s\n%s\n' "$tracked" "$untracked" | grep -v '^$' | sort -u)
    nexcl=$(wc -l < "$excl" | tr -d ' ')

    if [ -z "$files" ]; then
      echo "NO-ATTEMPT: no learner changes on disk since the baseline ($nexcl pre-existing dirty file(s) excluded)"
      exit 3
    fi
    echo "== LEARNER CHANGES since baseline $(git rev-parse --short "$base") ($nexcl baseline file(s) excluded) =="
    echo "$files" | sed 's/^/  /'
    echo
    echo "$files" | while IFS= read -r f; do
      if git ls-files --error-unmatch "$f" >/dev/null 2>&1 || git cat-file -e "$base:$f" 2>/dev/null; then
        git diff "$base" -- "$f"
      else
        echo "--- new file: $f ---"
        sed 's/^/+ /' "$f" 2>/dev/null | head -80
      fi
    done
    ;;

  *)
    echo "usage: attempt.sh start | diff | status | end" >&2
    exit 1
    ;;
esac
