# learning-gate

Enforcement for the opt-in `learning-guardrails` skill.

- Claude can't load the skill unless you run `/learning-guardrails` or name it.
- While a GATE checkpoint (a high-risk change) is open, code edits are refused and the question is pinned above the prompt. A quick CHECK question never locks.
- A GATE question Claude forgot to lock, asked in the question dialog or as a `👉 Your move:` line, locks anyway.
- A checkpoint left open when you close Claude Code is **parked**: nothing is blocked, the band says `⏸ Paused checkpoint · /pickup to carry on`.
- `/pickup` loads the skill, recaps where you were and re-asks the question. The gate holds again from there.
- `/learned` shows what your record says you've demonstrated. `/audit` runs the skill's self-evaluation.

The record lives in `.learning/` and is kept out of git via `.git/info/exclude`.
