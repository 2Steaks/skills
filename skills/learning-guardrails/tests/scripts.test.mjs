// Tests for the skill's scripts. Each runs the real CLI in a throwaway project with a throwaway HOME.
// Run: node --test tests/*.test.mjs
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
  // Each run is one Claude Code session; "s1" unless a test says otherwise (null: none given).
  const run = (script, args = [], cwd = proj, session = "s1", extra = {}) => {
    const env = { ...process.env, HOME: home };
    for (const name of ["CLAUDE_CODE_SESSION_ID", "LEARNING_GATE_SESSION", "CLAUDECODE"]) delete env[name];
    Object.assign(env, session === null ? {} : { CLAUDE_CODE_SESSION_ID: session }, extra);
    const r = spawnSync("node", [path.join(SCRIPTS, script), ...args], { cwd, env, encoding: "utf8" });
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
  for (const p of [".learning/session.md", ".learning/events.jsonl", ".learning/project", ".learning/locks"]) assert.ok(w.exists(p), p);
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
  const r = w.run("lock.mjs", ["open", "gate", "concurrency", "One", "run", "or", "two,", "and", "why?", "--task", "Make claimSlot safe"]);
  assert.equal(r.code, 0, r.err);
  const lock = w.read(".learning/locks/s1.lock");
  assert.equal(lock.split("\n")[0], "GATE · concurrency · One run or two, and why?");
  assert.match(lock, /^task: Make claimSlot safe$/m);
  assert.match(lock, /^opened: \d{4}-\d{2}-\d{2}T/m);
  assert.match(w.read(".git/info/exclude"), /^\.learning\/$/m);
  assert.match(w.run("lock.mjs", ["open", "GATE", "concurrency", "Smaller: one or two?"]).out, /^relocked/);
  assert.equal(w.run("lock.mjs", ["show"]).out, "GATE · concurrency · Smaller: one or two?");
  assert.match(w.read(".learning/locks/s1.lock"), /^task: Make claimSlot safe$/m);
});

test("lock refuses GO, a CHECK, a bad label, a missing question and a missing task", () => {
  const w = world();
  assert.match(w.run("lock.mjs", ["open", "GO", "x", "Why?"]).err, /GO never locks/);
  assert.match(w.run("lock.mjs", ["open", "CHECK", "intl", "What does narrow change?"]).err, /a CHECK never locks/);
  assert.match(w.run("lock.mjs", ["open", "GATE", "a · b", "Why?"]).err, /label/);
  assert.match(w.run("lock.mjs", ["open", "GATE", "state"]).err, /question missing/);
  assert.match(w.run("lock.mjs", ["open", "GATE", "state", "Who owns it?"]).err, /--task/);
  assert.equal(w.exists(".learning/locks/s1.lock"), false);
});

test("closing needs a reason the skill allows; a skip isn't one, and a pause keeps it", () => {
  const w = world();
  w.run("lock.mjs", ["open", "GATE", "state", "Who owns this state?", "--task", "Filters"]);
  const skip = w.run("lock.mjs", ["close", "skip"]);
  assert.equal(skip.code, 1);
  assert.match(skip.err, /A skip isn't one/);
  assert.match(w.run("lock.mjs", ["close", "paused"]).err, /lock\.mjs pause/);
  assert.ok(w.exists(".learning/locks/s1.lock"));
  assert.equal(w.run("lock.mjs", ["close", "passed"]).out, "unlocked (passed)");
  assert.equal(w.run("lock.mjs", ["show"]).out, "none in this session");
  assert.equal(w.run("lock.mjs", ["close", "abandoned"]).out, "no lock was open in this session");
});

test("a lock opened from a subfolder lands at the project root", () => {
  const w = world();
  w.run("setup.mjs");
  w.run("lock.mjs", ["open", "GATE", "state", "Who owns this state?", "--task", "Filters"], path.join(w.proj, "src"));
  assert.ok(w.exists(".learning/locks/s1.lock"));
  assert.equal(fs.existsSync(path.join(w.proj, "src", ".learning")), false);
});

test("sessions each get their own lock and never touch each other's", () => {
  const w = world();
  w.run("lock.mjs", ["open", "GATE", "data", "Two writes, one crash: what's saved?", "--task", "Save the credential"], w.proj, "s1");
  assert.equal(w.run("lock.mjs", ["show"], w.proj, "s2").out, "none in this session");
  assert.equal(w.run("lock.mjs", ["close", "passed"], w.proj, "s2").out, "no lock was open in this session");
  w.run("lock.mjs", ["open", "GATE", "state", "Who owns the filter?", "--task", "Add a filter"], w.proj, "s2");
  assert.ok(w.exists(".learning/locks/s1.lock") && w.exists(".learning/locks/s2.lock"));
  w.run("lock.mjs", ["close", "passed"], w.proj, "s1");
  assert.equal(w.exists(".learning/locks/s1.lock"), false);
  assert.equal(w.run("lock.mjs", ["show"], w.proj, "s2").out, "GATE · state · Who owns the filter?");
});

test("pause keeps a checkpoint for later; another session lists it and picks it up", () => {
  const w = world();
  w.run("lock.mjs", ["open", "GATE", "concurrency", "Two claims at once: who owns the slot?", "--task", "Make claimSlot safe"], w.proj, "s1");
  const paused = w.run("lock.mjs", ["pause", "--step", "step 2 of 3"], w.proj, "s1");
  assert.equal(paused.code, 0, paused.err);
  const id = paused.out.match(/paused as (paused-[\w]+)/)[1];
  assert.equal(w.run("lock.mjs", ["show"], w.proj, "s1").out, "none in this session");
  const listed = w.run("lock.mjs", ["list"], w.proj, "s2").out;
  assert.match(listed, new RegExp(`^1 unfinished, newest first:\\n${id} · paused · just now · Make claimSlot safe$`, "m"));
  assert.match(listed, /^ {2}GATE · concurrency · Two claims at once: who owns the slot\?$/m);
  assert.match(listed, /^ {2}got to: step 2 of 3$/m);
  assert.equal(w.run("lock.mjs", ["resume", id], w.proj, "s2").code, 0);
  const lock = w.read(".learning/locks/s2.lock");
  assert.equal(lock.split("\n")[0], "GATE · concurrency · Two claims at once: who owns the slot?");
  assert.match(lock, /^step: step 2 of 3$/m);
  assert.doesNotMatch(lock, /^paused:/m);
  assert.equal(w.run("lock.mjs", ["list"], w.proj, "s2").out, "none unfinished");
  assert.match(w.run("lock.mjs", ["list"], w.proj, "s3").out, /^s2 · open in another session/m);
});

test("list shows other sessions' open checkpoints, newest first; resume and drop take ids", () => {
  const w = world();
  w.run("lock.mjs", ["open", "GATE", "data", "Older question?", "--task", "Older task"], w.proj, "s1");
  const old = path.join(w.proj, ".learning", "locks", "s1.lock");
  fs.writeFileSync(old, fs.readFileSync(old, "utf8").replace(/^opened: .*$/m, "opened: 2026-01-01T00:00:00.000Z"));
  w.run("lock.mjs", ["open", "GATE", "state", "Newer question?", "--task", "Newer task"], w.proj, "s2");
  const listed = w.run("lock.mjs", ["list"], w.proj, "s3").out.split("\n").filter((l) => !l.startsWith(" "));
  assert.deepEqual(listed.map((l) => l.split(" · ")[0]), ["2 unfinished, newest first:", "s2", "s1"]);
  assert.match(listed[1], /open in another session/);
  assert.match(w.run("lock.mjs", ["list"], w.proj, "s2").out, /^1 unfinished/);
  w.run("lock.mjs", ["open", "GATE", "security", "Mine?", "--task", "Mine"], w.proj, "s3");
  assert.match(w.run("lock.mjs", ["resume", "s1"], w.proj, "s3").err, /already has a checkpoint open/);
  assert.match(w.run("lock.mjs", ["resume", "nope"], w.proj, "s4").err, /no unfinished checkpoint "nope"/);
  assert.match(w.run("lock.mjs", ["drop", "s1"], w.proj, "s3").out, /^dropped s1: Older task$/);
  assert.equal(w.exists(".learning/locks/s1.lock"), false);
});

test("the mod's session id wins; with no id at all, every session shares one lock, and says so", () => {
  const w = world();
  w.run("lock.mjs", ["open", "GATE", "data", "Which write lands?", "--task", "Save it"], w.proj, "c1", { LEARNING_GATE_SESSION: "m1" });
  assert.ok(w.exists(".learning/locks/m1.lock"));
  assert.equal(w.exists(".learning/locks/c1.lock"), false);
  const bare = w.run("lock.mjs", ["open", "GATE", "state", "Who owns it?", "--task", "Own it"], w.proj, null, { CLAUDECODE: "1" });
  assert.match(bare.err, /every session in this project shares one lock/);
  assert.ok(w.exists(".learning/locks/local.lock"));
  assert.equal(w.run("lock.mjs", ["show"], w.proj, null).out, "GATE · state · Who owns it?");
  assert.equal(w.run("lock.mjs", ["show"], w.proj, null).err, "");
});

test("a lock from before sessions were tracked is listed, and resumes into this session", () => {
  const w = world();
  w.run("setup.mjs");
  fs.writeFileSync(path.join(w.proj, ".learning", "gate.lock"), "GATE · concurrency · One run or two?\n");
  assert.match(w.run("lock.mjs", ["list"]).out, /^legacy · from before sessions were tracked · .* · \(no task given\)$/m);
  assert.equal(w.run("lock.mjs", ["resume", "legacy"]).code, 0);
  assert.equal(w.exists(".learning/gate.lock"), false);
  assert.equal(w.run("lock.mjs", ["show"]).out, "GATE · concurrency · One run or two?");
});

test("pick puts the right answer at A, B or C evenly; lock.mjs open says where too", async () => {
  const { pick } = await import(path.join(SCRIPTS, "pick.mjs"));
  const counts = { A: 0, B: 0, C: 0 };
  for (let i = 0; i < 3000; i++) counts[pick()]++;
  for (const n of Object.values(counts)) assert.ok(n > 850 && n < 1150, JSON.stringify(counts));
  assert.deepEqual(Object.keys(counts).sort(), ["A", "B", "C"]);
  const w = world();
  assert.match(w.run("pick.mjs").out, /^right answer at: [ABC]$/);
  assert.match(w.run("pick.mjs", ["9"]).err, /2 to 8/);
  assert.match(w.run("lock.mjs", ["open", "GATE", "data", "Which write lands?", "--task", "Save it"]).out, /\nright answer at: [ABC]$/);
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
  assert.match(bad("checkpoint", { task: "t1", tier: "gate", outcome: "declined" }).err, /only a CHECK can be declined/);
  assert.equal(w.exists(".learning/events.jsonl") ? w.read(".learning/events.jsonl").trim() : "", "");
});

test("log: a CHECK can be declined, and the audit counts it", () => {
  const w = world();
  assert.equal(w.run("log.mjs", ["checkpoint", JSON.stringify({ task: "t1", tier: "check", outcome: "declined", concepts: ["intl"] })]).code, 0);
  assert.match(w.run("analyse.mjs").out, /checkpoints: 1 · declined 1/);
});

test("architecture is logged and reported, but has no rule patterns", () => {
  const w = world();
  const logged = w.run("log.mjs", ["checkpoint", JSON.stringify({ task: "t1", tier: "gate", outcome: "passed", cats: ["architecture"], concepts: ["url-state"], evidence: "explain", help: 0 })]);
  assert.equal(logged.code, 0, logged.err);
  assert.equal(w.run("log.mjs", ["diff_review", JSON.stringify({ task: "t1", triaged: "go", actual: "gate", added: ["architecture"] })]).code, 0);
  assert.match(w.run("analyse.mjs").out, /checkpoints by category: architecture 1/);
  fs.mkdirSync(path.join(w.home, ".learning"), { recursive: true });
  fs.writeFileSync(path.join(w.home, ".learning", "rules.json"), JSON.stringify({ version: 2, categories: { architecture: { paths: ["x"] } } }));
  const bad = w.run("bench.mjs");
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown category "architecture"/);
});

// ---- bench ----

const ASSETS = path.join(SCRIPTS, "..", "assets");
const ABORT = "\\bAbortController\\b|\\.abort\\(\\)|\\bsignal\\s*[:,)}]";
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
};

test("bench: every seed case passes on the shipped packs", () => {
  const w = world();
  const r = w.run("bench.mjs");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^rules: assets\/rules \(\d+ packs\)$/m);
  const [, total, passed] = r.out.match(/(\d+) cases · (\d+) pass · 0 fail/);
  assert.equal(total, passed);
  assert.ok(Number(total) > 100, total);
});

test("bench: every pack ships with its own benchmark cases", () => {
  const packs = fs.readdirSync(path.join(ASSETS, "rules")).filter((f) => f.endsWith(".json"));
  assert.ok(packs.length >= 12, packs.join(", "));
  for (const pack of packs) assert.ok(fs.existsSync(path.join(ASSETS, "benchmarks", pack.replace(/\.json$/, ".jsonl"))), `cases for ${pack}`);
});

test("bench: a rule change that loosens the gate is flagged and fails", () => {
  const w = world();
  const proposed = path.join(w.base, "proposed.json");
  writeJson(proposed, { version: 2, remove: { concurrency: { diff: [ABORT] } } });
  const r = w.run("bench.mjs", ["--proposed", proposed]);
  assert.equal(r.code, 1);
  assert.match(r.out, /MORE PERMISSIVE  gate-concurrency-abort: gate\/check → go\/no check/);
  assert.match(r.out, /case\(s\) fail/);
});

test("bench: your layer in ~/.learning applies in every project, and the project's goes on top", () => {
  const w = world();
  writeJson(path.join(w.home, ".learning", "rules.json"), { version: 2, remove: { concurrency: { diff: [ABORT] } } });
  const mine = w.run("bench.mjs");
  assert.equal(mine.code, 1);
  assert.match(mine.out, /^rules: assets\/rules \(\d+ packs\) \+ ~\/\.learning\/rules\.json$/m);
  assert.match(mine.out, /FAIL  gate-concurrency-abort/);
  writeJson(path.join(w.proj, ".learning", "rules.json"), { version: 2, categories: { concurrency: { diff: ["\\bAbortController\\b"] } } });
  const both = w.run("bench.mjs");
  assert.equal(both.code, 0, both.out);
  assert.match(both.out, /\+ ~\/\.learning\/rules\.json \+ \.\/\.learning\/rules\.json$/m);
});

test("bench: an old full copy in a project replaces everything below it, as before", () => {
  const w = world();
  writeJson(path.join(w.proj, ".learning", "rules.json"), { version: 1, categories: { security: { diff: ["dangerouslySetInnerHTML"] } } });
  const r = w.run("bench.mjs");
  assert.equal(r.code, 1);
  assert.match(r.out, /^rules: \.\/\.learning\/rules\.json$/m);
  assert.match(r.out, /PASS  gate-security-html/);
  assert.match(r.out, /FAIL  py-security-shell/);
});

test("bench: layers say when a removal matches nothing, and refuse a misspelt category", () => {
  const w = world();
  const layer = path.join(w.home, ".learning", "rules.json");
  writeJson(layer, { version: 2, remove: { security: { diff: ["\\bnot-a-pattern\\b"] } } });
  assert.match(w.run("bench.mjs").out, /note: .*removes security\.diff \\bnot-a-pattern\\b, which nothing below it has/);
  writeJson(layer, { version: 2, categories: { secruity: { diff: ["x"] } } });
  const bad = w.run("bench.mjs");
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown category "secruity"/);
});

test("bench: a layer can make comment lines count again", () => {
  const w = world();
  assert.match(w.run("bench.mjs").out, /PASS  core-go-comment-in-code/);
  writeJson(path.join(w.home, ".learning", "rules.json"), { version: 2, go: { commentOnly: false } });
  const r = w.run("bench.mjs");
  assert.match(r.out, /FAIL  go-comment-only/);
  assert.match(r.out, /FAIL  core-go-comment-in-code/);
});

test("parseDiff keeps each line with its file, deleted files and paths with spaces included", async () => {
  const { parseDiff } = await import(path.join(SCRIPTS, "rules.mjs"));
  const diff = [
    "diff --git a/db/migrations/0001_init.sql b/db/migrations/0001_init.sql",
    "deleted file mode 100644",
    "--- a/db/migrations/0001_init.sql",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-CREATE TABLE runs (id int);",
    "--- a removed SQL comment",
    "diff --git a/release notes/v2.md b/release notes/v2.md",
    "--- a/release notes/v2.md\t",
    "+++ b/release notes/v2.md\t",
    "@@ -0,0 +1 @@",
    "+- Retry the socket",
  ].join("\n");
  const { files, lines } = parseDiff(diff);
  assert.deepEqual(files, ["db/migrations/0001_init.sql", "release notes/v2.md"]);
  assert.deepEqual(lines, [
    { file: "db/migrations/0001_init.sql", text: "CREATE TABLE runs (id int);" },
    { file: "db/migrations/0001_init.sql", text: "-- a removed SQL comment" },
    { file: "release notes/v2.md", text: "- Retry the socket" },
  ]);
});

test("bench: your cases add to the shipped ones, and a case with the same id replaces it", () => {
  const w = world();
  const base = w.run("bench.mjs").out.match(/(\d+) cases/)[1];
  const cases = [
    { id: "go-copy-label", kind: "trivial", files: ["src/components/StartButton.tsx"], diff: ["+  <Button>Go</Button>"], expected: { tier: "gate" } },
    { id: "mine-websocket", kind: "high-risk", files: ["src/live.ts"], diff: ["+  const ws = new WebSocket(url)"], record: { status: "none" }, expected: { tier: "gate", cats: ["concurrency"] } },
  ];
  writeJson(path.join(w.home, ".learning", "benchmarks", "cases.jsonl"), cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  const r = w.run("bench.mjs");
  assert.match(r.out, new RegExp(`${Number(base) + 1} cases · ${Number(base)} pass · 1 fail`));
  assert.match(r.out, /FAIL  go-copy-label/);
  assert.match(r.out, /PASS  mine-websocket/);
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

test("analyse --git reads each file with its own stack's rules, and skips prose", () => {
  const w = world();
  w.run("setup.mjs");
  const git = (...args) => execFileSync("git", ["-C", w.proj, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
  fs.writeFileSync(path.join(w.proj, "src", "parse.ts"), "export const first = (re, s) => re.exec(s)\n");
  fs.writeFileSync(path.join(w.proj, "CHANGELOG.md"), "- Retry the WebSocket with a token\n");
  git("add", "-A");
  git("commit", "-qm", "harmless");
  assert.match(w.run("analyse.mjs", ["--git", "7"]).out, /## Possible misses \(git\)\n- none found/);
  fs.mkdirSync(path.join(w.proj, "app"), { recursive: true });
  fs.writeFileSync(path.join(w.proj, "app", "run.py"), "subprocess.run(cmd, shell=True)\n");
  git("add", "-A");
  git("commit", "-qm", "shell");
  const r = w.run("analyse.mjs", ["--git", "7"]);
  assert.match(r.out, /## Possible misses \(git\)\n- [0-9a-f]{8} \d{4}-\d{2}-\d{2} security: no gate that day\. Review, not a verdict\.$/);
});

test("the ISO week is right", async () => {
  const { report } = await import(path.join(SCRIPTS, "analyse.mjs"));
  const text = report([{ d: "2026-10-09T10:00:00Z", e: "checkpoint", task: "t", tier: "gate", outcome: "passed", skip_reflex: 2 }], []);
  assert.match(text, /skip reflex by week: 2026-W41 2/);
});
