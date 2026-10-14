#!/usr/bin/env node
// bench.mjs: runs the benchmark cases against the triage rules, the record logic and the
// override policy. With --proposed it compares the rules in force with the same rules plus one more
// file, and flags any case that became more permissive (risk under-tiered, a needed check dropped)
// or more intrusive.
// Rules: every pack in assets/rules/, then ~/.learning/rules.json, then .learning/rules.json (rules.mjs).
// Cases: every assets/benchmarks/*.jsonl, then ~/.learning/benchmarks/cases.jsonl, then the project's;
// a case with an id already seen replaces it.
// Deterministic: no network, randomness or AI. The engagement judgement stays with Claude.
// Usage: node bench.mjs [--rules <file>] [--cases <file>] [--proposed <file>]
//   --rules and --proposed take a pack (adds or replaces it), a layer ("version": 2) or an old full copy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { home, isMain, parseArgs, projectRoot } from "./lib.mjs";
import { describe, isComment, loadRules, signals } from "./rules.mjs";

export { loadRules, matches, parseDiff, signals } from "./rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(HERE, "..", "assets", "benchmarks");
const RANK = { go: 0, check: 1, gate: 2 };

// A changed line without its +/- marker; diff headers dropped.
export const changedLines = (diff) =>
  (Array.isArray(diff) ? diff : String(diff ?? "").split("\n"))
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1));

export function triage(c, rules) {
  const lines = changedLines(c.diff);
  if (rules.commentOnly && lines.length > 0 && lines.every(isComment)) return { tier: "go", cats: [], why: "non-functional-edit" };
  const cats = signals(c.files, lines, rules);
  if (cats.length > 0) return { tier: "gate", cats };
  return { tier: c.newConcept || c.variation ? "check" : "go", cats };
}

// What the record says to ask about (SKILL.md §2), given the tier.
export function decide(c, tier) {
  if (tier === "go") return { checkpoint: false, focus: null };
  const r = c.record ?? { status: "none" };
  if (r.gapTouched) return { checkpoint: true, focus: "gap" };
  if (r.status === "demonstrated") {
    if (r.sameContext === false) return { checkpoint: true, focus: "implementation" };
    if (c.variation) return { checkpoint: true, focus: "variation" };
    return { checkpoint: false, focus: "on-record" }; // however long ago: no scheduled re-checks
  }
  if (r.status === "learning" || r.status === "needs-reinforcement") return { checkpoint: true, focus: "reinforcement" };
  return { checkpoint: true, focus: "new" };
}

// SKILL.md §5: a CHECK can always wait ("not now" drops it). A GATE takes only an incident
// or throwaway code, and a reason about the user is the skip reflex.
export function overrideAccepted(tier, reason) {
  if (String(tier).toLowerCase() !== "gate") return true;
  const r = String(reason).toLowerCase();
  if (/\b(later|slow|no time|doesn'?t matter|whatever|don'?t care|i'?m|probably fine|skip)\b/.test(r)) return false;
  return /\b(prod|production|incident|outage|down|hotfix|throwaway|spike|prototype|deleting)\b/.test(r);
}

export function evaluate(c, rules) {
  if (c.override) return { accepted: overrideAccepted(c.override.tier, c.override.reason) };
  const t = triage(c, rules);
  const d = decide(c, t.tier);
  const got = { tier: t.tier, cats: t.cats, checkpoint: d.checkpoint, focus: d.focus };
  if (c.triaged) got.escalate = RANK[t.tier] > RANK[c.triaged];
  return got;
}

export const mismatches = (expected, got) =>
  Object.entries(expected)
    .filter(([key, want]) => JSON.stringify(got[key]) !== JSON.stringify(want))
    .map(([key, want]) => `${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got[key])}`);

export const loadCases = (file) =>
  fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// The case files in force: the shipped ones, then yours, then the project's.
export function caseFiles(root = projectRoot(), dir = CASES) {
  const shipped = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().map((f) => path.join(dir, f));
  const mine = path.join(home(), ".learning", "benchmarks", "cases.jsonl");
  const project = path.join(root, ".learning", "benchmarks", "cases.jsonl");
  return [...shipped, ...[...new Set([mine, project])].filter((f) => fs.existsSync(f))];
}

// Every case from those files; a later case with an id already seen replaces it.
export function casesInForce(files) {
  const byId = new Map();
  for (const file of files) for (const c of loadCases(file)) byId.set(c.id, c);
  return [...byId.values()];
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = projectRoot();
  const extra = flags.rules === undefined ? [] : [].concat(flags.rules);
  const current = loadRules({ root, extra });
  const files = flags.cases === undefined ? caseFiles(root) : [].concat(flags.cases);
  const cases = casesInForce(files);
  const shipped = files.filter((f) => path.dirname(f) === CASES);
  const others = files.filter((f) => path.dirname(f) !== CASES).map((f) => f.replace(root, ".").replace(home(), "~"));
  const sources = [...(shipped.length ? [`assets/benchmarks (${shipped.length} files)`] : []), ...others];
  console.log(`rules: ${describe(current, root)}\ncases: ${sources.join(" + ")}\n`);
  for (const w of current.warnings) console.log(`note: ${w}`);
  let failed = 0;
  for (const c of cases) {
    const problems = mismatches(c.expected, evaluate(c, current));
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${c.id} (${c.kind})${problems.length ? `\n      ${problems.join("\n      ")}` : ""}`);
  }
  console.log(`\n${cases.length} cases · ${cases.length - failed} pass · ${failed} fail`);

  if (flags.proposed) {
    const proposed = loadRules({ root, extra: [...extra, flags.proposed] });
    console.log(`\nproposed: ${flags.proposed}`);
    for (const w of proposed.warnings.filter((w) => !current.warnings.includes(w))) console.log(`note: ${w}`);
    let proposedFails = 0;
    for (const c of cases.filter((x) => !x.override)) {
      const a = evaluate(c, current);
      const b = evaluate(c, proposed);
      if (mismatches(c.expected, b).length) proposedFails++;
      if (a.tier === b.tier && a.checkpoint === b.checkpoint) continue;
      const looser = RANK[b.tier] < RANK[a.tier] || (a.checkpoint && !b.checkpoint);
      console.log(`${looser ? "MORE PERMISSIVE" : "MORE INTRUSIVE "}  ${c.id}: ${a.tier}/${a.checkpoint ? "check" : "no check"} → ${b.tier}/${b.checkpoint ? "check" : "no check"}`);
    }
    console.log(`proposed: ${proposedFails === 0 ? "all cases still pass" : `${proposedFails} case(s) fail`}`);
    failed += proposedFails;
  }
  process.exit(failed === 0 ? 0 : 1);
}
