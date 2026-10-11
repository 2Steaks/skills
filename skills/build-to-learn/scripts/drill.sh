#!/usr/bin/env bash
# drill.sh plant [--patch <file>] | status | cleanup [--force]
# Deterministic safety choreography for debugging drills and boss fights.
# Guarantees: drills only start from a clean tree, live only on a tutor/drill-*
# branch, and cleanup restores the repo to exactly the pre-drill state.
# State lives in .git/codebase-tutor-drill (inside .git = can never be committed).
set -uo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository — use a static drill instead"
gitdir="$(git rev-parse --git-dir)"
state="$gitdir/codebase-tutor-drill"

cmd="${1:-}"; shift || true

case "$cmd" in
  plant)
    patch=""
    [ "${1:-}" = "--patch" ] && { patch="${2:?--patch needs a file}"; shift 2; }
    [ -f "$state" ] && die "a drill is already in progress ($(cat "$state" | head -1)) — run cleanup first"
    [ -z "$(git status --porcelain)" ] || die "working tree not clean — commit or stash first (drills never touch unsaved work)"

    orig_branch="$(git rev-parse --abbrev-ref HEAD)"
    orig_head="$(git rev-parse HEAD)"
    branch="tutor/drill-$(date +%s)"

    git switch -c "$branch" >/dev/null 2>&1 || die "could not create $branch"
    {
      echo "branch=$branch"
      echo "orig_branch=$orig_branch"
      echo "orig_head=$orig_head"
      echo "planted=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$state"

    if [ -n "$patch" ]; then
      git apply "$patch" 2>/dev/null || { git switch "$orig_branch" >/dev/null 2>&1; git branch -D "$branch" >/dev/null 2>&1; rm -f "$state"; die "patch did not apply cleanly — drill aborted, repo untouched"; }
      git add -A && git commit -q -m "tutor drill: environment setup" \
        || { git switch "$orig_branch" >/dev/null 2>&1; git branch -D "$branch" >/dev/null 2>&1; rm -f "$state"; die "commit failed — drill aborted"; }
      echo "OK: drill planted on $branch (bug committed; git status is clean — no spoilers)"
    else
      echo "OK: drill branch $branch created. Edit files to plant the bug, then: git add -A && git commit -m 'tutor drill: environment setup'"
    fi
    echo "cleanup later with: drill.sh cleanup"
    ;;

  status)
    if [ -f "$state" ]; then echo "DRILL IN PROGRESS:"; cat "$state"; else echo "no drill in progress"; fi
    ;;

  cleanup)
    force=0; [ "${1:-}" = "--force" ] && force=1
    [ -f "$state" ] || die "no drill in progress"
    # shellcheck disable=SC1090
    branch=$(grep '^branch=' "$state" | cut -d= -f2)
    orig_branch=$(grep '^orig_branch=' "$state" | cut -d= -f2)
    orig_head=$(grep '^orig_head=' "$state" | cut -d= -f2)

    if [ -n "$(git status --porcelain)" ] && [ "$force" -ne 1 ]; then
      die "uncommitted changes on the drill branch (the learner's work). Re-run with --force to discard them — confirm with the learner first"
    fi

    git switch "$orig_branch" >/dev/null 2>&1 || git switch -f "$orig_branch" >/dev/null 2>&1 || die "could not switch back to $orig_branch"
    [ "$(git rev-parse HEAD)" = "$orig_head" ] || die "SAFETY STOP: $orig_branch is not at the recorded pre-drill commit ($orig_head). Not deleting anything — investigate manually"
    git branch -D "$branch" >/dev/null 2>&1
    [ -z "$(git status --porcelain)" ] || die "SAFETY STOP: working tree not clean after restore — investigate manually"
    rm -f "$state"
    echo "OK: repo restored to $orig_branch @ ${orig_head:0:7}; $branch deleted. Exactly as found."
    ;;

  *)
    echo "usage: drill.sh plant [--patch <file>] | status | cleanup [--force]" >&2
    exit 1
    ;;
esac
