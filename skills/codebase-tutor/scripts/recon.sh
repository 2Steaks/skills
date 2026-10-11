#!/usr/bin/env bash
# recon.sh [repo-root]
# Fast, deterministic repo recon: emits the structured facts the tutor needs
# (tree, manifests, entry points, docs/ADRs, lint & CI config, size, git hotspots)
# in one pass, so the LLM spends its effort teaching, not rediscovering.
set -uo pipefail

root="${1:-.}"
cd "$root" || { echo "FAIL: cannot cd to $root" >&2; exit 1; }

EXCLUDES='node_modules|\.git|vendor|venv|\.venv|dist|build|target|__pycache__|\.next|\.tox|coverage'

section() { printf '\n== %s ==\n' "$1"; }

echo "REPO RECON: $(pwd)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "git: branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) commit=$(git rev-parse --short HEAD 2>/dev/null)"
else
  echo "git: not a git repository (hotspots unavailable)"
fi

section "TREE (depth 2, vendored dirs excluded)"
find . -maxdepth 2 \( -type d -o -type f \) 2>/dev/null \
  | grep -Ev "/($EXCLUDES)(/|$)" | grep -v '^\.$' | sort | head -100

section "DEPENDENCY MANIFESTS"
for f in pyproject.toml setup.py requirements.txt requirements/*.txt package.json go.mod Cargo.toml pom.xml build.gradle build.gradle.kts Gemfile composer.json mix.exs; do
  ls $f >/dev/null 2>&1 && echo "found: $f"
done

section "ENTRY POINTS & RUNTIME"
for f in main.py app.py manage.py wsgi.py asgi.py src/main.py src/index.ts src/index.js src/main.ts index.js server.js cmd Dockerfile docker-compose.yml docker-compose.yaml compose.yaml Makefile Procfile; do
  [ -e "$f" ] && echo "found: $f"
done
[ -f package.json ] && command -v python3 >/dev/null 2>&1 && \
  python3 -c "import json;d=json.load(open('package.json'));s=d.get('scripts',{});print('package.json scripts: '+', '.join(list(s)[:12]))" 2>/dev/null

section "DOCS & DECISION RECORDS"
for f in README.md README.rst README CONTRIBUTING.md ARCHITECTURE.md docs doc adr docs/adr docs/decisions decisions; do
  [ -e "$f" ] && echo "found: $f"
done

section "LINT / FORMAT / CI CONFIG"
for f in .eslintrc .eslintrc.js .eslintrc.json eslint.config.js .prettierrc .flake8 ruff.toml .ruff.toml setup.cfg tox.ini .golangci.yml .golangci.yaml rustfmt.toml .rubocop.yml .pre-commit-config.yaml .editorconfig .github/workflows .gitlab-ci.yml Jenkinsfile .circleci; do
  [ -e "$f" ] && echo "found: $f"
done
[ -f pyproject.toml ] && grep -Eq '^\[tool\.(ruff|black|mypy|pytest|isort)' pyproject.toml 2>/dev/null && \
  echo "pyproject.toml tools: $(grep -Eo '^\[tool\.[a-z]+' pyproject.toml | sed 's/\[tool\.//' | sort -u | tr '\n' ' ')"

section "SIZE (lines per top-level dir, rough)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # git ls-files is indexed and respects .gitignore — near-instant even on monorepos
  for d in $(git ls-files | awk -F/ 'NF>1{print $1}' | sort -u); do
    echo "$d" | grep -Eq "^($EXCLUDES)$" && continue
    n=$(git ls-files "$d" \
        | grep -E '\.(py|js|ts|tsx|jsx|go|rs|rb|java|kt|c|cpp|cs)$' \
        | tr '\n' '\0' | xargs -0 -r cat 2>/dev/null | wc -l | tr -d ' ')
    [ -n "${n:-}" ] && [ "$n" != "0" ] && printf '%8s  %s\n' "$n" "$d"
  done | sort -rn
else
  for d in */; do
    d="${d%/}"
    echo "$d" | grep -Eq "^($EXCLUDES)$" && continue
    n=$(find "$d" -type f \( -name '*.py' -o -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.go' -o -name '*.rs' -o -name '*.rb' -o -name '*.java' -o -name '*.kt' -o -name '*.c' -o -name '*.cpp' -o -name '*.cs' \) 2>/dev/null \
        | grep -Ev "/($EXCLUDES)/" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    [ -n "${n:-}" ] && [ "$n" != "0" ] && printf '%8s  %s\n' "$n" "$d"
  done | sort -rn
fi

section "TEST COMMAND (best guess — verify before running mid-drill)"
found_test=0
[ -f Makefile ] && grep -qE '^test:' Makefile && { echo "  make test"; found_test=1; }
[ -f package.json ] && grep -q '"test"' package.json && { echo "  npm test"; found_test=1; }
# pytest config anywhere, or a tests/ dir in a Python project
if [ -f pytest.ini ] || grep -q '\[tool:pytest\]' setup.cfg 2>/dev/null || grep -q '\[tool.pytest' pyproject.toml 2>/dev/null \
   || { [ -d tests ] && { [ -f pyproject.toml ] || [ -f requirements.txt ]; }; }; then
  echo "  pytest"; found_test=1
fi
[ -f tox.ini ] && { echo "  tox"; found_test=1; }
[ -f go.mod ] && { echo "  go test ./..."; found_test=1; }
[ -f Cargo.toml ] && { echo "  cargo test"; found_test=1; }
[ -f Gemfile ] && [ -d spec ] && { echo "  bundle exec rspec"; found_test=1; }
[ "$found_test" = 0 ] && echo "  (unknown — check CI config or ask the learner)"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  section "GIT HOTSPOTS (most-changed files, last 400 commits — teach these first)"
  git log -400 --name-only --pretty=format: 2>/dev/null \
    | grep -Ev "^$|/($EXCLUDES)/|^($EXCLUDES)/" \
    | sort | uniq -c | sort -rn | head -15

  section "RECENT ACTIVITY"
  echo "last commit: $(git log -1 --format='%h %ad %s' --date=short 2>/dev/null)"
  echo "commits last 90 days: $(git log --since='90 days ago' --oneline 2>/dev/null | wc -l | tr -d ' ')"
  echo "top authors: $(git shortlog -sn HEAD 2>/dev/null | head -3 | awk '{$1=""; printf "%s,",$0}' | sed 's/^ //; s/,$//')"
fi

echo
echo "RECON COMPLETE"
