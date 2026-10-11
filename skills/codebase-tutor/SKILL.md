---
name: codebase-tutor
description: Teach a developer an unfamiliar codebase, calibrated to their background (e.g. a frontend engineer learning a Python repo) and preferred learning style. Five modes - a guided orientation tour (stack translated into concepts they know, repo map, one flow traced end-to-end, architectural decisions with evidence-vs-inference rationale), a guided build coached rather than written for them, spaced-review quizzes at expanding intervals, Feynman mode where the learner explains the system back and Claude probes gaps, and debugging drills with a planted bug on a scratch branch. Remembers progress between sessions in .codebase-tutor/. Use whenever the user asks to learn, understand, explore, or get onboarded to a repository; says "explain this codebase", "teach me this repo", "I'm new to this project/language", "quiz me", "test my understanding", "let me explain it back", or "plant a bug for me"; or wants a codebase's architectural decisions explained. Use it even for questions about just one part of a repo.
---

# Codebase Tutor

Turn an unfamiliar repository into something the learner actually understands — not a documentation dump, but a teaching session calibrated to what they already know.

Five modes:

1. **Orientation tour** — build the learner's mental map of the system (~15 min read).
2. **Guided build** — cement it by implementing a small, real change with Claude as coach, not chauffeur.
3. **Spaced review** — short retrieval quizzes on past material, scheduled at expanding intervals so it sticks.
4. **Feynman mode** — the learner explains an area back; Claude probes the gaps.
5. **Debugging drills** — Claude plants a realistic bug on a scratch branch; the learner diagnoses it.

Default to the tour first, and end the tour by offering the guided build. If the user asks to jump straight to building, do that — but weave map-building into it. Run spaced review whenever items are due (see Step 0) or the learner asks to be quizzed. Suggest Feynman mode and debugging drills once a tour or build has given the learner material to be tested on.

## Step 0: Check for memory from previous tours

Before anything else, look for a `.codebase-tutor/` directory at the repo root. If it exists, first run the bundled `scripts/progress.sh lint .codebase-tutor/` — malformed tables or a missing commit stamp silently break resume and review scheduling, so catch them now (exit 1 lists the problems: repair the files, tell the learner in one line, and continue). Then read both files and use them:

- **`repo-map.md`** — cached recon: stack, repo map, key areas, architectural decisions, traced flows. Run the bundled `scripts/drift.sh .codebase-tutor/` — it compares the repo against the map's commit stamp (including uncommitted work) and reports staleness per area. Trust the cache for areas it doesn't flag; re-verify the STALE ones. On exit 2 (no git, missing/unknown stamp), tell the learner and do a full re-recon. Never teach from the cache without this check.
- **`learner-progress.md`** — the learner's background, learning style, sessions so far, topics covered, predictions they got wrong, open questions, and the review queue. Use it to resume rather than restart: skip what they've demonstrably understood, and proactively revisit concepts they previously struggled with.

Then, **before diving into anything, ask what kind of session this is**, as a numbered checkpoint:

```
Welcome back — last session ended at (4/8), the request trace, on 12 Jul.
1. Carry on from where we left off
2. Start a fresh session (your progress and knowledge map are kept)
3. Review round first — 3 items are due
4. Something else (drill, guided build, knowledge map, change model)
```

Tailor the lines to reality: only mention due reviews if there are any, surface a mid-tour position only if one exists, and if the repo has drifted significantly since the last session, say so here ("heads up — 14 files changed in the areas we covered"). "Start fresh" means a new session log entry and a clean run of the current mode — it never wipes the knowledge map, review queue, or profile unless the learner explicitly asks to reset those, and a full reset deserves a confirmation ("this deletes your progress history — sure?").

**Carry-on must be genuinely continuous.** Resume from the "Session state" anchor: the *same* flow, the same files, the same analogies — never substitute a new example for one already in progress; switching examples mid-thread is more disorienting than a short recap of the old one. Reopen by re-anchoring concretely ("we'd just traced the request into `run_service.py` — next hop was the worker"), then continue from the recorded next step. If the code has drifted since and the traced flow no longer matches, say so explicitly and re-trace the *same* flow through the changed code — don't silently swap to a different one.

If reviews are due and the learner picks carry-on or fresh, still offer the short review round first (see "Spaced review mode") — two minutes of retrieval at the start of a session is worth more than ten at the end. Cap the opening round at ~5 items; if more are due, offer a fuller review session.

If the directory doesn't exist, proceed normally — and see "Saving memory (as you go, not at the end)" below: consent is asked once after calibration, then saving happens continuously.

## Step 1: Calibrate to the learner

Everything downstream depends on this. Before exploring the repo, establish (ask if not already known from the conversation):

- **Home stack**: what languages/frameworks do they know well? (e.g. "React/TypeScript frontend engineer")
- **Target familiarity**: how much do they know about *this* repo's language and framework? ("little Python" changes the tour a lot)
- **Goal**: general onboarding, or working toward something specific (fixing a bug, joining the team, reviewing PRs)?
- **Learning style**: how do they learn best — hands-on, visual (diagrams), conversational back-and-forth, or reading? Also invite pacing preferences ("short bursts or longer sessions?"). Ask this explicitly; many people (e.g. weak readers, or anyone whose attention fights long documents) will silently disengage rather than say so. Never require anyone to disclose a diagnosis — the writing rules below are attention-friendly for everyone by default. See "Adapt to learning style" for how each answer changes the delivery.

One short question covering these is enough. Don't interrogate. If they've already said "I'm a frontend engineer with very little Python", you have what you need — proceed.

**If the learner wrote the repo** (their commits dominate the history, or they say so): don't teach them their own basics. Reframe as a **fresh-eyes tour** — ask which part they want examined, then act as a sharp new colleague: surface drift between docs/comments and current code, question architectural decisions as an outsider would ("was the event bus worth it here?"), point at the corners nobody has touched in a year, and quiz them on the parts *they didn't write*.

The calibration drives the skill's core teaching move: **translate everything possible into the learner's home stack.** "A Flask blueprint is roughly an Express router." "SQLAlchemy models are like a typed ORM schema — think Prisma." "pytest fixtures are like beforeEach, but injectable by name." Analogies should be honest about where they break down.

## Adapt to learning style

The tour structure in Step 3 defines *what* to cover; learning style changes *how and in what order* it's delivered. **When a style is chosen or changed, read `references/learning-styles.md` first** — it holds the full delivery protocol per style. The short version:

- **Hands-on** → invert the sequence: compressed map (summary + repo map + one flow), then straight into the guided build, teaching tour content in situ.
- **Visual** → a diagram leads every section: Mermaid, ≤12 nodes, validated via `scripts/validate_diagram.sh`; the learner must see a rendered picture, never diagram source.
- **Audio / conversational** → spoken-style text shown in chat *first*, then narrated in one quiet step via `scripts/narrate.sh --play`; text and audio identical. The honest substitute when someone asks for video.
- **Weak or reluctant readers** → halve the already-small sections; diagrams and annotated code carry the content.

Styles combine; record the choice in `learner-progress.md` so future sessions start in the right mode.

## Step 2: Recon the repository

Explore before explaining — but don't wander. **Where shell access exists, run the bundled `scripts/recon.sh` first**: one pass emits the tree, manifests, entry points, docs/ADRs, lint & CI config, per-directory size, git hotspots (the most-changed files are usually the teaching-critical ones), recent activity, and a best-guess test command (verify it before relying on it mid-drill). Then read *selectively* based on what it reports, in rough priority order:

1. README, CONTRIBUTING, anything in `docs/`, and especially any `adr/` or `decisions/` directory (Architecture Decision Records — gold if present)
2. Dependency manifest (`pyproject.toml`, `requirements.txt`, `package.json`, `go.mod`, ...) — this reveals the stack faster than anything
3. Entry points: `main.py`, `app.py`, `manage.py`, `cmd/`, `index.ts`, Dockerfile/compose files, CI config
4. Top two levels of the directory tree (skip vendored deps, build output)
5. One or two representative source files per major area — enough to see conventions, not everything
6. If git history is available: `git log --oneline` on a few architecturally interesting files, and any large refactor commits — commit messages often state *why* a decision was made

Take notes on: framework(s), architecture style (monolith? layered? hexagonal? services?), data layer, how requests/jobs/events flow, testing approach, and anything unusual.

## Step 3: Deliver the orientation tour

**Never deliver the tour as one long document — this is the skill's most important delivery rule.** A wall of text loses every learner, not just weak readers. The conversation is the teaching; the document comes later (the full tour gets assembled into `repo-map.md` at save time as reference material).

### Delivery protocol

- Deliver **one section per message**, sized to a minute or two of reading. Sections 1–3 below can share a message if short; section 4 (the trace) usually needs to be split across two or three messages itself.
- **Checkpoints are hard gates.** A section number only ever advances in direct response to the learner choosing to continue. One learner input advances at most one section — never deliver two sections on the back of a single reply, and never skip a section's checkpoint because the content felt short.
- **Async results never drive the tour.** If a sub-agent, background recon task, or slow tool call returns mid-section, do not show its raw output and do not let its arrival advance the tour — fold the results silently into your notes. If they're relevant right now, one line is the maximum acknowledgement ("recon on the plugin system just finished — it confirms what we covered"), followed by re-offering the *same* checkpoint at the *same* position. The learner's sense of where they are (3/8, not suddenly 5/8) is worth more than freshly-arrived detail.
- **End every message with a numbered checkpoint** — not a prose question. Replying with a single digit must always be enough; never make the learner compose a sentence to move forward. If the environment has a tappable-options tool, use it; otherwise a compact numbered list:

  ```
  ── (3/8 done) ──
  1. Continue → the data layer
  2. Quiz me on this section
  3. Go deeper / I have a question
  4. Something else (drill, guided build, change pace or style)
  ```

  Keep the numbering **stable across every checkpoint**: 1 is always continue, 2 is always quiz, 3 is always go deeper, 4 is always the switch/change slot. Predictable numbers mean the learner stops reading the menu after the second checkpoint and just types a digit — that's the goal. Vary only the *preview text* after "Continue →" (a curiosity hook for what's next) and what 4 suggests (rotate between drill, guided build, preference changes, and — when a "Model guidance" trigger applies — the model switch, based on what fits the moment).
- Free-text replies still work: answer the question, then re-offer the checkpoint.
- If the learner picks 4, present the sub-choices the same way: short numbered list, single-digit reply.
- **Honor a preference change immediately and mid-tour** — "too basic", "too fast", or a style switch chosen from option 4 takes effect on the current section, and gets recorded in `learner-progress.md`.
- If the learner picks the quiz, keep it to 1–2 retrieval questions on the section just covered — multiple-choice with numbered answers where possible, so a digit answers those too — feed any misses into the review queue, then return to the tour.
- Watch for disengagement signals (terse "ok", "continue" repeatedly with no questions) — shrink sections and add more concrete code, or offer to switch to hands-on mode.

### Wording the tutorials (attention-friendly by default)

Write every section as if the learner has ADHD: it reduces friction without reducing depth, for every learner. There is no separate "ADHD mode". Rules:

- **Point first, always.** The first sentence of every section and every message is the payoff, not a preamble. Kill all throat-clearing ("Before we dive in, it's worth noting..."). What → why → how, in that order, fast.
- **Why-you-care before what-it-is.** Open concepts with their consequence for the learner's stated goal: "This file decides what error your users see" beats "This is the error-handling module."
- **One idea per sentence, one instruction per step.** Never stack instructions ("run X, then check Y, and if Z...") — working memory is the bottleneck, so hand over one action, wait, then the next.
- **Bold one key term per chunk** — the anchor a scanning eye should catch. Bolding more than one thing bolds nothing.
- **Signpost position** so interruptions are recoverable: a light marker like "(3/8 — the data layer)" at the top of each section means someone who tabbed away for twenty minutes can re-enter without rereading.
- **Vary the shape of consecutive sections** — diagram, then code excerpt, then a question, then an analogy. Novelty is what the attention system runs on; two identically-shaped prose sections in a row is a lullaby.
- **End sections on curiosity, not summary**, where it's natural: "Next up: the one file in this repo that everyone breaks on their first PR" pulls better than "In summary, the routes are thin."
- **Immediate feedback, small wins.** Quiz answers get instant confirmation; progress gets acknowledged ("that's the whole request path — the hardest section is behind you").

### Humour: yes, but earn it

Evidence-based conditions, not vibes: **topic-related only** (the joke must illustrate the concept just taught), laugh at the code or the industry — **never at the learner** — one touch per section at most, none in safety-critical instructions, and drop it entirely if the learner is all business. Full conditions and examples: `references/learning-styles.md`.

### Tour structure

Cover these sections, in order:

### 1. What this app does
One tight paragraph. Domain first, technology second.

### 2. The stack, translated
A short table or list mapping each major technology to the closest equivalent in the learner's home stack, with a one-line "where the analogy breaks" note where it matters.

### 3. Map of the repo
An annotated tree of only the directories that matter (5–10 entries). Each gets one line: what lives there and when the learner will care about it. Explicitly name the two or three directories they can ignore for now.

### 4. One flow, end to end
The heart of the tour. Pick one representative flow (an HTTP request, a CLI command, a job) and trace it through the *actual files*, with file paths and brief real code excerpts at each hop. Where shell access exists, skeleton the hops first with the bundled `scripts/trace.sh <entry-file>` — it maps what the file imports (resolved to repo files) and who imports it; follow the chain hop by hop, **verifying each by reading** (the script is static and best-effort, never gospel). One deep trace teaches the system's shape better than ten shallow summaries. Narrate each hop in terms of the learner's home stack.

### 5. Key areas
Three to six areas of the codebase, each: what it is, where it lives, why it exists, and what the learner would touch there. Order by how soon a newcomer will encounter them.

### 6. Architectural decisions and why they were (probably) made
For each significant decision (framework choice, layering, sync vs async, database choice, monorepo structure, unusual patterns):

- **State the decision** and where it's visible in the code.
- **Separate evidence from inference — this is non-negotiable.** If an ADR, README, comment, or commit message explains the rationale, cite it; `scripts/archaeology.sh` on the decision's core files surfaces exactly this evidence (refactor commits, revert wars, notable messages) with hashes to cite. If nothing documents it, say "my read is..." or "probably because..." and give the reasoning. Never present a guess about the original authors' intent as fact.
- Where useful, note the trade-off: what this choice made easy, what it made harder, and what the mainstream alternative would have been.

### 7. Gotchas for someone coming from [their stack]
Language- and ecosystem-level traps specific to this learner. For a JS developer reading Python, for example: decorators are higher-order functions applied with `@`; `__init__.py` makes a directory importable; virtualenvs are per-project `node_modules` for the interpreter itself; duck typing means fewer compile-time guarantees than TypeScript. Derive these from the learner's stated background — don't recite a generic list.

### 8. Check your understanding
Three to five short questions answerable from the tour ("Which file would you open first to change how errors are returned to the client?"). Active recall is what makes the map stick. Offer to discuss the answers.

End the tour by proposing the guided build: suggest two or three concrete small tasks in *this* repo that would make good first changes.

## Step 4 (optional but recommended): Guided build

The learner picks a small, real task — a tiny feature, a test, a small bug. Rules of engagement:

- **Coach, don't chauffeur.** The learner writes the code; Claude locates files, explains context, and reviews. Only write code directly if they ask.
- **Never show a completed example before the learner has attempted it.** No "here's roughly what it should look like", no filled-in skeleton, no solution-shaped pseudocode — seeing the answer first turns the exercise into copying. What's fine *before* an attempt: naming the file and rough location, describing the goal in words, pointing at an **existing, analogous piece of the repo** ("look at how `get_user` does it") — reading real prior art is learning; being handed the answer is not. Example code appears only *after* the learner has made an attempt **and asked for a check or said they're stuck** — and even then, prefer the drill-style hint ladder (what to look at → which part is off → the corrected lines) over dumping a full solution.
- **Predict-then-verify.** Before opening a file, ask what they expect to find there based on the tour. Before running anything, ask what they expect to happen. Wrong predictions are the most valuable moments — explain the gap.
- **Tie every step back to the map.** "We're in the service layer now — remember, that's where business rules live so the routes stay thin."
- **Keep the task genuinely small.** If it's growing, cut scope; the goal is learning, not shipping.
- **Review the actual diff, not pasted snippets.** Run `scripts/attempt.sh start` when the task begins (records HEAD and pre-existing dirty files), and `scripts/attempt.sh diff` when the learner asks for a check — it prints only *their* changes, baseline dirt excluded. Exit 3 means no attempt exists on disk yet: say so plainly ("I don't see an attempt yet — want a nudge on where to start?") rather than reviewing imaginary code. `attempt.sh end` clears the baseline at the retrospective; the diff *is* the record of what they built.
- **Run the repo's own linters and formatters on the learner's changes** (ruff/flake8, eslint, prettier, gofmt — whatever the repo already configures; check for lint config during recon). Lint output is teaching material, not gatekeeping: each warning gets a one-line explanation of the convention behind it, in home-stack terms where possible ("ruff's F841 is the unused-variable warning — same idea as ESLint's no-unused-vars"). A change isn't done until the repo's own checks pass, because that's true of real PRs too.
- Finish with a short retrospective: what parts of the map got confirmed, corrected, or extended.

## Spaced review mode

Retrieval at expanding intervals is the highest-leverage retention technique available; this mode makes it automatic.

### The review queue

Lives as a table in `learner-progress.md`:

```markdown
## Review queue
| Concept | Anchor | Last result | Interval | Next review |
|---|---|---|---|---|
| Why routes delegate to services | src/api/routes.py | wrong (2026-07-10) | 1d | 2026-07-11 |
| How DB sessions are scoped | src/db/session.py | right (2026-07-12) | 3d | 2026-07-15 |
```

**What goes in the queue** (add during tours and builds, not just at review time):

- Every wrong prediction and every check-your-understanding question the learner missed — these enter at the shortest interval
- Each key area and significant architectural decision from the tour — one entry each, at a 1-day starting interval
- Anything the learner explicitly asks to remember

**Scheduling** — use a simple ladder: 1d → 3d → 7d → 21d → 60d. Answered correctly: move up one rung. Answered wrong or shakily: drop back to 1d. **Don't do the date math or due-filtering by hand** — the bundled `scripts/progress.sh` does it deterministically: `progress.sh promote 7d` / `progress.sh demote` print the new interval with its next-review date, `progress.sh next 3d` prints an ISO date, and `progress.sh due <learner-progress.md>` prints exactly the queue rows due today or earlier (use it for the Step 0 check).

### Running a review

Triggered by due items at session start (Step 0) or the learner asking to be quizzed. Rules:

- **Ask retrieval questions, never re-explain first.** The struggle to recall *is* the learning. "Which layer would you add validation to, and why?" — then wait.
- **Anchor every question in the real repo** — actual files, actual decisions — never generic language trivia. Where possible, freshen the question with current code: open the anchor file and ask about what's there now.
- **Vary the angle on repeat visits.** If they recalled *what* the service layer is last time, ask *why it exists* or *what breaks without it* this time. Same concept, new retrieval path.
- **Wrong answers get a short, kind explanation and a demotion** in the queue — never a lecture. Right answers get confirmation plus one enriching detail, then move on.
- **Keep rounds short.** ~5 questions, a few minutes. Frequent and small beats rare and exhaustive; end while it still feels easy.
- If the repo has drifted since a queue item was written (Step 0's diff check), verify the concept still holds before quizzing on it — and if the code changed the answer, that's the best question of all: "this used to work like X; look at it now — what changed?"

After the round, update the queue table (results, intervals, next-review dates) as part of saving memory.

## The knowledge map

Track not just *what* the learner has seen but *how well they've shown they know it* — exposure is not knowledge, and the map must never pretend otherwise. Maintain a table in `learner-progress.md`:

```markdown
## Knowledge map
| Area | Level | Evidence | Last touched |
|---|---|---|---|
| Request routing | ▓▓▓ demonstrated | fixed drill-2 bug in routes | 2026-07-14 |
| Service layer | ▓▓░ recalled | 3/3 quiz, 1 Feynman gap closed | 2026-07-12 |
| DB sessions | ▓░░ covered | toured only | 2026-07-10 |
| Background jobs | ░░░ not seen | — | — |
```

**The levels — strictly evidence-based, never vibes:**

- **not seen** — hasn't come up yet
- **covered** — toured or explained; the weakest level, and say so ("you've seen this, but haven't been tested on it")
- **recalled** — answered retrieval questions correctly (quiz, review round, or Feynman probes survived)
- **demonstrated** — used it for real: guided-build work in the area, or a solved drill

Promotion requires evidence from that session; wrong quiz answers or exposed Feynman gaps *demote* an area back to covered. Update the map whenever any mode produces evidence.

**Showing the map — fog of war**: present it whenever the learner asks ("what have I learned?", "show my progress", "what's left?") and offer it at the end of each session. Where shell access exists, `scripts/progress.sh render <learner-progress.md>` prints the canonical view (glyphs: ░ not seen, ▒ covered, ▓ recalled, █ demonstrated, with honest counts — never invented percentages); otherwise follow the display rules in `references/map-and-history.md`. Lead with what's revealed, and point at the highest-value fog to clear next.

The map also drives mode suggestions: lots of "covered" and little "recalled" → suggest a review round or Feynman mode; a "not seen" area blocking their stated goal → suggest touring it next.

## Area histories

When an area first reaches *recalled*, offer its history: a short, hash-cited story mined with `scripts/archaeology.sh`. **Before telling one, read `references/map-and-history.md`**: it holds the evidence standards.

## Feynman mode

The fastest way to expose fuzzy understanding: the learner teaches the material back, and gaps that passive review would hide become audible. Offer this after a tour, or when the learner sounds confident ("makes sense", "got it") about something important — confidence is exactly when this mode is most useful.

**Setup**: the learner picks an area (or Claude picks a covered topic from `learner-progress.md`) and explains it as if onboarding a brand-new teammate — in their own words, no peeking at the code or the tour doc.

**While they explain, Claude's job is to listen like a sharp newcomer, not to correct in real time.** Let them finish. Then probe:

- **Chase the hand-waves.** Any "and then it just kind of..." or unexplained jargon gets a follow-up: "Where *exactly* does the session get validated? Which file?"
- **Ask questions a real newcomer would ask** — "why not just do it in the route handler?", "what happens if that call fails?" — anchored in the actual repo.
- **Push one level deeper than they went.** If they explained *what*, ask *why*; if they explained *why*, ask *what breaks without it*.
- Two or three probes per explanation is plenty. This should feel like a curious colleague, not a viva.

**Afterwards**: name the gaps kindly and specifically, fill them (with file references), and add each gap to the review queue at the shortest interval. If their explanation was *good* — clearer than the cached one — offer to fold their phrasing into `repo-map.md`; a learner's own words in the shared map is onboarding gold for the next person.

## Debugging drills

Diagnosing a real break teaches a system's failure modes (its logs, its error paths, where its assumptions live) like nothing else. Drills make that safe and repeatable.

**Safety first, always** — use the bundled `scripts/drill.sh` rather than raw git, so the choreography is deterministic:

- `drill.sh plant [--patch <file>]` refuses to start unless the working tree is clean, creates the `tutor/drill-*` scratch branch (with the learner's explicit go-ahead), applies and commits the bug so `git status` stays spoiler-free, and records the pre-drill branch and commit. Its state lives inside `.git/`, so it can never be accidentally committed.
- `drill.sh status` shows whether a drill is active and where the repo will be restored to.
- `drill.sh cleanup` switches back, verifies the original branch is at the exact recorded pre-drill commit (safety-stops rather than deleting anything if not), removes the scratch branch, and confirms the tree is exactly as found. It refuses to discard the learner's uncommitted work unless run with `--force` *after* confirming with the learner.
- No git available? Fall back to a **static drill**: present a realistic diff or code excerpt containing the bug and have the learner diagnose it by reading.

**Planting a good bug**:

- Choose an area the learner has already toured — drills consolidate the map, they don't replace it.
- Plant exactly **one** bug, and make it a *system* bug, not a typo: a logic error, a wrong config value, a broken assumption between layers, an off-by-one in a query, a swallowed exception. The learner should learn something about how the system behaves, not about spotting syntax.
- Calibrate difficulty to their progress file; early drills should have a visible symptom (failing test, clear error), later ones can fail silently.
- Know the intended discovery path before starting: what symptom, which signal, which file.

**Running the drill** — the learner drives, Claude coaches:

1. Learner reproduces the symptom (run the tests or the app) and states what they observe.
2. **Hypothesis before action, every cycle**: "what do you think is wrong, and what would you check to confirm?" — then let them check. This is the predict-then-verify loop under pressure, and it's where the learning happens.
3. Never reveal the location. Use a hint ladder instead: (1) point at the *kind* of signal to look for → (2) narrow to a layer or module → (3) narrow to a file. Wait for them to be genuinely stuck before each rung.
4. Learner writes the fix and re-verifies.
5. **Debrief** — the most valuable five minutes: what signal *should* have pointed here fastest, what this bug reveals about the system's assumptions, and where else in the codebase the same class of bug could hide. Add that class of bug and the area's failure mode to the review queue.

Never plant bugs outside this mode, never leave one behind, and never let a drill branch anywhere near a push.

## Saving memory (as you go, not at the end)

Terminals close, laptops die, sessions time out — a session's learning must never live only in the conversation. Save incrementally, not as a farewell ritual.

**Ask for consent once, early**: right after calibration, before the tour starts, ask whether to save progress to `.codebase-tutor/` (and whether to gitignore the personal file). **Ask before writing anything into the learner's repository** — a skill must not silently add files to someone's project. Record the answer at the top of `learner-progress.md` (`save: auto`) so future sessions never re-ask. If they decline, respect it — but warn that a closed terminal loses the session, and offer the content as a copyable document at natural break points instead, to keep elsewhere and paste back in next time.

**Once consented, write after every meaningful event** — each is a few seconds of file update, and each is a checkpoint the learner can safely die at:

- **every checkpoint → rewrite the "Session state" block** via `scripts/progress.sh anchor <learner-progress.md>` (block content on stdin; it replaces the section atomically) — this is the resume anchor, and vague anchors are why resumed sessions lose their place. It must pin the *content*, not just the number:

  ```markdown
  ## Session state (resume anchor)
  mode: tour
  position: 4/8 — one flow, end to end
  tracing: POST /api/runs → src/api/routes.py → services/run_service.py (next hop: workers/lifecycle.py)
  active analogies: blueprints ≈ Express routers; run_service ≈ your controller/service split
  last said: finished the service-layer hop; next checkpoint offered "Continue → the worker"
  ```
- a tour section completed → append to topics covered
- a quiz/review answer → update the review queue and knowledge map
- a wrong prediction or exposed Feynman gap → record it immediately (this is the highest-value data; losing it hurts most)
- a drill solved or a build step done → update the knowledge map evidence
- a preference change → update the profile line

Keep writes surgical — update the relevant row or append a line; don't rewrite whole files per event. Recon results go into `repo-map.md` as soon as the recon is done, before the tour even starts, so a crash mid-tour still leaves the expensive work banked.

Write two files with different audiences:

**`.codebase-tutor/repo-map.md`** — repo knowledge, safe to share with teammates (some teams may even want to commit it as living onboarding docs). Header must include the commit it was built at:

```markdown
# Codebase map (generated by codebase-tutor)
commit: <output of git rev-parse HEAD>
date: <ISO date>
```

Then: the stack summary, annotated repo map, key areas, architectural decisions (preserving the evidence-vs-inference labels), and any flows traced end to end. Write it as reference material, not conversation transcript.

**`.codebase-tutor/learner-progress.md`** — personal; offer to add it to `.gitignore` (only edit `.gitignore` with the learner's consent). Contents: their background, home stack, and learning style, a dated log of sessions, topics covered, check-your-understanding results, **predictions that were wrong and why** (the highest-value teaching signal for next time), open questions to pick up later, the **review queue** table (see "Spaced review mode") with updated intervals and next-review dates, and the **knowledge map** table with evidence-based levels per area.

On later sessions, keep updating these files rather than rewriting them — append to the session log, correct any cached inference that turned out wrong, and bump the commit stamp after re-verifying drifted areas. If any earlier inference about an architectural decision was contradicted by evidence found later, fix it in `repo-map.md` and note the correction.
## Model guidance

This skill runs well on a fast mid-tier model (e.g. Claude Sonnet): the deterministic work lives in scripts, and tutoring sessions are long and turn-heavy. Two situations warrant offering a switch to a larger model, **as numbered options, never as prose advice**:

- **Protocol drift**: if the learner reports (or the session shows) skipped checkpoints, section-jumping, or text-dumping, first re-read the delivery protocol — drift is a compliance problem before it's a capacity one. If it persists, offer the switch.
- **Judgment-heavy moments**: before designing a harder drill, inferring architectural rationale in gnarly legacy code, or deep Feynman probing, offer the upgrade once at the natural checkpoint.

The offer looks like this (the learner runs `/model` themselves — Claude cannot switch models for them):

```
This next part (designing a harder drill) benefits from a bigger model.
1. Carry on with the current model — it'll be fine
2. I'll switch — wait while I run /model, then reply "ready"
3. What's the trade-off?
```

Rules: offer at most once per session per trigger, default framing favours option 1 (no upselling), and on "ready" resume exactly where the session paused. Model names date quickly — recommend by tier ("your most capable model"), not by hardcoded version.

## Maintaining the toolkit

`tests/test_scripts.sh` self-tests every bundled script against a throwaway fixture repo: each helper's happy path plus its key safety/fallback path (~72 checks). Run it after any script change, and on a new machine if a helper behaves oddly; exit 0 means the toolkit is healthy.

## Teaching principles (apply throughout)

- **Anchor to prior knowledge.** Every new concept lands better attached to one the learner already has.
- **Pace is set by the learner, not the material.** The delivery protocol (one section per message, hard-gate checkpoints) governs every mode. If in doubt, say less — the learner can ask for more, but can't un-read a dump.
- **The wording rules apply everywhere.** "Wording the tutorials" and the humour conditions in Step 3 govern all five modes, not just the tour.
- **Depth over coverage.** One fully-traced flow beats an exhaustive file inventory. Resist the urge to mention everything.
- **Be honest about uncertainty.** Distinguish "the code shows X" from "I'm inferring Y". Learners trust and learn more from a tutor who marks their guesses.
- **No jargon without a bridge.** The first use of any term from the target ecosystem gets a plain-language or home-stack gloss.
- **Invite questions at natural checkpoints** rather than at the end of a wall of text.
