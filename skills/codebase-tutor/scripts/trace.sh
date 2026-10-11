#!/usr/bin/env bash
# trace.sh <file> [repo-root]
# Best-effort static import map for one file: what it pulls in (resolved to repo
# files where possible) and who pulls it in. Gives the end-to-end trace section a
# skeleton of real hops to narrate — the LLM confirms by reading, never trusts blindly.
# Supports Python and JS/TS well; other languages get a basic grep.
set -uo pipefail

file="${1:?usage: trace.sh <file> [repo-root]}"
cd "${2:-.}" || { echo "FAIL: cannot cd to ${2:-.}" >&2; exit 1; }
[ -f "$file" ] || { echo "FAIL: $file not found" >&2; exit 1; }

EXC='node_modules|\.git|vendor|venv|\.venv|dist|build|target|__pycache__'
ext="${file##*.}"

echo "== TRACE: $file =="

echo; echo "-- imports (what this file pulls in) --"
case "$ext" in
  py)
    here=$(dirname "$file")
    grep -nE '^\s*(from [A-Za-z0-9_.]+ import|import [A-Za-z0-9_.]+)' "$file" | head -25 | while IFS= read -r line; do
      mod=$(echo "$line" | sed -E 's/^[0-9]+:\s*//; s/^from ([A-Za-z0-9_.]+).*/\1/; s/^import ([A-Za-z0-9_.]+).*/\1/')
      hit=""
      if [ "${mod#.}" != "$mod" ]; then
        # relative import: resolve from this file's package; each extra leading dot climbs one level
        dots="${mod%%[!.]*}"; rest="${mod#"$dots"}"; base="$here"
        for _ in $(seq 2 "${#dots}"); do base=$(dirname "$base"); done
        if [ -n "$rest" ]; then
          rel="$base/$(echo "$rest" | tr '.' '/')"
          for cand in "$rel.py" "$rel/__init__.py"; do [ -f "$cand" ] && { hit="$cand"; break; }; done
        else
          [ -f "$base/__init__.py" ] && hit="$base/__init__.py"
        fi
        if [ -n "$hit" ]; then echo "  $line   -> $hit"; else echo "  $line   (relative, unresolved)"; fi
        continue
      fi
      # absolute import: the longest module path that exists wins (a.b.c.d, then a.b.c, ...)
      rel=$(echo "$mod" | tr '.' '/')
      while [ -z "$hit" ]; do
        for cand in "$rel.py" "$rel/__init__.py" "src/$rel.py" "src/$rel/__init__.py"; do
          [ -f "$cand" ] && { hit="$cand"; break; }
        done
        [ "$rel" = "${rel%/*}" ] && break
        rel="${rel%/*}"
      done
      if [ -n "$hit" ]; then echo "  $line   -> $hit"; else echo "  $line   (external/stdlib)"; fi
    done
    ;;
  js|jsx|ts|tsx|mjs|cjs)
    # multi-line imports end on a "} from '...'" line; re-exports count as imports too
    grep -nE "^\s*(import .* from ['\"]|import ['\"]|const .*= require\(['\"]|export .* from ['\"]|\}\s*from ['\"])" "$file" | head -25 | while IFS= read -r line; do
      spec=$(echo "$line" | grep -oE "['\"][^'\"]+['\"]" | head -1 | tr -d "'\"")
      line=$(echo "$line" | sed -E 's/^([0-9]+:)[[:space:]]*\}[[:space:]]*from/\1 import {…} from/')
      if echo "$spec" | grep -qE '^\.'; then
        base=$(dirname "$file")/"$spec"
        base=$(echo "$base" | sed 's|/\./|/|g')
        hit=""
        cands=("$base" "$base.ts" "$base.tsx" "$base.js" "$base.jsx" "$base.mjs" "$base.cjs" "$base/index.ts" "$base/index.tsx" "$base/index.js" "$base/index.jsx")
        # TypeScript ESM imports name the compiled file: './util.js' is util.ts on disk
        case "$base" in *.js|*.jsx|*.mjs|*.cjs) cands+=("${base%.*}.ts" "${base%.*}.tsx") ;; esac
        for cand in "${cands[@]}"; do
          [ -f "$cand" ] && { hit="$cand"; break; }
        done
        echo "  $line   -> ${hit:-unresolved local}"
      else
        echo "  $line   (package: $spec)"
      fi
    done
    ;;
  *)
    grep -nE '^\s*(import|#include|require|use) ' "$file" | head -25 | sed 's/^/  /'
    ;;
esac

echo; echo "-- importers (who pulls this file in) --"
name=$(basename "$file"); stem="${name%.*}"
case "$ext" in
  py)
    mod=$(echo "${file%.py}" | sed 's|/__init__$||' | tr '/' '.')
    grep -rnlE "(^|[[:space:]])(from|import)[[:space:]]+($mod|[A-Za-z0-9_.]*\.$stem|$stem)([[:space:]]|\.|$)" \
      --include='*.py' . 2>/dev/null | grep -Ev "/($EXC)/" | grep -v "^\./$file$" | head -15 | sed 's/^/  /'
    ;;
  js|jsx|ts|tsx|mjs|cjs)
    grep -rnl --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' \
      -E "from ['\"][^'\"]*/$stem(\.[a-z]+)?['\"]|require\(['\"][^'\"]*/$stem" . 2>/dev/null \
      | grep -Ev "/($EXC)/" | head -15 | sed 's/^/  /'
    ;;
  *)
    grep -rnl "$stem" . 2>/dev/null | grep -Ev "/($EXC)/" | grep -v "^\./$file$" | head -10 | sed 's/^/  /'
    ;;
esac

echo; echo "== END TRACE (static, best-effort — verify hops by reading) =="
