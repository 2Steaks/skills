// Tests for the skill's scripts. Each runs the real CLI in a throwaway project with a throwaway HOME.
// Run: node --test tests/
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const TODAY = new Date().toISOString().slice(0, 10);

function world({ git = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "lg-"));
  const home = path.join(base, "home");
  const proj = path.join(base, "proj");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(proj, "src"), { recursive: true });
  if (git) execFileSync("git", ["init", "-q", proj]);
  const run = (script, args = [], cwd = proj) => {
    const r = spawnSync("node", [path.join(SCRIPTS, script), ...args], { cwd, env: { ...process.env, HOME: home }, encoding: "utf8" });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
  };
  const read = (p) => fs.readFileSync(path.join(proj, p), "utf8");
  return { base, home, proj, run, read, exists: (p) => fs.existsSync(path.join(proj, p)) };
}

// ---- setup ----

test("setup creates the record and keeps it out of git, once", () => {
  const w = world();
  const first = w.run("setup.mjs");
  assert.equal(first.code, 0);
  for (const p of [".learning/session.md", ".learning/events.jsonl", ".learning/project"]) assert.ok(w.exists(p), p);
  assert.ok(fs.existsSync(path.join(w.home, ".learning", "general")));
  assert.match(first.out, /git: kept out of git/);
  const second = w.run("setup.mjs");
  assert.match(second.out, /record: already set up/);
  assert.match(second.out, /git: already kept out of git/);
  assert.equal(w.read(".git/info/exclude").match(/^\.learning\/$/gm).length, 1);
  assert.equal(execFileSync("git", ["-C", w.proj, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");
});

test("setup follows a worktree's .git file to the shared exclude", () => {
  const w = world({ git: false });
  const common = path.join(w.base, "main.git");
  const wtGit = path.join(common, "worktrees", "proj");
  fs.mkdirSync(path.join(common, "info"), { recursive: true });
  fs.mkdirSync(wtGit, { recursive: true });
  fs.writeFileSync(path.join(wtGit, "commondir"), "../..\n");
  fs.writeFileSync(path.join(w.proj, ".git"), `gitdir: ${wtGit}\n`);
  w.run("setup.mjs");
  assert.match(fs.readFileSync(path.join(common, "info", "exclude"), "utf8"), /^\.learning\/$/m);
});

test("setup records which gate is in use", () => {
  const w = world();
  w.run("setup.mjs", ["--gate", "mod"]);
  assert.match(w.read(".learning/session.md"), /^- Gate: mod\s+# mod \| hook \| declined$/m);
  assert.equal(w.run("setup.mjs", ["--gate", "sometimes"]).code, 1);
});

// ---- lock ----

test("lock opens with the exact line, setting up the record first", () => {
  const w = world();
  const r = w.run("lock.mjs", ["open", "gate", "concurrency", "One", "run", "or", "two,", "and", "why?"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(w.read(".learning/gate.lock"), "GATE · concurrency · One run or two, and why?\n");
  assert.match(w.read(".git/info/exclude"), /^\.learning\/$/m);
  assert.match(w.run("lock.mjs", ["open", "GATE", "concurrency", "Smaller: one or two?"]).out, /^relocked/);
  assert.equal(w.run("lock.mjs", ["show"]).out, "GATE · concurrency · Smaller: one or two?");
});

test("lock refuses GO, a bad label and a missing question", () => {
  const w = world();
  assert.match(w.run("lock.mjs", ["open", "GO", "x", "Why?"]).err, /GO never locks/);
  assert.match(w.run("lock.mjs", ["open", "GATE", "a · b", "Why?"]).err, /label/);
  assert.match(w.run("lock.mjs", ["open", "CHECK", "intl"]).err, /question missing/);
  assert.equal(w.exists(".learning/gate.lock"), false);
});

test("closing needs a reason the skill allows; a skip isn't one", () => {
  const w = world();
  w.run("lock.mjs", ["open", "CHECK", "intl", "What does narrow change?"]);
  const skip = w.run("lock.mjs", ["close", "skip"]);
  assert.equal(skip.code, 1);
  assert.match(skip.err, /A skip isn't one/);
  assert.ok(w.exists(".learning/gate.lock"));
  assert.equal(w.run("lock.mjs", ["close", "passed"]).out, "unlocked (passed)");
  assert.equal(w.run("lock.mjs", ["show"]).out, "none");
  assert.equal(w.run("lock.mjs", ["close", "paused"]).out, "no lock was open");
});

test("a lock opened from a subfolder lands at the project root", () => {
  const w = world();
  w.run("setup.mjs");
  w.run("lock.mjs", ["open", "GATE", "state", "Who owns this state?"], path.join(w.proj, "src"));
  assert.ok(w.exists(".learning/gate.lock"));
  assert.equal(fs.existsSync(path.join(w.proj, "src", ".learning")), false);
});

// ---- record ----

test("record creates a concept and appends dated evidence", () => {
  const w = world();
  w.run("setup.mjs");
  const r = w.run("record.mjs", ["update", "idempotency", "--evidence", "predict: Said a retried POST double-starts a run without a key", "--unaided", "--status", "demonstrated", "--context", "proj: start-run endpoint"]);
  assert.equal(r.code, 0, r.err);
  const text = fs.readFileSync(path.join(w.home, ".learning", "general", "idempotency.md"), "utf8");
  assert.match(text, /^concept: idempotency$/m);
  assert.match(text, /^status: demonstrated$/m);
  assert.match(text, new RegExp(`^- ${TODAY} · predict · Said a retried POST double-starts a run without a key \\(unaided\\) \\(proj\\)$`, "m"));
  assert.match(text, /^## Contexts\n- proj: start-run endpoint$/m);
});

test("record holds the rules: no demonstrated without unaided evidence, no reset to unfamiliar", () => {
  const w = world();
  assert.match(w.run("record.mjs", ["update", "retries", "--evidence", "explain: Why a timeout isn't proof of failure", "--status", "demonstrated"]).err, /unaided/);
  assert.equal(w.run("record.mjs", ["update", "retries", "--evidence", "explain: Why a timeout isn't proof of failure", "--status", "learning"]).code, 0);
  assert.match(w.run("record.mjs", ["update", "retries", "--status", "unfamiliar"]).err, /never reset to unfamiliar/);
  assert.equal(w.run("record.mjs", ["update", "retries", "--status", "needs-reinforcement"]).code, 0);
});

test("record keeps code and chat out of the notes, but not punctuation", () => {
  const w = world();
  assert.equal(w.run("record.mjs", ["update", "a-b", "--evidence", "explain: A lost reply plus a retry makes two runs; fix with a key"]).code, 0);
  assert.match(w.run("record.mjs", ["update", "x-y", "--evidence", "predict: `retry()` => twice"]).err, /words only/);
  assert.match(w.run("record.mjs", ["update", "Not_Kebab", "--status", "learning"]).err, /kebab-case/);
});

test("record handles gaps, project files, find and summary", () => {
  const w = world();
  w.run("record.mjs", ["update", "idempotency", "--evidence", "predict: Two runs without a key", "--unaided", "--status", "demonstrated", "--gap", "retries across services"]);
  w.run("record.mjs", ["update", "run-start-dedupe", "--project", "--general", "idempotency", "--status", "learning", "--evidence", "explain: The server dedupes on the key"]);
  const project = w.read(".learning/project/run-start-dedupe.md");
  assert.match(project, /^scope: project$/m);
  assert.match(project, /^general: idempotency$/m);
  assert.match(w.run("record.mjs", ["find", "idempotency"]).out, /^idempotency · general · demonstrated · gaps 1/);
  assert.equal(
    w.run("record.mjs", ["summary"]).out,
    "Learning record: 2 concepts\nDemonstrated (1): idempotency\nLearning (1): run-start-dedupe\nOpen gaps: 1",
  );
  assert.match(w.run("record.mjs", ["update", "idempotency", "--close-gap", "across services"]).out, /closed gap/);
  assert.doesNotMatch(w.run("record.mjs", ["summary"]).out, /Open gaps/);
});

// ---- log ----

test("log appends a checked event", () => {
  const w = world();
  const r = w.run("log.mjs", ["checkpoint", JSON.stringify({ task: "t1", tier: "gate", outcome: "passed", cats: ["concurrency"], concepts: ["idempotency"], evidence: "explain", help: 2, turns: 2, skip_reflex: 1, new_knowledge: true })]);
  assert.equal(r.code, 0, r.err);
  const line = JSON.parse(w.read(".learning/events.jsonl").trim());
  assert.equal(line.e, "checkpoint");
  assert.match(line.d, /^\d{4}-\d{2}-\d{2}T/);
});

test("log refuses what the schema doesn't allow", () => {
  const w = world();
  const bad = (event, data) => w.run("log.mjs", [event, JSON.stringify(data)]);
  assert.match(bad("checkpoint", { task: "t1", tier: "gate", outcome: "open" }).err, /"outcome" must be/);
  assert.match(bad("checkpoint", { task: "t1", tier: "go", outcome: "passed" }).err, /GO step has no checkpoint/);
  assert.match(bad("checkpoint", { task: "t1", tier: "gate", outcome: "passed", quote: "the user said" }).err, /"quote" isn't part of checkpoint/);
  assert.match(bad("override", { task: "t1", tier: "gate", reason: "the user really wanted to skip this one" }).err, /"reason" must be/);
  assert.match(bad("nonsense", {}).err, /unknown event/);
  assert.equal(w.exists(".learning/events.jsonl") ? w.read(".learning/events.jsonl").trim() : "", "");
});

// ---- bench ----

test("bench: every seed case passes on the default rules", () => {
  const w = world();
  const r = w.run("bench.mjs");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /26 cases · 26 pass · 0 fail/);
});

test("bench: a rule change that loosens the gate is flagged and fails", () => {
  const w = world();
  const rules = JSON.parse(fs.readFileSync(path.join(SCRIPTS, "..", "assets", "rules.default.json"), "utf8"));
  rules.categories.concurrency.diff = [];
  const proposed = path.join(w.base, "proposed.json");
  fs.writeFileSync(proposed, JSON.stringify(rules));
  const r = w.run("bench.mjs", ["--proposed", proposed]);
  assert.equal(r.code, 1);
  assert.match(r.out, /MORE PERMISSIVE  gate-concurrency-abort: gate\/check → go\/no check/);
  assert.match(r.out, /case\(s\) fail/);
});

// ---- analyse ----

test("analyse reports from both logs and the record", () => {
  const w = world();
  w.run("record.mjs", ["update", "idempotency", "--evidence", "explain: Two runs without a key", "--status", "learning"]);
  w.run("log.mjs", ["checkpoint", JSON.stringify({ task: "t1", tier: "gate", outcome: "passed", cats: ["concurrency"], concepts: ["idempotency"], evidence: "explain", help: 0, turns: 2, skip_reflex: 1 })]);
  w.run("log.mjs", ["checkpoint", JSON.stringify({ task: "t2", tier: "check", outcome: "passed", concepts: ["intl"], help: 1, turns: 3 })]);
  fs.appendFileSync(path.join(w.proj, ".learning", "events.jsonl"), [
    { d: `${TODAY}T09:00:00Z`, by: "mod", e: "gate_close", ms: 90000 },
    { d: `${TODAY}T09:00:01Z`, by: "mod", e: "edit_refused", tier: "gate" },
    { d: `${TODAY}T09:00:02Z`, by: "mod", e: "triage", tier: "gate", what: "concurrency: retry" },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");
  const r = w.run("analyse.mjs", ["--write"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /unaided passes: 1 of 2/);
  assert.match(r.out, /gate time open \(mod\): median 90s over 1 gates/);
  assert.match(r.out, /edits refused by the gate \(mod\): 1/);
  assert.match(r.out, /triage by tier: gate 1/);
  assert.match(r.out, new RegExp(`${TODAY} t2: intl passed with no evidence line that day`));
  assert.match(r.out, /skip reflex by week: \d{4}-W\d{2} 1/);
  assert.ok(w.exists(`.learning/reports/${TODAY}.md`));
});

test("analyse --git lists a risky commit with no gate that day", () => {
  const w = world();
  w.run("setup.mjs");
  fs.mkdirSync(path.join(w.proj, "src", "auth"), { recursive: true });
  fs.writeFileSync(path.join(w.proj, "src", "auth", "session.ts"), "export const token = read()\n");
  const git = (...args) => execFileSync("git", ["-C", w.proj, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  git("add", "-A");
  git("commit", "-qm", "auth");
  const r = w.run("analyse.mjs", ["--git", "7"]);
  assert.match(r.out, /## Possible misses \(git\)\n- [0-9a-f]{8} \d{4}-\d{2}-\d{2} security: no gate that day/);
});

test("the ISO week is right", async () => {
  const { report } = await import(path.join(SCRIPTS, "analyse.mjs"));
  const text = report([{ d: "2026-10-09T10:00:00Z", e: "checkpoint", task: "t", tier: "gate", outcome: "passed", skip_reflex: 2 }], []);
  assert.match(text, /skip reflex by week: 2026-W41 2/);
});
