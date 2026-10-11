# 2Steaks skills

Skills and mods for Claude Code.

| Name | Kind | What it does |
| --- | --- | --- |
| [Learning guardrails](#learning-guardrails) | skill + mod | Holds risky or new code until you show you understand it. |
| [Team deliberation](#team-deliberation) | skill | Puts an idea or decision in front of a panel of independent specialist subagents. |

In Claude Code, add this repo as a marketplace once:

```
/plugin marketplace add 2Steaks/skills
```

## Learning guardrails

| Name | Kind | What it does |
| --- | --- | --- |
| [learning-guardrails](skills/learning-guardrails) | skill | Opt-in: call it with `/learning-guardrails` and it triages every code change, holding risky or new work until you show you understand it. |
| [learning-gate](plugins/learning-gate) | mod | Enforces learning-guardrails: keeps it opt-in, refuses code edits while a checkpoint is open and pins the open question above the prompt. |

They're built to go together: the skill decides when to stop, the mod makes sure nothing slips past.

The skill's risk signals cover JS/TS (React, Vue, Svelte, Angular, Node), Python, Go, Ruby, Java/Kotlin, C#, PHP, Rust, Swift and infra (Terraform, Kubernetes, Docker, CI). Adding a stack is one file: see [the rule packs](skills/learning-guardrails/assets/rules).

```
/plugin install learning-guardrails@2steaks-skills
/plugin install learning-gate@2steaks-skills
```

The skill's scripts need Node 18 or newer.

## Team deliberation

[team-deliberation](skills/team-deliberation) stress-tests an idea, proposal or decision. Specialist subagents (engineering, product, UX, customer, legal and more) analyse it blind, cross-examine each other and check disputed facts with tools. A separate synthesizer then writes up agreement, dissent, experiments and kill conditions. It never votes or forces a consensus.

Ask for "team deliberation", "poke holes in this" or "should we build X". A small question gets a direct answer instead of a panel. Each run is saved in `deliberations/<slug>/`, so you can resume it later.

```
/plugin install team-deliberation@2steaks-skills
```

## Without the plugin system

For any agent that reads `skills/`, pick the skills you want:

```
npx skills add 2Steaks/skills --skill learning-guardrails
npx skills add 2Steaks/skills --skill team-deliberation
```

Or copy a folder from `skills/` into `~/.claude/skills/`. The learning-gate mod needs the plugin system.

## Develop

```
claude plugin validate .
claude plugin validate plugins/learning-gate
```
