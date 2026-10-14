# learning-gate

Enforcement for the opt-in `learning-guardrails` skill.

- Claude can't load the skill unless you run `/learning-guardrails` or name it.
- While a GATE checkpoint (a high-risk change) is open, code edits are refused and the question is pinned above the prompt. A quick CHECK question never locks.
- A GATE question Claude forgot to lock, asked in the question dialog or as a `👉 Your move:` line, locks anyway.
- Each session is held only by its own checkpoint, so sessions in the same project never block each other.
- Checkpoints paused or left open in other sessions are counted in the band: `⏸ 2 unfinished checkpoints · /pickup to carry on`.
- `/pickup` loads the skill and, when there's more than one unfinished checkpoint, offers a menu. It recaps the one you pick and re-asks its question; the gate holds again from there.
- `/learned` shows what your record says you've demonstrated. `/audit` runs the skill's self-evaluation.

The record lives in `.learning/` and is kept out of git via `.git/info/exclude`.
