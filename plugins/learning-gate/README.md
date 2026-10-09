# learning-gate

A Claude Code mod that enforces the **learning-guardrails** skill. The skill decides when you need to show you understand something. This mod makes sure nothing slips past while you do.

**Opt-in.** The skill runs only when you call it: `/learning-guardrails`, or naming it in your message. The mod refuses any attempt by Claude to load it unasked, and stays dormant until you do.

While a checkpoint is open (`.learning/gate.lock` exists in the project):

- **Code edits are refused**, with the open question as the reason. Edits to the `.learning/` record still go through.
- **The question is pinned above the prompt** until it's answered. It follows the question when Claude shrinks it.
- **Every prompt carries the question to Claude**, so it survives long sessions and summarised context.

It also:

- **Keeps the skill opt-in**: a standing rule tells Claude never to load it on its own, and the mod refuses any load your latest message didn't ask for.
- **Opens the gate itself** when Claude ends a reply on a `👉 Your move:` question without one. It never overwrites a lock Claude wrote.
- **Keeps `.learning/` out of git** by adding it to the repo's local exclude list, never the team's `.gitignore`.
- **Logs the mechanical events** to `.learning/events.jsonl`, marked `"by":"mod"`: triage lines, gate open and close (with time open) and refused edits. The skill logs the judgement calls.
- **Shows status** in the status line: the open checkpoint, or the last `Guardrail · TIER` line.

## Commands

- `/learned`: what your record says you've demonstrated, are learning, and the gaps still open
- `/pickup`: a three-line recap of where you were, then the open question
- `/audit`: has Claude audit the guardrails against their own logs

## Install

```
/plugin marketplace add 2Steaks/skills
/plugin install learning-gate@2steaks-skills
```

Pair it with the skill: `/plugin install learning-guardrails@2steaks-skills`, then call it with `/learning-guardrails`.

## Good to know

- It fails open. If the mod itself breaks, edits go through rather than being blocked.
- It replaces the skill's `learning-gate.mjs` hook script, so you don't need both.
- Paths are handled POSIX-style (macOS and Linux).

## Develop

```
claude plugin validate .
claude plugin test .
```
