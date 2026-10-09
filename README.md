# 2Steaks skills

Skills and mods for Claude Code.

| Name | Kind | What it does |
| --- | --- | --- |
| [learning-guardrails](skills/learning-guardrails) | skill | Opt-in: call it with `/learning-guardrails` and it triages every code change, holding risky or new work until you show you understand it. |
| [learning-gate](plugins/learning-gate) | mod | Enforces learning-guardrails: keeps it opt-in, refuses code edits while a checkpoint is open and pins the open question above the prompt. |

They're built to go together: the skill decides when to stop, the mod makes sure nothing slips past.

## Install

In Claude Code, add this repo as a marketplace, then install what you want:

```
/plugin marketplace add 2Steaks/skills
/plugin install learning-guardrails@2steaks-skills
/plugin install learning-gate@2steaks-skills
```

Just the skill, for any agent that reads `skills/`:

```
npx skills add 2Steaks/skills
```

Or copy `skills/learning-guardrails` into `~/.claude/skills/`.

The skill's scripts need Node 18 or newer.

## Layout

```
.claude-plugin/marketplace.json   marketplace listing; plugin names here are what people install by
skills/<name>/SKILL.md            one folder per skill
plugins/<name>/                   one folder per mod or plugin
```

Renaming an entry in `marketplace.json` breaks updates for anyone who already installed it, so treat the names as fixed.

## Develop

```
claude plugin validate .
claude plugin validate plugins/learning-gate
```
