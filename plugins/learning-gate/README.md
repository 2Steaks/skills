# learning-gate

Enforcement for the opt-in `learning-guardrails` skill.

- Claude can't load the skill unless you run `/learning-guardrails` or name it.
- While a checkpoint is open, code edits are refused and the question is pinned above the prompt.
- A checkpoint left open when you close Claude Code is **parked**: nothing is blocked, the band says `⏸ Paused checkpoint · /pickup to carry on`.
- `/pickup` loads the skill, recaps where you were and re-asks the question. The gate holds again from there.
- `/learned` shows what your record says you've demonstrated. `/audit` runs the skill's self-evaluation.

The record lives in `.learning/` and is kept out of git via `.git/info/exclude`.
