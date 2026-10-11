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

# ---------- recon.sh ----------
out=$(timeout 60 bash "$S/recon.sh" "$repo" 2>&1); rc=$?
check "recon.sh completes (no shortlog hang)" "$rc" 0
echo "$out" | grep -q "GIT HOTSPOTS"    && ok "recon.sh reports hotspots"    || bad "recon.sh missing hotspots"
echo "$out" | grep -q "RECON COMPLETE"  && ok "recon.sh reaches the end"     || bad "recon.sh truncated"
echo "$out" | grep -q "requirements.txt" && ok "recon.sh finds manifests"    || bad "recon.sh missed manifest"

# ---------- archaeology.sh ----------
out=$(timeout 30 bash "$S/archaeology.sh" src/calc.py "$repo" 2>&1); rc=$?
check "archaeology.sh completes" "$rc" 0
echo "$out" | grep -q "^born:"          && ok "archaeology.sh finds birth commit"   || bad "archaeology.sh missing birth"
echo "$out" | grep -q "refactor: add sub" && ok "archaeology.sh sees notable message" || bad "archaeology.sh missed notable message"

# ---------- trace.sh ----------
out=$(timeout 30 bash "$S/trace.sh" main.py "$repo" 2>&1); rc=$?
check "trace.sh completes" "$rc" 0
echo "$out" | grep -q -- "-> src/calc.py" && ok "trace.sh resolves local import" || bad "trace.sh failed to resolve import"
out=$(timeout 30 bash "$S/trace.sh" src/calc.py "$repo" 2>&1)
echo "$out" | grep -q "main.py"          && ok "trace.sh finds importers"       || bad "trace.sh missed importer"

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

# ---------- drill.sh --force also discards new files and edits the bug didn't touch ----------
orig=$(git rev-parse --abbrev-ref HEAD)
timeout 30 bash "$S/drill.sh" plant --patch "$work/bug.patch" >/dev/null 2>&1
echo "learner notes" > scratch.txt; echo "learner edit" >> README.md
timeout 30 bash "$S/drill.sh" cleanup --force >/dev/null 2>&1
check "drill.sh --force cleanup with new files and other edits" "$?" 0
[ "$(git rev-parse --abbrev-ref HEAD)" = "$orig" ] && [ -z "$(git status --porcelain)" ] && [ ! -e scratch.txt ] \
  && ok "drill.sh --force leaves the original branch clean" || bad "drill.sh --force left drill work behind"

# ---------- progress.sh ----------
d=$(bash "$S/progress.sh" next 3d); rc=$?
check "progress.sh next" "$rc" 0
echo "$d" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && ok "progress.sh next prints ISO date" || bad "progress.sh next bad date: $d"
bash "$S/progress.sh" promote 7d  | grep -q '^21d' && ok "progress.sh promote climbs ladder" || bad "progress.sh promote wrong"
bash "$S/progress.sh" promote 60d | grep -q '^60d' && ok "progress.sh promote caps at 60d"   || bad "progress.sh cap wrong"
bash "$S/progress.sh" demote      | grep -q '^1d'  && ok "progress.sh demote returns 1d"     || bad "progress.sh demote wrong"
bash "$S/progress.sh" promote 5d >/dev/null 2>&1
check "progress.sh promote refuses an interval off the ladder" "$?" 1

mem="$work/mem"; mkdir -p "$mem"
printf '# Codebase map\ncommit: abc123f\ndate: 2026-01-01\n' > "$mem/repo-map.md"
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
sed -i.bak 's/^commit: abc123f$/commit: nope/' "$mem/repo-map.md" 2>/dev/null || sed -i '' 's/^commit: abc123f$/commit: nope/' "$mem/repo-map.md"
bash "$S/progress.sh" lint "$mem" >/dev/null 2>&1
check "progress.sh lint catches bad commit stamp" "$?" 1
bash "$S/progress.sh" lint "$work/nonexistent" >/dev/null 2>&1
check "progress.sh lint exit 2 when no memory dir" "$?" 2

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

# ---------- drift.sh ----------
mem2="$work/mem2"; mkdir -p "$mem2"
first=$(cd "$repo" && git rev-list --max-parents=0 HEAD)
printf '# Codebase map\ncommit: %s\ndate: 2026-01-01\n' "$first" > "$mem2/repo-map.md"
out=$(cd "$repo" && bash "$S/drift.sh" "$mem2" "$repo"); rc=$?
check "drift.sh compares against old stamp" "$rc" 0
echo "$out" | grep -q "STALE" && ok "drift.sh flags stale areas" || bad "drift.sh missed drift"
printf '# Codebase map\ncommit: %s\ndate: 2026-01-01\n' "$(cd "$repo" && git rev-parse HEAD)" > "$mem2/repo-map.md"
out=$(cd "$repo" && bash "$S/drift.sh" "$mem2" "$repo")
echo "$out" | grep -q "FRESH" && ok "drift.sh reports fresh at HEAD stamp" || bad "drift.sh false stale"
printf '# Codebase map\ncommit: deadbeefdeadbeef\ndate: 2026-01-01\n' > "$mem2/repo-map.md"
(cd "$repo" && bash "$S/drift.sh" "$mem2" "$repo") >/dev/null 2>&1
check "drift.sh exit 2 on unknown stamp" "$?" 2

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

# ---------- recon.sh TEST COMMAND ----------
printf 'test:\n\ttrue\n' > "$repo/Makefile"
out=$(timeout 60 bash "$S/recon.sh" "$repo" 2>&1)
echo "$out" | grep -q "make test" && ok "recon.sh detects make test" || bad "recon.sh missed test command"
pyrepo="$work/pyrepo"; mkdir -p "$pyrepo" && printf '[pytest]\n' > "$pyrepo/pytest.ini"
out=$(timeout 60 bash "$S/recon.sh" "$pyrepo" 2>&1)
echo "$out" | grep -q "^  pytest$" && ok "recon.sh detects pytest from pytest.ini alone" || bad "recon.sh missed pytest.ini"
nogit="$work/nogit"; mkdir -p "$nogit" && printf 'test:\n\ttrue\n' > "$nogit/Makefile"
out=$(timeout 60 bash "$S/recon.sh" "$nogit" 2>&1)
echo "$out" | grep -q "make test" && ok "recon.sh guesses a test command outside git too" || bad "recon.sh skipped the test command outside git"

# ---------- progress.sh anchor ----------
printf 'mode: tour\nposition: 4/8\n' | bash "$S/progress.sh" anchor "$mem/learner-progress.md" >/dev/null 2>&1
check "progress.sh anchor writes block" "$?" 0
grep -q "position: 4/8" "$mem/learner-progress.md" && ok "anchor content present" || bad "anchor content missing"
printf 'mode: drill\nposition: debrief\n' | bash "$S/progress.sh" anchor "$mem/learner-progress.md" >/dev/null 2>&1
[ "$(grep -c '^## Session state' "$mem/learner-progress.md")" = "1" ] && grep -q "position: debrief" "$mem/learner-progress.md" \
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

# ---------- drift.sh uncommitted drift ----------
printf '# Codebase map\ncommit: %s\ndate: 2026-01-01\n' "$(cd "$repo" && git rev-parse HEAD)" > "$mem2/repo-map.md"
echo "uncommitted drift" >> "$repo/src/calc.py"
out=$(cd "$repo" && bash "$S/drift.sh" "$mem2" "$repo")
echo "$out" | grep -q "STALE" && ok "drift.sh counts uncommitted work as drift" || bad "drift.sh blind to worktree changes"
(cd "$repo" && git checkout -q -- .)

# ---------- drift.sh: the tutor's own memory folder isn't drift ----------
dr="$work/drift-repo"; mkdir -p "$dr" && cd "$dr"
git init -q && git config user.email test@test && git config user.name Tester
echo x > a.txt && git add -A && git commit -qm init
mkdir -p .codebase-tutor && printf '# Codebase map\ncommit: %s\ndate: 2026-01-01\n' "$(git rev-parse HEAD)" > .codebase-tutor/repo-map.md
out=$(bash "$S/drift.sh" .codebase-tutor/)
echo "$out" | grep -q "FRESH" && ok "drift.sh ignores its own memory folder" || bad "drift.sh counted .codebase-tutor/ as drift"
echo y >> a.txt
out=$(bash "$S/drift.sh" .codebase-tutor/)
echo "$out" | grep -q "STALE  (root)" && ok "drift.sh still flags real changes beside it" || bad "drift.sh missed a real change"
cd "$repo"

# ---------- trace.sh JS path ----------
mkdir -p "$repo/web" && printf 'export const helper = () => 1;\n' > "$repo/web/util.js"
printf "import { helper } from './util';\nconsole.log(helper());\n" > "$repo/web/app.js"
out=$(timeout 30 bash "$S/trace.sh" web/app.js "$repo")
echo "$out" | grep -q -- "web/util.js" && ok "trace.sh resolves JS relative import" || bad "trace.sh missed JS import"

# ---------- trace.sh: Python relative and deep imports ----------
tp="$work/tracepy"; mkdir -p "$tp/app/api/v1" "$tp/app/services"
touch "$tp/app/__init__.py" "$tp/app/api/__init__.py" "$tp/app/api/v1/__init__.py"
printf 'def run(): pass\n' > "$tp/app/services/__init__.py"; printf 'r = 1\n' > "$tp/app/api/v1/routes.py"
printf 'from .services import run\nfrom app.api.v1.routes import r\n' > "$tp/app/main.py"
out=$(timeout 30 bash "$S/trace.sh" app/main.py "$tp")
echo "$out" | grep -q -- "-> app/services/__init__.py" && ok "trace.sh resolves Python relative imports" || bad "trace.sh called a relative import external"
echo "$out" | grep -q -- "-> app/api/v1/routes.py" && ok "trace.sh resolves 4-level Python imports to the module" || bad "trace.sh stopped at the package"

# ---------- trace.sh: multi-line TS imports, index.tsx, .js naming a .ts file ----------
tt="$work/tracets"; mkdir -p "$tt/src/components/Button"
printf 'export const Button = () => null;\n' > "$tt/src/components/Button/index.tsx"
printf 'export const a = 1;\nexport const b = 2;\n' > "$tt/src/util.ts"; printf 'export const c = 3;\n' > "$tt/src/esm.ts"
printf "import {\n  a,\n  b,\n} from './util';\nimport { Button } from './components/Button';\nimport { c } from './esm.js';\n" > "$tt/src/App.tsx"
out=$(timeout 30 bash "$S/trace.sh" src/App.tsx "$tt")
echo "$out" | grep -q -- "-> src/util.ts" && ok "trace.sh sees multi-line imports" || bad "trace.sh missed a multi-line import"
echo "$out" | grep -q -- "-> src/components/Button/index.tsx" && ok "trace.sh resolves a folder's index.tsx" || bad "trace.sh missed index.tsx"
echo "$out" | grep -q -- "-> src/esm.ts" && ok "trace.sh maps './esm.js' to esm.ts" || bad "trace.sh missed the .js-named .ts file"

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
