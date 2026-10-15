#!/usr/bin/env node
// analyse.mjs: the self-evaluation report, from .learning/events.jsonl and the concept record.
// Deterministic: no network, randomness or AI. Numbers are prompts for review, not verdicts:
// a completed checkpoint doesn't prove mastery, and a high override rate isn't automatically bad.
// With --git, the rules in force (packs, then ~/.learning/rules.json, then .learning/rules.json; see
// rules.mjs) look for risky commits; --rules puts one more file on top.
// Usage: node analyse.mjs [--write] [--git <days>] [--rules <file>]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LOG_CATS, eventsPath, isMain, parseArgs, projectRoot, today } from "./lib.mjs";
import { list } from "./record.mjs";
import { loadRules, parseDiff, signals } from "./rules.mjs";

const day = (e) => String(e.d ?? "").slice(0, 10);
const tally = (items) => items.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
const show = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
const pct = (a, b) => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const week = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3); // this week's Thursday
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3); // week 1's Thursday
  return `${t.getUTCFullYear()}-W${String(1 + Math.round((t - first) / 604800000)).padStart(2, "0")}`;
};

export function readEvents(file) {
  if (!fs.existsSync(file)) return { events: [], bad: 0 };
  let bad = 0;
  const events = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      bad++;
    }
  }
  return { events, bad };
}

export function report(events, concepts, { bad = 0, misses = null } = {}) {
  const mod = events.filter((e) => e.by === "mod");
  const skill = events.filter((e) => e.by === undefined);
  const checkpoints = skill.filter((e) => e.e === "checkpoint");
  const passed = checkpoints.filter((e) => e.outcome === "passed");
  const triages = [
    ...skill.filter((e) => e.e === "triage").map((e) => ({ tier: e.tier, cats: e.cats ?? [] })),
    ...mod.filter((e) => e.e === "triage").map((e) => {
      const cat = String(e.what ?? "").split(":")[0].trim();
      return { tier: e.tier, cats: LOG_CATS.includes(cat) ? [cat] : [] };
    }),
  ];
  const out = [`# Guardrails audit · ${today()}`, ""];
  const first = events.map(day).filter(Boolean).sort()[0];
  out.push(`${events.length} event${events.length === 1 ? "" : "s"} since ${first ?? "never"} (${skill.length} from the skill, ${mod.length} from the mod)${bad ? ` · ${bad} unreadable lines` : ""}`, "");

  out.push("## Triggers");
  out.push(`- triage by tier: ${show(tally(triages.map((t) => t.tier)))}`);
  out.push(`- checkpoints by category: ${show(tally(checkpoints.flatMap((e) => e.cats ?? [])))}`);
  out.push("");

  out.push("## Outcomes");
  out.push(`- checkpoints: ${checkpoints.length} · ${show(tally(checkpoints.map((e) => e.outcome)))}`);
  out.push(`- override rate: ${pct(checkpoints.filter((e) => e.outcome === "override").length, checkpoints.length)}`);
  out.push(`- flagged unnecessary: ${checkpoints.filter((e) => e.flagged_unnecessary).length}`);
  out.push(`- questions reworded (assumed too much): ${checkpoints.filter((e) => e.reworded > 0).length}`);
  out.push("");

  out.push("## Learning, not compliance");
  out.push(`- unaided passes: ${passed.filter((e) => e.help === 0).length} of ${passed.length} (${pct(passed.filter((e) => e.help === 0).length, passed.length)})`);
  out.push(`- evidence: ${show(tally(passed.map((e) => e.evidence ?? "unrecorded")))}`);
  const repeats = checkpoints.filter((e) => e.status_before === "demonstrated" && e.new_knowledge === false);
  out.push(`- repeat teaching (demonstrated, nothing new): ${repeats.length ? show(tally(repeats.flatMap((e) => e.concepts ?? ["?"]))) : "none"}`);
  const recent = (e) => (Date.now() - Date.parse(day(e))) / 86400000 <= 30;
  const plain = checkpoints.filter((e) => recent(e) && (e.focus === "new" || e.focus === undefined));
  const thrice = Object.entries(tally(plain.flatMap((e) => e.concepts ?? []))).filter(([, n]) => n >= 3);
  out.push(`- same concept 3+ times in 30 days with no new focus: ${thrice.length ? thrice.map(([k, n]) => `${k} ${n}`).join(", ") : "none"}`);
  const gappy = concepts.filter((c) => c.gaps > 0).sort((a, b) => b.gaps - a.gaps).slice(0, 5);
  out.push(`- open gaps: ${gappy.length ? gappy.map((c) => `${c.slug} ${c.gaps}`).join(", ") : "none"}`);
  const reflex = {};
  for (const e of checkpoints) if (e.skip_reflex) reflex[week(day(e))] = (reflex[week(day(e))] ?? 0) + e.skip_reflex;
  out.push(`- skip reflex by week: ${Object.keys(reflex).length ? Object.entries(reflex).sort().map(([w, n]) => `${w} ${n}`).join(", ") : "none caught"}`);
  out.push("");

  out.push("## Overhead");
  const turns = checkpoints.map((e) => e.turns).filter(Number.isInteger);
  out.push(`- turns per checkpoint: ${turns.length ? (turns.reduce((a, b) => a + b, 0) / turns.length).toFixed(1) : "n/a"}`);
  const tasks = new Set(checkpoints.map((e) => e.task));
  out.push(`- checkpoints per task: ${tasks.size ? (checkpoints.length / tasks.size).toFixed(1) : "n/a"}`);
  const ms = mod.filter((e) => e.e === "gate_close" && Number.isFinite(e.ms)).map((e) => e.ms);
  out.push(`- gate time open (mod): ${ms.length ? `median ${Math.round(median(ms) / 1000)}s over ${ms.length} gates` : "no data"}`);
  out.push(`- edits refused by the gate (mod): ${mod.filter((e) => e.e === "edit_refused").length}`);
  out.push("");

  out.push("## Classification");
  const reviews = skill.filter((e) => e.e === "diff_review");
  const rank = { go: 0, check: 1, gate: 2 };
  out.push(`- diff reviews: ${reviews.length} · missed risk ${reviews.filter((e) => rank[e.actual] > rank[e.triaged]).length} · over-triage ${reviews.filter((e) => rank[e.actual] < rank[e.triaged]).length}`);
  out.push(`- disputed tiers: ${skill.filter((e) => e.e === "disputed").length}`);
  out.push("");

  out.push("## Record drift");
  const drift = passed.filter((e) => (e.concepts ?? []).length > 0 && !(e.concepts ?? []).some((slug) =>
    concepts.some((c) => c.slug === slug && c.evidence.some((line) => line.includes(day(e))))));
  out.push(drift.length ? drift.map((e) => `- ${day(e)} ${e.task}: ${(e.concepts ?? []).join(", ")} passed with no evidence line that day`).join("\n") : "- none: every pass has its evidence");

  if (misses !== null) {
    out.push("", "## Possible misses (git)");
    out.push(misses.length ? misses.map((m) => `- ${m.sha.slice(0, 8)} ${m.date} ${m.cats.join(", ")}: no gate that day. Review, not a verdict.`).join("\n") : "- none found");
  }
  return out.join("\n");
}

// Commits whose diffs carry GATE signals on a day with no gate in the log.
export function gitMisses(root, days, rules, events) {
  let raw;
  try {
    raw = execFileSync("git", ["-C", root, "log", `--since=${days}.days`, "--date=short", "--format=@@commit %H %ad", "-p", "--unified=0", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return [];
  }
  const gated = new Set(events.filter((e) => e.tier === "gate" || e.e === "gate_open").map(day));
  const misses = [];
  for (const chunk of raw.split(/^@@commit /m).filter(Boolean)) {
    const [head, ...rest] = chunk.split("\n");
    const [sha, date] = head.split(" ");
    const { files, lines } = parseDiff(rest.join("\n"));
    const cats = signals(files, lines, rules);
    if (cats.length && !gated.has(date)) misses.push({ sha, date, cats });
  }
  return misses;
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = projectRoot();
  const { events, bad } = readEvents(eventsPath(root));
  let misses = null;
  if (flags.git) {
    const rules = loadRules({ root, extra: flags.rules === undefined ? [] : [].concat(flags.rules) });
    misses = gitMisses(root, Number(flags.git === true ? 30 : flags.git), rules, events);
  }
  const text = report(events, list(), { bad, misses });
  if (flags.write) {
    const file = path.join(root, ".learning", "reports", `${today()}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${text}\n`);
    console.log(`${text}\n\nwritten: ${file}`);
  } else console.log(text);
}
