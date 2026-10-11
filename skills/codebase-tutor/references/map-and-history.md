# Showing the knowledge map, and area histories

Read this before showing the knowledge map without the script, or telling an area's history.

## The map, by hand

Where shell access exists, `scripts/progress.sh render <learner-progress.md>` prints the canonical view straight from the knowledge map table. By hand, follow the same shape, one glyph per area:

```
The map so far — 2 of 6 regions fully mapped, 1 explored, 1 sketched:
█ Request routing      — fully mapped   (demonstrated: fixed drill-2 bug in routes)
█ Service layer        — fully mapped   (demonstrated: build work)
▓ DB sessions          — explored       (recalled: 3/3 quiz)
▒ Background jobs      — sketched       (covered: toured only)
░ Plugin system        — unexplored
░ Billing              — unexplored
```

Glyphs map one-to-one onto evidence levels (░ not seen, ▒ covered, ▓ recalled, █ demonstrated): the map renders evidence, never a separate score. Use counts ("2 of 6"), never invented percentages. Lead with what's revealed, be plain about what's merely sketched, and point at the highest-value gap to close next ("Background jobs is the biggest blank spot bordering your goal").

## Area histories

- When an area first reaches **recalled**, offer its history: a short story (a few sentences, not an essay) from the real git history. Run `scripts/archaeology.sh <area's core file or dir>`: it emits birth and latest commits, churn by year, the biggest changes by lines touched, reverts, the oldest surviving lines and notable commit messages, with hashes to cite. Narrate from that evidence: "This service layer used to be 40 fat route handlers, until commit a3f92c1..."
- Everything stated comes from actual commits (cite the hash); anything inferred about *why* is labelled as inference, same as architectural decisions. No history available? Say so and skip; never invent one.
- The best histories explain why the code looks the way it does. Track which ones you've told in `learner-progress.md` so none repeats.
