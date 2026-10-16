# Self-evaluation: the improvement loop

Read this before proposing any change to the guardrails. SKILL.md §10 says when to run the scripts; this says what to do with what they show.

## What the numbers are for

Optimise for learning, retained understanding, engineering independence and useful velocity, never checkpoint counts. A completed checkpoint doesn't prove mastery. A high override rate doesn't automatically mean the workflow is broken. Every number in the report is a prompt for review, not a verdict.

**Success over time**: fewer introductory lessons as knowledge grows; familiar concepts caught in genuinely new contexts; meaningful complexity caught more reliably; fewer unnecessary interruptions; GATE still enforceable where it matters; your own performance and limits increasingly visible.

## The scripts

- `scripts/analyse.mjs [--git <days>] [--write]` reads `.learning/events.jsonl` (the skill's events and the mod's, `"by":"mod"`) and the concept record. It reports:
  - triggers per tier and category
  - outcomes (declined CHECKs included), the override rate, checkpoints flagged unnecessary, and questions reworded because they assumed too much
  - unaided passes, evidence types, repeat teaching, concepts that keep exposing gaps, the skip-reflex trend
  - overhead: turns, checkpoints per task, and the mod's time-open and refused edits
  - `diff_review` mismatches, as missed risk or over-triage
  - the mod's tripwire: edits refused before any triage, edits the packs flagged that triage hadn't covered, and ratings below the packs, with their reasons
  - record drift: passes with no evidence line that day
  - with `--git`, commits that carry GATE signals on a day with no gate: possible misses for review
- `scripts/bench.mjs [--rules <file>] [--cases <file>] [--proposed <file>]` runs the benchmark cases against the triage rules, the record logic and the override policy. `--rules` and `--proposed` put one more file on top of the rules in force: a pack, a layer or an old full copy. With `--proposed` it lists every case that became **more permissive** (risk under-tiered, a needed check dropped) or **more intrusive** (GO over-tiered, a mastered concept retaught), and fails if any case's expectation breaks.

Both are deterministic: no network, randomness or AI. Subjective questions (does this checkpoint force reasoning?) get explicit criteria instead: its options carry their reasons and its wrong options are real misconceptions, it's tied to the real code and asks about the change being made, saying which version it means, it asks one question, it leans on nothing they'd have to already know about this codebase, and it can't be passed with a nod. Review against real examples, not another model's opinion alone.

## Rules and cases

- Defaults: one pack per stack in `assets/rules/` (format in `assets/rules/README.md`), cases in `assets/benchmarks/`. Every pack loads in every project: path patterns see every changed file, diff patterns only the pack's own file types. Comment lines and ignored files (prose, lock files, vendored and generated code) don't count.
- Tune in layers. `~/.learning/rules.json` is yours, for every project: tuning goes there by default. A project's `.learning/rules.json` is only for what's true of that codebase alone. A layer adds patterns and removes them by exact string: `{"version": 2, "categories": {…}, "remove": {…}}`. A file without `"version": 2` is an old full copy and replaces everything below it.
- Cases layer the same way: `~/.learning/benchmarks/cases.jsonl`, then the project's. A case with an id already seen replaces it.
- A new stack is a new pack plus its cases: one per category it covers, and GO cases for its lookalikes. `bench.mjs --proposed <pack>` shows what it changes.
- Rules give the deterministic floor: candidate categories from paths and changed lines, and comment-only diffs as GO. Your engagement judgement stays separate, and is logged when it lowers a tier.
- Cases are synthetic only: tiny made-up diffs, never real source. Seed at least two per kind (trivial, familiar same context, familiar variation, unfamiliar low-risk, high-risk per category, unexpected complexity, override) whenever the rules gain a category.
- Expected values in cases are core rules. Changing them needs the user's yes, like any rule change.

## The loop

1. **Observe**: minimal events, via `log.mjs` and the mod.
2. **Analyse**: `analyse.mjs --git 30 --write`, then `bench.mjs`.
3. **Propose**: one specific change to detection rules, checkpoint selection, the record model or enforcement, written to `.learning/proposals/<date>-<slug>.md`.
4. **Test**: `bench.mjs --proposed <file>`: current vs proposed.
5. **Review**: show the user the change, the evidence, the benchmark diff, the trade-offs and how to revert it, in ≤10 lines.
6. **Apply**: only on an explicit yes. Keep it reversible: log old → new in a `rules-changelog.md` beside the layer you changed, then rerun `setup.mjs` so the mod checks edits against the new rules. Changes to this skill itself go to the user as a proposed edit.
7. **Reassess**: the next report checks the targeted metric moved.

## Who may change what

- **Free to do unasked**: run the scripts, analyse, draft proposals.
- **Needs an explicit yes**: anything touching rules, tiers, the evidence bar, enforcement, benchmark expectations or this skill.
- **Never**: silently weaken a GATE, change your own enforcement boundaries, delete or rewrite mastery history (corrections are new lines), rewrite the core objective, or apply a proposal without that yes. Prefer small, evidence-backed changes to speculative self-modification.
