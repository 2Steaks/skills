#!/usr/bin/env node
// lock.mjs: the gate, one lock per Claude Code session, so sessions in the same project never
// block each other. A lock's first line is `TIER · category · question`, read by the learning-gate
// mod (and the fallback hook) to refuse this session's code edits; `key: value` lines follow.
// Only a GATE locks. A task with a plan is tracked in <session>.task as it goes, so a session that
// ends mid-task loses nothing. When the user chooses to pause, the checkpoint (if one is open) and
// the tracked task are kept under a paused-* id, unenforced, until they're resumed (/pickup) or dropped.
// Usage:
//   node lock.mjs open GATE <category> <question...> --task "<what you're building>"   (again: same gate)
//   node lock.mjs close <passed|abandoned|override>           (abandoned drops the tracked task too)
//   node lock.mjs track --task "<task>" [--step "<what's done>"] [--next "<the next step>"] [--plan "<steps left>"]
//   node lock.mjs track --done    the task is finished
//   node lock.mjs pause [--task …] [--step …] [--next …] [--plan …]   (what's tracked fills in the rest)
//   node lock.mjs list            unfinished work, newest first: paused, open or tracked in another session
//   node lock.mjs resume <id>     one of them, in this session (a checkpoint locks again; a task is tracked here)
//   node lock.mjs drop <id>       one of them, gone
//   node lock.mjs show
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fail, isMain, legacyLockPath, lockPath, locksDir, parseArgs, projectRoot, sessionId, sessionKnown } from "./lib.mjs";
import { pick } from "./pick.mjs";
import { setup } from "./setup.mjs";

const REASONS = ["passed", "abandoned", "override"];
const LEGACY = "legacy";
const now = () => new Date().toISOString();

// The task this session is working through: never a lock, never enforced.
export const taskPath = (root, id = sessionId()) => path.join(locksDir(root), `${id}.task`);

// A lock: its first line, split, and the `key: value` fields after it.
export function readLock(file) {
  const [first = "", ...rest] = fs.readFileSync(file, "utf8").split("\n");
  const fields = {};
  for (const line of rest) {
    const m = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (m) fields[m[1]] = m[2];
  }
  const [tier = "", label = "", ...question] = first.trim().split(" · ");
  return { line: first.trim(), tier, label, question: question.join(" · "), fields };
}

function writeLock(file, line, fields) {
  const kept = Object.entries(fields).filter(([, v]) => v !== undefined && v !== "");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${line}\n${kept.map(([k, v]) => `${k}: ${v}\n`).join("")}`);
}

const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const MAX_WORDS = 25;
export const wordCount = (text) => oneLine(text).split(" ").filter((w) => /\w/.test(w)).length;

function branch(root) {
  try {
    return execFileSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export function open(tierRaw, labelRaw, words, flags = {}, start = process.cwd()) {
  const tier = String(tierRaw ?? "").toUpperCase();
  if (tier === "CHECK") fail("a CHECK never locks: ask it once the step is built.");
  if (tier !== "GATE") fail("tier must be GATE. GO never locks.");
  const label = String(labelRaw ?? "").trim();
  if (label === "" || label.length > 40 || label.includes("·")) {
    fail("label: 1-40 characters, no '·'. The GATE's category (concurrency, architecture).");
  }
  const question = oneLine(words.join(" "));
  if (question === "") fail("question missing: the question exactly as you ask it.");
  if (question.length > 300) fail(`question is ${question.length} characters. Keep it under ~200: it's pinned above the prompt.`);
  const n = wordCount(question);
  if (n > MAX_WORDS) fail(`question is ${n} words. Questions are ≤${MAX_WORDS} (SKILL.md §3): cut it, then open again.`);
  const { root } = setup(start); // the first lock in a project sets the record up, privacy included
  const file = lockPath(root);
  const existed = fs.existsSync(file);
  const before = existed ? readLock(file).fields : {};
  const task = oneLine(flags.task === true ? "" : flags.task ?? before.task);
  if (task === "") fail('--task "<what you\'re building>" missing: it names this checkpoint if it\'s picked up later.');
  if (task.length > 120) fail("--task: keep it under 120 characters, one line.");
  const line = `${tier} · ${label} · ${question}`;
  writeLock(file, line, { task, step: before.step, branch: before.branch ?? branch(root), opened: before.opened ?? new Date().toISOString() });
  return { file, existed, line };
}

export function close(reason, start = process.cwd()) {
  if (reason === "paused") fail("pausing keeps the checkpoint: lock.mjs pause.");
  if (!REASONS.includes(reason)) fail(`closing needs a reason the skill allows: ${REASONS.join(" | ")}. A skip isn't one.`);
  const root = projectRoot(start);
  // A dropped task takes its tracking with it.
  if (reason === "abandoned" && fs.existsSync(taskPath(root))) fs.rmSync(taskPath(root));
  const file = lockPath(root);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

const LIMITS = { task: 120, step: 200, next: 200, plan: 400 };

function given(flags) {
  const out = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    if (flags[key] === undefined || flags[key] === true) continue;
    out[key] = oneLine(flags[key]);
    if (out[key].length > max) fail(`--${key}: keep it under ${max} characters, one line.`);
  }
  return out;
}

const tracked = (root) => (fs.existsSync(taskPath(root)) ? readLock(taskPath(root)) : null);

// Keep the task's progress as it goes: at the plan, and after each step. --done when it's finished.
export function track(flags = {}, start = process.cwd()) {
  const root = projectRoot(start);
  const file = taskPath(root);
  if (flags.done) {
    const had = tracked(root);
    if (had !== null) fs.rmSync(file);
    return { done: true, task: had?.fields.task ?? null };
  }
  const before = tracked(root)?.fields ?? {};
  const g = given(flags);
  const task = g.task || before.task || "";
  if (task === "") fail('--task "<what you\'re doing>" missing: it names the work if it\'s picked up later.');
  const step = g.step ?? before.step;
  const next = g.next ?? before.next;
  if (!step && !next) fail('say what\'s done (--step) or what comes next (--next).');
  setup(start);
  const fields = { task, step, next, plan: g.plan ?? before.plan, branch: before.branch ?? branch(root), opened: before.opened ?? now(), updated: now() };
  writeLock(file, `TASK · work · ${next || step}`, fields);
  return { done: false, task, next, step };
}

// Files changed and not committed, for the recap: the pause never stashes or commits anything.
function changed(root) {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const files = out.split("\n").map((l) => l.slice(3).trim()).filter((f) => f && !f.startsWith(".learning"));
    return files.length > 5 ? `${files.slice(0, 5).join(", ")} (+${files.length - 5} more)` : files.join(", ");
  } catch {
    return "";
  }
}

// Whatever this session is doing, kept for later under an id of its own. Nothing enforces it.
// With a checkpoint open, the checkpoint goes with it; with none, it's kept as a TASK.
export function pause(flags = {}, start = process.cwd()) {
  const root = projectRoot(start);
  const file = lockPath(root);
  const lock = fs.existsSync(file) ? readLock(file) : null;
  const work = tracked(root)?.fields ?? {};
  const g = given(flags);
  // What's given wins, then what's tracked (the most recent progress), then the checkpoint's own fields.
  const pick = (k) => g[k] ?? work[k] ?? lock?.fields[k];
  const task = g.task || work.task || lock?.fields.task || "";
  if (task === "") fail('--task "<what you\'re doing>" missing: nothing is tracked to take it from.');
  if (lock === null && !pick("step") && !pick("next")) fail('say where you\'d got to (--step) or what comes next (--next), so it can be picked up.');
  setup(start); // a pause before any checkpoint still keeps the record out of git
  let id = `paused-${Date.now().toString(36)}`;
  while (fs.existsSync(path.join(locksDir(root), `${id}.lock`))) id += "x";
  const line = lock?.line ?? `TASK · work · ${pick("next") || pick("step")}`;
  const fields = {
    ...(lock?.fields ?? {}),
    task,
    step: pick("step"),
    next: pick("next"),
    plan: pick("plan"),
    changed: changed(root),
    branch: lock?.fields.branch ?? work.branch ?? branch(root),
    opened: lock?.fields.opened ?? work.opened ?? now(),
    paused: now(),
  };
  writeLock(path.join(locksDir(root), `${id}.lock`), line, fields);
  if (lock !== null) fs.rmSync(file);
  if (fs.existsSync(taskPath(root))) fs.rmSync(taskPath(root));
  return { id, task, checkpoint: lock !== null };
}

// Everything unfinished, newest first: paused work, checkpoints open in other sessions, and tasks
// being tracked: another session's (one that ended mid-task leaves one) or this one's own.
// This session's open checkpoint isn't listed: it's already in front of them.
export function list(start = process.cwd()) {
  const root = projectRoot(start);
  const ownTask = taskPath(root);
  const found = [];
  const dir = locksDir(root);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const file = path.join(dir, name);
    if (file === lockPath(root)) continue;
    if (file === ownTask) {
      found.push({ id: name, file, where: "tracked in this session" });
      continue;
    }
    if (name.endsWith(".lock")) {
      const id = path.basename(name, ".lock");
      found.push({ id, file, where: id.startsWith("paused-") ? "paused" : "open in another session" });
    } else if (name.endsWith(".task")) {
      found.push({ id: name, file, where: "tracked in another session" });
    }
  }
  if (fs.existsSync(legacyLockPath(root))) found.push({ id: LEGACY, file: legacyLockPath(root), where: "from before sessions were tracked" });
  return found
    .map((c) => {
      const lock = readLock(c.file);
      const when = Date.parse(lock.fields.paused ?? lock.fields.updated ?? lock.fields.opened ?? "") || fs.statSync(c.file).mtimeMs;
      return { ...c, ...lock, when };
    })
    .sort((a, b) => b.when - a.when);
}

const find = (id, start) => {
  if (!/^[\w.-]+$/.test(String(id ?? ""))) fail("which one? lock.mjs list shows the ids.");
  const hit = list(start).find((c) => c.id === id);
  if (!hit) fail(`no unfinished checkpoint "${id}": lock.mjs list shows the ids.`);
  return hit;
};

// One of them, moved into this session. A checkpoint's lock holds here again; a task just comes back.
export function resume(id, start = process.cwd()) {
  const root = projectRoot(start);
  const own = lockPath(root);
  const hit = find(id, start);
  const here = branch(root);
  const moved = hit.fields.branch && here && hit.fields.branch !== here ? { from: hit.fields.branch, to: here } : null;
  if (hit.file === taskPath(root)) return { ...hit, locked: false, moved }; // already this session's
  const { paused, changed: _, ...fields } = hit.fields;
  const work = fields.next || fields.plan || hit.tier === "TASK";
  if (work && fs.existsSync(taskPath(root))) fail("this session is already tracking a task: finish it (track --done) or pause it first.");
  if (hit.tier !== "TASK" && fs.existsSync(own)) fail("this session already has a checkpoint open: answer it, or pause it first.");
  // The task carries on here, tracked; a checkpoint locks again.
  if (work) writeLock(taskPath(root), `TASK · work · ${fields.next || fields.step || hit.question}`, { task: fields.task, step: fields.step, next: fields.next, plan: fields.plan, branch: fields.branch, opened: fields.opened, updated: now() });
  if (hit.tier !== "TASK") writeLock(own, hit.line, { ...fields, resumed: now() });
  fs.rmSync(hit.file);
  return { ...hit, locked: hit.tier !== "TASK", moved };
}

export function drop(id, start = process.cwd()) {
  const hit = find(id, start);
  fs.rmSync(hit.file);
  return hit;
}

export function show(start = process.cwd()) {
  const file = lockPath(projectRoot(start));
  return fs.existsSync(file) ? readLock(file).line : null;
}

export function age(ms, now = Date.now()) {
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 2) return "just now";
  if (min < 90) return `${min} min ago`;
  const hours = Math.round(min / 60);
  return hours < 36 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

const describe = (c) =>
  [
    `${c.id} · ${c.where} · ${age(c.when)} · ${c.fields.task || "(no task given)"}`,
    c.tier === "TASK" ? "  no checkpoint open" : `  ${c.tier} · ${c.label} · ${c.question || c.line}`,
    ...["step", "next", "plan", "changed", "branch"].flatMap((k) => (c.fields[k] ? [`  ${k === "step" ? "got to" : k}: ${c.fields[k]}`] : [])),
  ].join("\n");

if (isMain(import.meta.url)) {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const [cmd, ...args] = rest;
  // Inside Claude Code with no session id, every session would take the others' lock for its own.
  if (!sessionKnown() && process.env.CLAUDECODE) {
    console.error("note: no session id (no learning-gate mod, and this Claude Code doesn't give one), so every session in this project shares one lock.");
  }
  if (cmd === "open") {
    const [tier, label, ...words] = args;
    const { existed, line } = open(tier, label, words, flags);
    console.log(`${existed ? "relocked" : "locked"} (this session): ${line}`);
    console.log(`right answer at: ${pick()}`);
    if (line.length > 220) console.log("note: long for the band above the prompt; it will wrap");
  } else if (cmd === "close") {
    console.log(close(args[0]) ? `unlocked (${args[0]})` : "no lock was open in this session");
  } else if (cmd === "track") {
    const t = track(flags);
    console.log(t.done ? (t.task ? `done: stopped tracking ${t.task}` : "nothing was tracked") : `tracking (this session): ${t.task}${t.next ? ` · next: ${t.next}` : ""}`);
  } else if (cmd === "pause") {
    const { id, task, checkpoint } = pause(flags);
    console.log(`paused as ${id}: ${task}${checkpoint ? " (its checkpoint too)" : ""}. /pickup, or lock.mjs list, brings it back.`);
  } else if (cmd === "list") {
    const all = list();
    console.log(all.length ? `${all.length} unfinished, newest first:\n${all.map(describe).join("\n")}` : "none unfinished");
  } else if (cmd === "resume") {
    const hit = resume(args[0]);
    console.log(`resumed in this session (${hit.locked ? "locked: re-ask its question" : "tracked here: carry on from the next step"}):\n${describe({ ...hit, where: "was " + hit.where })}`);
    if (hit.moved) console.log(`note: paused on branch ${hit.moved.from}; you're on ${hit.moved.to}. Say so before carrying on.`);
  } else if (cmd === "drop") {
    const hit = drop(args[0]);
    console.log(`dropped ${hit.id}: ${hit.fields.task || hit.line}`);
  } else if (cmd === "show") {
    console.log(show() ?? "none in this session");
    const t = tracked(projectRoot());
    if (t !== null) console.log(`tracking: ${t.fields.task}${t.fields.next ? ` · next: ${t.fields.next}` : ""}`);
  } else {
    fail("usage: lock.mjs open GATE <category> <question...> --task \"...\" | close <passed|abandoned|override> | track --task \"...\" [--step \"...\"] [--next \"...\"] [--plan \"...\"] | track --done | pause [--task \"...\" …] | list | resume <id> | drop <id> | show");
  }
}
