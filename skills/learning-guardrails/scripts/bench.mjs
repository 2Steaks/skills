#!/usr/bin/env node
// bench.mjs: runs the benchmark cases against the triage rules, the record logic and the
// override policy. With --proposed it compares two rule sets and flags any case that became
// more permissive (risk under-tiered, a needed check dropped) or more intrusive.
// Deterministic: no network, randomness or AI. The engagement judgement stays with Claude.
// Usage: node bench.mjs [--rules <file>] [--cases <file>] [--proposed <rules file>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATS, fail, isMain, parseArgs, projectRoot } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RANK = { go: 0, check: 1, gate: 2 };

export function loadRules(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const compile = (list = [], flags = "i") => list.map((p) => new RegExp(p, flags));
  const categories = {};
  for (const cat of CATS) {
    const c = raw.categories?.[cat] ?? {};
    categories[cat] = { paths: compile(c.paths), diff: [...compile(c.diff), ...compile(c.diffExact, "")] };
  }
  return { categories, commentOnly: raw.go?.commentOnly !== false };
}

// A changed line without its +/- marker; diff headers dropped.
export const changedLines = (diff) =>
  (Array.isArray(diff) ? diff : String(diff ?? "").split("\n"))
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1));

const isComment = (l) => /^\s*$|^\s*(\/\/|\/\*|\*|\*\/|#|<!--)/.test(l);

// The risk categories a change's files and changed lines point at.
export function signals(files = [], lines = [], rules) {
  return CATS.filter((cat) => {
    const { paths, diff } = rules.categories[cat];
    return files.some((f) => paths.some((re) => re.test(f))) || lines.some((l) => diff.some((re) => re.test(l)));
  });
}

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
    if ((r.daysSince ?? 0) >= 90) return { checkpoint: true, focus: "reinforcement" };
    return { checkpoint: false, focus: "on-record" };
  }
  if (r.status === "needs-reinforcement") return { checkpoint: true, focus: "reinforcement" };
  return { checkpoint: true, focus: "new" };
}

// SKILL.md §5: the reason must be about the work; a GATE takes only an incident or throwaway code.
export function overrideAccepted(tier, reason) {
  const r = String(reason).toLowerCase();
  if (/\b(later|slow|no time|doesn'?t matter|whatever|don'?t care|i'?m|probably fine|skip)\b/.test(r)) return false;
  if (String(tier).toLowerCase() === "gate") return /\b(prod|production|incident|outage|down|hotfix|throwaway|spike|prototype|deleting)\b/.test(r);
  return r.trim().length > 0;
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

function defaults() {
  const root = projectRoot();
  const local = (name) => path.join(root, ".learning", name);
  return {
    rules: fs.existsSync(local("rules.json")) ? local("rules.json") : path.join(HERE, "..", "assets", "rules.default.json"),
    cases: fs.existsSync(local("benchmarks/cases.jsonl")) ? local("benchmarks/cases.jsonl") : path.join(HERE, "..", "assets", "benchmarks.jsonl"),
  };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const d = defaults();
  const rulesFile = flags.rules ?? d.rules;
  const cases = loadCases(flags.cases ?? d.cases);
  const current = loadRules(rulesFile);
  let failed = 0;
  console.log(`rules: ${rulesFile}\ncases: ${flags.cases ?? d.cases}\n`);
  for (const c of cases) {
    const problems = mismatches(c.expected, evaluate(c, current));
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${c.id} (${c.kind})${problems.length ? `\n      ${problems.join("\n      ")}` : ""}`);
  }
  console.log(`\n${cases.length} cases · ${cases.length - failed} pass · ${failed} fail`);

  if (flags.proposed) {
    const proposed = loadRules(flags.proposed);
    console.log(`\nproposed: ${flags.proposed}`);
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
