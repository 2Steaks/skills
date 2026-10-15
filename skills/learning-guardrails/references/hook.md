# The fallback gate: a Claude Code hook

Use this only when the learning-gate mod isn't on (SKILL.md §12) and the user said yes to the edit gate (§11). Never pin the skill on (no CLAUDE.md line): it's opt-in, loaded only when the user calls it.

## Install the edit gate

1. Install it:
   - `node {skill}/scripts/learning-gate.mjs --install` copies the script to `~/.claude/hooks/learning-gate.mjs`. It backs up `~/.claude/settings.json` to `settings.json.bak`, then registers a PreToolUse hook for Edit, MultiEdit, Write and NotebookEdit. Safe to run twice.
   - `node ~/.claude/hooks/learning-gate.mjs --test`. All PASS: tell the user in one line. If it doesn't kick in straight away, a Claude Code restart loads it. Any FAIL: say what failed and don't claim it's on.
2. `node {skill}/scripts/setup.mjs --gate hook`, or `--gate declined` if they said no.

## How it behaves

- While this session's lock (`.learning/locks/<session id>.lock`) exists, edits outside `.learning/` are refused, and the refusal carries the open question. Other sessions' locks never hold this one. No lock, no effect.
- It's a seatbelt against forgetting, not a vault: shell writes aren't covered, and the lock is yours to manage honestly through `lock.mjs`.
- It doesn't check triage the way the mod does. After building, `rules.mjs check` lists what the packs flag in the diff: compare it with your triage.
- It fails open (only exit code 2 blocks), so it can't lock the user out of their own repo. With the mod on as well, both refuse the same edits; nothing to undo.

## Removing it

Removing the hook is the user's call: `node ~/.claude/hooks/learning-gate.mjs --uninstall`. Never run it yourself, and never edit the hook out of settings. If they ask how, give the command.
