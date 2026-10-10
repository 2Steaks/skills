# Rule packs

The deterministic floor for triage: candidate risk categories from the paths and lines a change touches. Claude's engagement judgement decides. These are what `bench.mjs` tests and what `analyse.mjs --git` checks commits against.

One pack per stack, and every pack loads in every project.

```json
{
  "pack": "python",
  "files": ["\\.py$"],
  "categories": {
    "security": { "paths": [], "diff": ["\\bsubprocess\\b"], "diffExact": [] }
  }
}
```

- `files`: which changed files the `diff` patterns read. Leave it out to read every file, as `core` does.
- `paths`: matched against every changed file, whatever `files` says, so `requirements.txt` can count for Python.
- `diff` is case-insensitive. `diffExact` is case-sensitive.
- Categories: `data`, `concurrency`, `security`, `performance`, `state`, `contracts`.
- `ignore` (in `core`): files that never count, such as prose, lock files and vendored code.
- Comment lines don't count, unless a layer sets `"go": {"commentOnly": false}`.

## Layers

On top of the packs: `~/.learning/rules.json` (yours, every project), then `.learning/rules.json` (this project only).

```json
{
  "version": 2,
  "categories": { "security": { "diff": ["\\binternal_auth\\("] } },
  "remove": { "concurrency": { "diff": ["\\bpoll(ing)?\\b"] } }
}
```

`remove` takes exact pattern strings, `ignore` included. A rules file without `"version": 2` is an old full copy: it replaces everything below it.

## Adding a stack

1. A new pack here.
2. Its cases in `../benchmarks/<pack>.jsonl`: one per category it covers, plus GO cases for its lookalikes.
3. `node scripts/bench.mjs`.
