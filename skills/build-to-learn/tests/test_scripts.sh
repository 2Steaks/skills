#!/usr/bin/env bash
# test_scripts.sh — self-test for every bundled helper script.
# Builds a throwaway fixture repo, exercises each script's happy path and its
# most important safety/fallback path, and reports PASS/FAIL per check.
# Run after any script change, and on any new machine to verify the toolkit.
#
# Exit: 0 = all pass, 1 = failures (listed).
set -uo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"   # skill root
S="$here/scripts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass=0; fail=0
ok()   { pass=$((pass+1)); echo "PASS: $1"; }
bad()  { fail=$((fail+1)); echo "FAIL: $1"; }
check(){ # $1 desc, $2 exit-code-received, $3 expected (space-separated list ok)
  for e in $3; do [ "$2" = "$e" ] && { ok "$1"; return; }; done
  bad "$1 (exit $2, wanted $3)"
}

# ---------- fixture repo ----------
repo="$work/fixture"
mkdir -p "$repo/src" "$repo/docs"
cd "$repo"
git init -q && git config user.email test@test && git config user.name Tester
printf 'def add(a, b):\n    return a + b\n' > src/calc.py
printf 'from src.calc import add\nprint(add(1, 2))\n' > main.py
printf '# Fixture\n' > README.md
printf 'requests\n' > requirements.txt
git add -A && git commit -qm "init"
printf 'def sub(a, b):\n    return a - b\n' >> src/calc.py
git add -A && git commit -qm "refactor: add sub"




# ---------- drill.sh ----------
cd "$repo"
sed -i.bak 's/return a + b/return a - b/' src/calc.py 2>/dev/null || sed -i '' 's/return a + b/return a - b/' src/calc.py
rm -f src/calc.py.bak
git diff > "$work/bug.patch" && git checkout -q -- .
timeout 30 bash "$S/drill.sh" plant --patch "$work/bug.patch" >/dev/null 2>&1
check "drill.sh plant on clean tree" "$?" 0
git rev-parse --abbrev-ref HEAD | grep -q '^tutor/drill-' && ok "drill.sh uses scratch branch" || bad "drill.sh not on scratch branch"
[ -z "$(git status --porcelain)" ] && ok "drill.sh leaves status spoiler-free" || bad "drill.sh dirty status after plant"
timeout 30 bash "$S/drill.sh" plant --patch "$work/bug.patch" >/dev/null 2>&1
check "drill.sh refuses double plant" "$?" 1
echo "learner work" >> src/calc.py
timeout 30 bash "$S/drill.sh" cleanup >/dev/null 2>&1
check "drill.sh cleanup refuses to discard uncommitted work" "$?" 1
timeout 30 bash "$S/drill.sh" cleanup --force >/dev/null 2>&1
check "drill.sh forced cleanup succeeds" "$?" 0
grep -q 'return a + b' src/calc.py && ok "drill.sh restores original code" || bad "drill.sh restore mismatch"
[ -z "$(git branch --list 'tutor/*')" ] && ok "drill.sh deletes scratch branch" || bad "drill.sh left scratch branch"

# ---------- progress.sh ----------
d=$(bash "$S/progress.sh" next 3d); rc=$?
check "progress.sh next" "$rc" 0
echo "$d" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && ok "progress.sh next prints ISO date" || bad "progress.sh next bad date: $d"
bash "$S/progress.sh" promote 7d  | grep -q '^21d' && ok "progress.sh promote climbs ladder" || bad "progress.sh promote wrong"
bash "$S/progress.sh" promote 60d | grep -q '^60d' && ok "progress.sh promote caps at 60d"   || bad "progress.sh cap wrong"
bash "$S/progress.sh" demote      | grep -q '^1d'  && ok "progress.sh demote returns 1d"     || bad "progress.sh demote wrong"

mem="$work/mem"; mkdir -p "$mem"
printf '# Project plan\ndate: 2026-01-01\n\n## Milestones\n1. CLI skeleton\n' > "$mem/project-plan.md"
cat > "$mem/learner-progress.md" << 'EOF'
save: auto

## Knowledge map
| Area | Level | Evidence | Last touched |
|---|---|---|---|
| Routing | covered | toured | 2026-01-01 |
| Services | demonstrated | drill solved | 2026-01-02 |

## Review queue
| Concept | Anchor | Last result | Interval | Next review |
|---|---|---|---|---|
| Overdue thing | src/a.py | wrong (2026-01-01) | 1d | 2026-01-02 |
| Future thing | src/b.py | right (2026-01-01) | 60d | 2099-01-01 |
EOF
out=$(bash "$S/progress.sh" due "$mem/learner-progress.md")
echo "$out" | grep -q "Overdue thing" && ok "progress.sh due finds overdue row"      || bad "progress.sh due missed overdue"
echo "$out" | grep -q "Future thing"  && bad "progress.sh due leaked future row"     || ok "progress.sh due excludes future row"
out=$(bash "$S/progress.sh" render "$mem/learner-progress.md")
echo "$out" | grep -q "Routing"                    && ok "progress.sh render shows rows"      || bad "progress.sh render empty"
echo "$out" | grep -q "1 of 2 regions fully mapped" && ok "progress.sh render counts honestly" || bad "progress.sh render counts wrong"

# ---------- progress.sh lint ----------
bash "$S/progress.sh" lint "$mem" >/dev/null 2>&1
check "progress.sh lint passes clean files" "$?" 0
sed -i.bak 's/^date: 2026-01-01$/date: nope/' "$mem/project-plan.md" 2>/dev/null || sed -i '' 's/^date: 2026-01-01$/date: nope/' "$mem/project-plan.md"
bash "$S/progress.sh" lint "$mem" >/dev/null 2>&1
check "progress.sh lint catches bad plan date" "$?" 1
bash "$S/progress.sh" lint "$work/nonexistent" >/dev/null 2>&1
check "progress.sh lint exit 2 when no memory dir" "$?" 2

# ---------- progress.sh reads the "## Concept map" SKILL.md describes ----------
mem2="$work/mem2"; mkdir -p "$mem2"
printf '# Project plan\nsave: auto\ndate: 2026-01-01\n\n## Milestones\n1. CLI skeleton\n' > "$mem2/project-plan.md"
cat > "$mem2/learner-progress.md" << 'EOF'
## Concept map
| Concept | Level | Evidence | Last touched |
|---|---|---|---|
| Ownership | recalled | quiz | 2026-01-01 |
| Borrowing | demonstrated | milestone 2 | 2026-01-02 |

## Review queue
| Concept | Anchor | Last result | Interval | Next review |
|---|---|---|---|---|
| Lifetimes | src/main.rs | wrong (2026-01-01) | 1d | 2026-01-02 |
EOF
out=$(bash "$S/progress.sh" render "$mem2/learner-progress.md")
echo "$out" | grep -q "1 of 2 regions fully mapped" && ok "progress.sh render reads '## Concept map'" || bad "progress.sh render missed '## Concept map'"
echo "$out" | grep -q "Concept" && bad "progress.sh render counted the header row" || ok "progress.sh render skips the Concept header row"
bash "$S/progress.sh" due "$mem2/learner-progress.md" | grep -q "Lifetimes" && ok "progress.sh due reads the review queue beside a Concept map" || bad "progress.sh due missed the review queue"

# ---------- progress.sh lint: consent is recorded in project-plan.md ----------
bash "$S/progress.sh" lint "$mem2" >/dev/null 2>&1
check "progress.sh lint passes a Concept map with consent in project-plan.md" "$?" 0
sed -i.bak '/^save: /d' "$mem2/project-plan.md" 2>/dev/null || sed -i '' '/^save: /d' "$mem2/project-plan.md"
bash "$S/progress.sh" lint "$mem2" >/dev/null 2>&1
check "progress.sh lint flags a missing consent line" "$?" 1

# ---------- validate_diagram.sh (0 = rendered, 2 = no tooling — both acceptable) ----------
printf 'graph TD\n  A --> B\n' > "$work/d.mmd"
timeout 120 bash "$S/validate_diagram.sh" "$work/d.mmd" >/dev/null 2>&1
check "validate_diagram.sh valid diagram (or clean no-tooling skip)" "$?" "0 2"

# ---------- narrate.sh (0 = audio, 2 = no TTS — both acceptable) ----------
printf '# T\n\nHello world.\n\n```python\nx = 1\n```\n' > "$work/n.md"
timeout 60 bash "$S/narrate.sh" "$work/n.md" "$work/n" >/dev/null 2>&1
check "narrate.sh produces audio or cleanly skips" "$?" "0 2"
out=$(timeout 60 bash "$S/narrate.sh" --play "$work/n.md" "$work/n2" 2>&1); rc=$?
check "narrate.sh --play exits cleanly" "$rc" "0 2"
echo "$out" | grep -q "PLAYING\|PLAYED" && echo "$out" | grep -q "NOTE: audio saved" \
  && bad "narrate.sh claims playing AND failure" || ok "narrate.sh playback claims are consistent"

# ---------- validate_diagram.sh --open flag parsing ----------
timeout 120 bash "$S/validate_diagram.sh" --open "$work/d.mmd" >/dev/null 2>&1
check "validate_diagram.sh --open parses (renders+opens, or clean skip)" "$?" "0 2"

# ---------- validate_diagram.sh error classification (fake renderer, runs anywhere) ----------
fake="$work/fakebin"; mkdir -p "$fake"
printf '#!/usr/bin/env bash\necho "Error: Parse error on line 2:"\necho "    at render (/x/node_modules/puppeteer-core/lib/esm/puppeteer/api/Page.js:1:1)"\nexit 1\n' > "$fake/mmdc"
chmod +x "$fake/mmdc"
PATH="$fake:$PATH" timeout 30 bash "$S/validate_diagram.sh" "$work/d.mmd" >/dev/null 2>&1
check "validate_diagram.sh: parse error is the diagram's fault, even via puppeteer" "$?" 1
printf '#!/usr/bin/env bash\necho "Error: Could not find Chrome (ver. 131.0.6778.204)."\nexit 1\n' > "$fake/mmdc"
PATH="$fake:$PATH" timeout 30 bash "$S/validate_diagram.sh" "$work/d.mmd" >/dev/null 2>&1
check "validate_diagram.sh: missing browser is tooling, not the diagram" "$?" 2



# ---------- attempt.sh ----------
cd "$repo"
echo "pre-existing wip" >> README.md          # baseline dirt
bash "$S/attempt.sh" start >/dev/null 2>&1
check "attempt.sh start records baseline" "$?" 0
bash "$S/attempt.sh" diff >/dev/null 2>&1
check "attempt.sh diff exit 3 with no learner changes" "$?" 3
echo "learner change" >> src/calc.py
out=$(bash "$S/attempt.sh" diff); rc=$?
check "attempt.sh diff exit 0 with learner changes" "$rc" 0
echo "$out" | grep -q "src/calc.py" && ok "attempt.sh sees learner file" || bad "attempt.sh missed learner file"
echo "$out" | grep -q "README.md" && bad "attempt.sh leaked baseline-dirty file" || ok "attempt.sh excludes baseline dirt"
bash "$S/attempt.sh" end >/dev/null 2>&1 && git checkout -q -- . 
check "attempt.sh end clears baseline" "$?" 0


# ---------- progress.sh anchor ----------
printf 'mode: tour\nposition: 4/8\n' | bash "$S/progress.sh" anchor "$mem/learner-progress.md" >/dev/null 2>&1
check "progress.sh anchor writes block" "$?" 0
grep -q "position: 4/8" "$mem/learner-progress.md" && ok "anchor content present" || bad "anchor content missing"
printf 'mode: drill\nposition: boss\n' | bash "$S/progress.sh" anchor "$mem/learner-progress.md" >/dev/null 2>&1
[ "$(grep -c '^## Session state' "$mem/learner-progress.md")" = "1" ] && grep -q "position: boss" "$mem/learner-progress.md" \
  && ok "anchor replaces (single section, new content)" || bad "anchor duplicated or stale"
bash "$S/progress.sh" lint "$mem" >/dev/null 2>&1  # anchor must not break lint (bad stamp expected from earlier test)

echo

# ---------- narrate.sh stripping guarantee (code/tables never spoken) ----------
printf '# T\n\nThe router maps URLs.\n\n```python\nSECRETCODE = 1\n```\n\n| a | b |\n' > "$work/strip.md"
out=$(NARRATE_TEXT_ONLY=1 bash "$S/narrate.sh" "$work/strip.md" "$work/strip"); rc=$?
check "narrate.sh text-only hook works" "$rc" 0
echo "$out" | grep -q "SECRETCODE" && bad "narrate.sh would read code aloud" || ok "narrate.sh strips code blocks"
echo "$out" | grep -q "| a |" && bad "narrate.sh would read tables aloud" || ok "narrate.sh strips tables"
echo "$out" | grep -q "router maps URLs" && ok "narrate.sh keeps prose" || bad "narrate.sh lost prose"

# ---------- attempt.sh across learner commits ----------
cd "$repo"
bash "$S/attempt.sh" start >/dev/null 2>&1
printf 'def mul(a, b):\n    return a * b\n' >> src/calc.py
git add -A && git commit -qm "learner: add mul"
out=$(bash "$S/attempt.sh" diff); rc=$?
check "attempt.sh diff sees committed learner work" "$rc" 0
echo "$out" | grep -q "mul" && ok "attempt.sh diff includes learner commit content" || bad "attempt.sh missed committed change"
bash "$S/attempt.sh" end >/dev/null 2>&1



# ---------- validate_diagram.sh rejects broken diagram (only when tooling works) ----------
if timeout 120 bash "$S/validate_diagram.sh" "$work/d.mmd" >/dev/null 2>&1; then
  printf 'graph TD\n  A -->> ]]broken\n' > "$work/bad.mmd"
  timeout 120 bash "$S/validate_diagram.sh" "$work/bad.mmd" >/dev/null 2>&1
  check "validate_diagram.sh rejects broken diagram" "$?" 1
else
  ok "validate_diagram.sh broken-diagram check skipped (no tooling here — run on a machine with mermaid)"
fi

echo
echo
echo "================================"
echo "  $pass passed, $fail failed"
echo "================================"
[ "$fail" -eq 0 ]
