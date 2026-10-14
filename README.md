# 2Steaks skills

Skills and mods for Claude Code.

| Name | Kind | What it does |
| --- | --- | --- |
| [Learning guardrails](#learning-guardrails) | skill + mod | Quick multiple-choice checks that you understand risky or new code. |
| [Team deliberation](#team-deliberation) | skill | Puts an idea or decision in front of a panel of independent specialist subagents. |
| [Build to learn](#build-to-learn) | skill | Learn a new stack by building a project of your own, with Claude as coach. |
| [Codebase tutor](#codebase-tutor) | skill | Learn an unfamiliar repo in terms of the stack you already know. |

In Claude Code, add this repo as a marketplace once:

```
/plugin marketplace add 2Steaks/skills
```

## Learning guardrails

| Name | Kind | What it does |
| --- | --- | --- |
| [learning-guardrails](skills/learning-guardrails) | skill | Opt-in: call it with `/learning-guardrails` and it triages every code change, asking a quick multiple-choice question about anything risky or new. Only high-risk changes wait for your answer. |
| [learning-gate](plugins/learning-gate) | mod | Enforces learning-guardrails: keeps it opt-in, refuses code edits while a high-risk checkpoint is open and pins the open question above the prompt. |

They're built to go together: the skill decides when to stop, the mod makes sure nothing slips past.

It checks the design as well as the code: a decision later code will build on (a new datastore, a framework, the first global store) gets its own checkpoint before step 1. Pick differently, with a sound reason, and the plan changes.

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

## Build to learn

[build-to-learn](skills/build-to-learn) teaches a new language, framework or stack through a real project you choose. You write every line; Claude coaches. It asks what you already know, what you want to build with and what you want to build. Then it shapes an MVP into milestones tagged with the concepts each one teaches, and writes a guide from your home stack to the new one that grows as you build.

Along the way you get attempt-first diff reviews, spaced-review quizzes, an evidence-based concept map and break-and-fix challenges. Progress is saved in `.build-coach/` for the project and `~/.build-coach/` for you, so the next session picks up where you left off.

```
/plugin install build-to-learn@2steaks-skills
```

The scripts need bash and git. Audio and diagrams use a local text-to-speech engine and mermaid-cli when they're installed, and fall back to text when they aren't.

## Codebase tutor

[codebase-tutor](skills/codebase-tutor) teaches an unfamiliar repo in terms of the stack you already know. It has five modes: a guided tour (the stack, a repo map, one flow traced end to end, and architectural decisions with evidence kept apart from guesses), a coached build where you write the code, spaced-review quizzes, Feynman mode where you explain it back, and debugging drills with a bug planted on a scratch branch.

Ask it to "teach me this repo" or "quiz me". Progress is saved in `.codebase-tutor/`, so the next session picks up where you left off.

```
/plugin install codebase-tutor@2steaks-skills
```

The scripts need bash and git. Audio and diagrams use a local text-to-speech engine and mermaid-cli when they're installed, and fall back to text when they aren't.

## Without the plugin system

For any agent that reads `skills/`, pick the skills you want:

```
npx skills add 2Steaks/skills --skill learning-guardrails
npx skills add 2Steaks/skills --skill team-deliberation
npx skills add 2Steaks/skills --skill build-to-learn
npx skills add 2Steaks/skills --skill codebase-tutor
```

Or copy a folder from `skills/` into `~/.claude/skills/`. The learning-gate mod needs the plugin system.

## Develop

```
claude plugin validate .
claude plugin validate plugins/learning-gate
```
