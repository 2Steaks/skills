# Translation-layer template

Read this before authoring `.build-coach/translation.md` for a new home→target pair. Follow the structure exactly. Replace every placeholder with pair-specific content; delete nothing structural.

Authoring rules:

- **Analogies must be honest.** Every mapping row gets a "where the analogy breaks" note, even if it's "—". A slightly-wrong analogy the learner trusts is worse than no analogy.
- **Traps must be pair-specific.** "Coming from [home], you'll expect X; [target] does Y instead" — ordered by how soon they'll bite in a real project. Generic beginner mistakes don't qualify.
- **Start short, grow live.** Cap the first version at the sizes below. Add traps and idioms as milestones surface them; correct any analogy the learner's confusion proves wrong. Date-stamp additions.
- **Name the signature question.** Every stack has a characteristic failure mode; write the one prediction question that probes it, and ask it at every milestone where it applies.

---

# [Home stack] → [Target stack]: the translation layer

*(one-paragraph framing: what transfers directly, what's genuinely new, and the single biggest mental-model shift)*

date: YYYY-MM-DD

## Toolchain mapping (milestone zero) — 6–12 rows

| [Home] world | [Target] world | Where the analogy breaks |
|---|---|---|
| package manager | ... | ... |
| lockfile | ... | ... |
| formatter / linter | ... | ... |
| type checking / compiler | ... | ... |
| test runner | ... | ... |
| run/watch loop | ... | ... |
| framework equivalent (if any) | ... | ... |
| env & secrets | ... | ... |

## Concept mapping (teach as encountered, not upfront) — 8–15 rows

| [Home] concept | [Target] equivalent | Watch out |
|---|---|---|
| ... | ... | ... |

## The traps (teach preemptively at the relevant milestone) — 5–10, ordered by how soon they bite

1. **[Trap name].** What the home habit expects; what the target actually does; the one-line fix or check. *(Plantable as a challenge bug? mark it ⚔)*
2. ...

## Signature prediction question

"[The one question that probes this stack's characteristic failure mode]" — ask it at every milestone where it applies.

## Idiom-pass priorities (one or two per milestone, in this order) — 5–10

1. [Highest-value idiom shift — usually the one that most changes how code *reads*]
2. ...

Rule for the pass: praise what's *correct* first, offer the idiom as "how a [target] developer would write it", show at most two per review, and connect each to the home habit it replaces. The goal is a [home] engineer who writes [target] — not one who writes [home] in [target] files.
