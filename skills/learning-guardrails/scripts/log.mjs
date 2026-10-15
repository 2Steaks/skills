#!/usr/bin/env node
// log.mjs: appends one schema-checked event to .learning/events.jsonl. Short codes and
// concept names only: no code, file contents, credentials, personal data or conversation.
// With the learning-gate mod on, it logs triage, gate open/close and refusals itself.
// Usage: node log.mjs <event> '<json>'      e.g. node log.mjs checkpoint '{"task":"t3","tier":"gate","outcome":"passed"}'
//        node log.mjs --help                the schema
import fs from "node:fs";
import { LOG_CATS, SLUG, STATUSES, eventsPath, fail, isMain, now } from "./lib.mjs";
import { setup } from "./setup.mjs";

const TIERS = ["go", "check", "gate"];
const code = (v) => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
const count = (v) => Number.isInteger(v) && v >= 0 && v < 1000;

const FIELDS = {
  task: [(v) => typeof v === "string" && /^[\w-]{1,24}$/.test(v), "a short id, the same for one task's events"],
  tier: [(v) => TIERS.includes(v), TIERS.join(" | ")],
  triaged: [(v) => TIERS.includes(v), TIERS.join(" | ")],
  actual: [(v) => TIERS.includes(v), TIERS.join(" | ")],
  user_says: [(v) => TIERS.includes(v), TIERS.join(" | ")],
  cats: [(v) => Array.isArray(v) && v.every((c) => LOG_CATS.includes(c)), `a list of ${LOG_CATS.join(", ")}`],
  added: [(v) => Array.isArray(v) && v.every((c) => LOG_CATS.includes(c)), `a list of ${LOG_CATS.join(", ")}`],
  concepts: [(v) => Array.isArray(v) && v.every((c) => typeof c === "string" && SLUG.test(c)), "a list of concept names"],
  status_before: [(v) => [...STATUSES, "none"].includes(v), [...STATUSES, "none"].join(" | ")],
  focus: [(v) => ["new", "variation", "implementation", "gap", "reinforcement"].includes(v), "new | variation | implementation | gap | reinforcement"],
  outcome: [(v) => ["passed", "passed_on_record", "declined", "paused", "abandoned", "override"].includes(v), "passed | passed_on_record | declined | paused | abandoned | override"],
  evidence: [(v) => ["predict", "explain", "debug", "experiment", "transfer", "none"].includes(v), "predict | explain | debug | experiment | transfer | none"],
  help: [count, "ladder rungs used, 0 = unaided"],
  reworded: [count, "rewordings of a question that assumed too much (not ladder rungs)"],
  turns: [count, "exchanges from question to close"],
  skip_reflex: [count, "how many times it fired"],
  new_knowledge: [(v) => typeof v === "boolean", "true | false"],
  flagged_unnecessary: [(v) => v === true, "true, when the user called it pointless and you agree"],
  why: [code, "a short code (copy-change, non-functional-edit)"],
  reason: [code, "a short code (incident, throwaway, one-off)"],
};

const EVENTS = {
  triage: { required: ["task", "tier"], optional: ["cats", "why"] },
  checkpoint: {
    required: ["task", "tier", "outcome"],
    optional: ["cats", "concepts", "status_before", "focus", "evidence", "help", "reworded", "turns", "skip_reflex", "new_knowledge", "flagged_unnecessary"],
  },
  diff_review: { required: ["task", "triaged", "actual"], optional: ["added"] },
  override: { required: ["task", "tier", "reason"], optional: ["concepts"] },
  disputed: { required: ["task", "tier"], optional: ["user_says", "why"] },
  pause: { required: ["task"], optional: ["concepts"] },
  resume: { required: ["task"], optional: [] },
};

export function check(e, data) {
  const spec = EVENTS[e];
  if (!spec) return [`unknown event "${e}": ${Object.keys(EVENTS).join(", ")}`];
  if (data === null || typeof data !== "object" || Array.isArray(data)) return ["the data must be a JSON object"];
  const problems = [];
  for (const key of spec.required) if (data[key] === undefined) problems.push(`${e} needs "${key}" (${FIELDS[key][1]})`);
  for (const [key, value] of Object.entries(data)) {
    if (![...spec.required, ...spec.optional].includes(key)) problems.push(`"${key}" isn't part of ${e}`);
    else if (!FIELDS[key][0](value)) problems.push(`"${key}" must be ${FIELDS[key][1]}`);
  }
  if (e === "checkpoint" && data.tier === "go") problems.push("a GO step has no checkpoint");
  if (e === "checkpoint" && data.outcome === "declined" && data.tier !== "check") problems.push("only a CHECK can be declined: a GATE pauses or holds");
  return problems;
}

export function log(e, data, start = process.cwd()) {
  const problems = check(e, data);
  if (problems.length) fail(`not logged:\n- ${problems.join("\n- ")}`);
  const { root } = setup(start);
  const file = eventsPath(root);
  const line = JSON.stringify({ d: now(), e, ...data });
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  fs.appendFileSync(file, `${before === "" || before.endsWith("\n") ? "" : "\n"}${line}\n`);
  return line;
}

if (isMain(import.meta.url)) {
  const [e, json] = process.argv.slice(2);
  if (e === undefined || e === "--help") {
    for (const [name, spec] of Object.entries(EVENTS)) {
      console.log(`${name}: needs ${spec.required.join(", ")}${spec.optional.length ? `; may add ${spec.optional.join(", ")}` : ""}`);
    }
    console.log("\nfields:");
    for (const [key, [, hint]] of Object.entries(FIELDS)) console.log(`  ${key}: ${hint}`);
    process.exit(e === undefined ? 1 : 0);
  }
  let data;
  try {
    data = JSON.parse(json ?? "{}");
  } catch {
    fail("the second argument must be JSON, in single quotes");
  }
  console.log(`logged: ${log(e, data)}`);
}
