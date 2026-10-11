#!/usr/bin/env bash
# progress.sh — deterministic helpers for the review queue and knowledge map.
# The LLM still edits the tables; this script does the parts LLMs get subtly
# wrong: date arithmetic, due filtering, and consistent fog-of-war rendering.
#
#   progress.sh next <1d|3d|7d|21d|60d>      print ISO date that interval from today
#   progress.sh promote <interval>           print the next rung up the ladder
#   progress.sh demote                       print the bottom rung (1d)
#   progress.sh due <learner-progress.md>    print review-queue rows due today or earlier
#   progress.sh render <learner-progress.md> print the fog-of-war map from the knowledge map
#   progress.sh lint <.build-coach dir>    validate memory files (0 ok, 1 problems, 2 no dir)
#   progress.sh anchor <learner-progress.md>  replace the Session state block with stdin content
set -uo pipefail

LADDER=(1d 3d 7d 21d 60d)
die() { echo "FAIL: $*" >&2; exit 1; }

iso_plus_days() { # $1 = N days
  date -d "+$1 days" +%F 2>/dev/null || date -v+"$1"d +%F 2>/dev/null || die "no usable date command"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  next)
    iv="${1:?usage: progress.sh next <interval>}"
    days="${iv%d}"; [ "$days" != "$iv" ] && [ "$days" -gt 0 ] 2>/dev/null || die "interval must look like 3d"
    iso_plus_days "$days"
    ;;

  promote)
    iv="${1:?usage: progress.sh promote <interval>}"
    out="${LADDER[${#LADDER[@]}-1]}"
    for i in "${!LADDER[@]}"; do
      if [ "${LADDER[$i]}" = "$iv" ]; then
        n=$((i+1)); [ "$n" -lt "${#LADDER[@]}" ] && out="${LADDER[$n]}" || out="${LADDER[$i]}"
      fi
    done
    echo "$out (next review: $(iso_plus_days "${out%d}"))"
    ;;

  demote)
    echo "1d (next review: $(iso_plus_days 1))"
    ;;

  due)
    f="${1:?usage: progress.sh due <learner-progress.md>}"; [ -f "$f" ] || die "$f not found"
    today=$(date +%F)
    awk -v today="$today" '
      /^## Review queue/ {s=1; next}
      /^## /             {s=0}
      s && /^\|/ && !/^\|[-:| ]+$/ && $0 !~ /\| *Concept/ {
        n=split($0, c, "|")
        d=c[n-1]; gsub(/ /,"",d)
        if (d != "" && d <= today) print
      }' "$f"
    ;;

  render)
    f="${1:?usage: progress.sh render <learner-progress.md>}"; [ -f "$f" ] || die "$f not found"
    awk '
      function glyph(lv) {
        if (lv ~ /demonstrated/) return "\xe2\x96\x88"
        if (lv ~ /recalled/)     return "\xe2\x96\x93"
        if (lv ~ /covered/)      return "\xe2\x96\x92"
        return "\xe2\x96\x91"
      }
      function label(lv) {
        if (lv ~ /demonstrated/) return "fully mapped"
        if (lv ~ /recalled/)     return "explored"
        if (lv ~ /covered/)      return "sketched"
        return "unexplored"
      }
      /^## Knowledge map/ {s=1; next}
      /^## /              {s=0}
      s && /^\|/ && !/^\|[-:| ]+$/ && $0 !~ /\| *Area/ {
        split($0, c, "|")
        area=c[2]; lv=c[3]
        gsub(/^ +| +$/, "", area); gsub(/^ +| +$/, "", lv)
        total++
        if (lv ~ /demonstrated/) full++
        else if (lv ~ /recalled/) rec++
        else if (lv ~ /covered/) cov++
        printf "%s %-28s — %s\n", glyph(lv), area, label(lv)
      }
      END {
        if (total == 0) { print "(knowledge map is empty)"; exit }
        printf "\n%d of %d regions fully mapped", full, total
        if (rec) printf ", %d explored", rec
        if (cov) printf ", %d sketched", cov
        print ""
      }' "$f"
    ;;

  anchor)
    f="${1:?usage: progress.sh anchor <learner-progress.md>  (new block content on stdin)}"
    [ -f "$f" ] || die "$f not found"
    tmp_new="$(mktemp)"; tmp_out="$(mktemp)"
    cat > "$tmp_new"
    [ -s "$tmp_new" ] || { rm -f "$tmp_new" "$tmp_out"; die "no anchor content on stdin"; }
    awk -v nf="$tmp_new" '
      function emit() { print "## Session state (resume anchor)"; while ((getline l < nf) > 0) print l; close(nf); printed=1 }
      /^## Session state/ { emit(); skip=1; next }
      skip && /^## /      { skip=0 }
      skip                { next }
      { print }
      END { if (!printed) { print ""; emit() } }
    ' "$f" > "$tmp_out" && mv "$tmp_out" "$f"
    rm -f "$tmp_new"
    echo "OK: session anchor updated in $f"
    ;;

  lint)
    dir="${1:?usage: progress.sh lint <.build-coach dir>}"
    [ -d "$dir" ] || { echo "SKIP: $dir does not exist (no memory yet)"; exit 2; }
    problems=0
    problem() { echo "PROBLEM: $1"; problems=1; }
    map="$dir/project-plan.md"; prog="$dir/learner-progress.md"

    if [ -f "$map" ]; then
      grep -Eq '^date: [0-9]{4}-[0-9]{2}-[0-9]{2}' "$map" \
        || problem "project-plan.md: missing/malformed 'date: YYYY-MM-DD' line"
      grep -Eq '^## Milestones' "$map" \
        || problem "project-plan.md: missing '## Milestones' section — the plan is the syllabus"
    else problem "project-plan.md missing"; fi

    if [ -f "$prog" ]; then
      awk '/^## Knowledge map/{s=1;next} /^## /{s=0} s && /^\|/ && !/^\|[-:| ]+$/ && !/^\| *Area/ {print}' "$prog" \
        | while IFS= read -r row; do
            echo "$row" | grep -Eq 'not seen|covered|recalled|demonstrated' \
              || echo "PROBLEM: knowledge map row has no valid level: $row"
          done | grep . && problems=1
      awk '/^## Review queue/{s=1;next} /^## /{s=0} s && /^\|/ && !/^\|[-:| ]+$/ && !/^\| *Concept/ {print}' "$prog" \
        | while IFS= read -r row; do
            cols=$(echo "$row" | awk -F'|' '{print NF-2}')
            [ "$cols" -eq 5 ] || echo "PROBLEM: review queue row has $cols columns (expected 5): $row"
            echo "$row" | grep -Eq '[0-9]{4}-[0-9]{2}-[0-9]{2}' \
              || echo "PROBLEM: review queue row missing ISO next-review date: $row"
          done | grep . && problems=1
      grep -Eq '^save: (auto|off)' "$prog" \
        || problem "learner-progress.md: missing 'save: auto|off' consent line — sessions will re-ask"
    else problem "learner-progress.md missing"; fi

    if [ "$problems" -eq 0 ]; then echo "OK: memory files are well-formed"; exit 0; fi
    echo "Fix the problems above (edit the files) before trusting resume/scheduling."
    exit 1
    ;;

  *)
    echo "usage: progress.sh next <interval> | promote <interval> | demote | due <file> | render <file> | lint <dir> | anchor <file>" >&2
    exit 1
    ;;
esac
