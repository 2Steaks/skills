#!/usr/bin/env node
// lock.mjs: the gate, one lock per Claude Code session, so sessions in the same project never
// block each other. A lock's first line is `TIER · category · question`, read by the learning-gate
// mod (and the fallback hook) to refuse this session's code edits; `key: value` lines follow.
// Only a GATE locks. A paused checkpoint keeps its file, unenforced, until it's resumed or dropped.
// Usage:
//   node lock.mjs open GATE <category> <question...> --task "<what you're building>"   (again: same gate)
//   node lock.mjs close <passed|abandoned|override>
//   node lock.mjs pause [--step "<where you'd got to>"]
//   node lock.mjs list            unfinished checkpoints, newest first: paused, or open in another session
//   node lock.mjs resume <id>     one of them, in this session
//   node lock.mjs drop <id>       one of them, gone
//   node lock.mjs show
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fail, isMain, legacyLockPath, lockPath, locksDir, parseArgs, projectRoot, sessionKnown } from "./lib.mjs";
import { setup } from "./setup.mjs";

const REASONS = ["passed", "abandoned", "override"];
const LEGACY = "legacy";

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
  if (reason === "paused") fail("pausing keeps the checkpoint: lock.mjs pause --step \"<where you'd got to>\".");
  if (!REASONS.includes(reason)) fail(`closing needs a reason the skill allows: ${REASONS.join(" | ")}. A skip isn't one.`);
  const file = lockPath(projectRoot(start));
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

// This session's checkpoint, kept for later under an id of its own. Nothing enforces it.
export function pause(flags = {}, start = process.cwd()) {
  const root = projectRoot(start);
  const file = lockPath(root);
  if (!fs.existsSync(file)) fail("no checkpoint is open in this session.");
  const lock = readLock(file);
  let id = `paused-${Date.now().toString(36)}`;
  while (fs.existsSync(path.join(locksDir(root), `${id}.lock`))) id += "x";
  const step = flags.step === undefined || flags.step === true ? lock.fields.step : oneLine(flags.step);
  writeLock(path.join(locksDir(root), `${id}.lock`), lock.line, { ...lock.fields, step, paused: new Date().toISOString() });
  fs.rmSync(file);
  return { id, task: lock.fields.task ?? "" };
}

// Every unfinished checkpoint but this session's own, newest first.
export function list(start = process.cwd()) {
  const root = projectRoot(start);
  const own = lockPath(root);
  const found = [];
  const dir = locksDir(root);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".lock")).map((f) => path.join(dir, f)) : [];
  for (const file of files) {
    if (file === own) continue;
    const id = path.basename(file, ".lock");
    found.push({ id, file, where: id.startsWith("paused-") ? "paused" : "open in another session" });
  }
  if (fs.existsSync(legacyLockPath(root))) found.push({ id: LEGACY, file: legacyLockPath(root), where: "from before sessions were tracked" });
  return found
    .map((c) => {
      const lock = readLock(c.file);
      const when = Date.parse(lock.fields.paused ?? lock.fields.opened ?? "") || fs.statSync(c.file).mtimeMs;
      return { ...c, ...lock, when };
    })
    .sort((a, b) => b.when - a.when);
}

const find = (id, start) => {
  if (!/^[\w-]+$/.test(String(id ?? ""))) fail("which one? lock.mjs list shows the ids.");
  const hit = list(start).find((c) => c.id === id);
  if (!hit) fail(`no unfinished checkpoint "${id}": lock.mjs list shows the ids.`);
  return hit;
};

// One of them, moved into this session: its lock now holds here.
export function resume(id, start = process.cwd()) {
  const root = projectRoot(start);
  const own = lockPath(root);
  if (fs.existsSync(own)) fail("this session already has a checkpoint open: answer it, or pause it first.");
  const hit = find(id, start);
  const { paused, ...fields } = hit.fields;
  writeLock(own, hit.line, { ...fields, resumed: new Date().toISOString() });
  fs.rmSync(hit.file);
  return hit;
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
    `  ${c.tier} · ${c.label} · ${c.question || c.line}`,
    ...(c.fields.step ? [`  got to: ${c.fields.step}`] : []),
    ...(c.fields.branch ? [`  branch: ${c.fields.branch}`] : []),
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
    if (line.length > 220) console.log("note: long for the band above the prompt; it will wrap");
  } else if (cmd === "close") {
    console.log(close(args[0]) ? `unlocked (${args[0]})` : "no lock was open in this session");
  } else if (cmd === "pause") {
    const { id, task } = pause(flags);
    console.log(`paused as ${id}${task ? `: ${task}` : ""}. It shows in lock.mjs list until it's resumed or dropped.`);
  } else if (cmd === "list") {
    const all = list();
    console.log(all.length ? `${all.length} unfinished, newest first:\n${all.map(describe).join("\n")}` : "none unfinished");
  } else if (cmd === "resume") {
    const hit = resume(args[0]);
    console.log(`resumed in this session (locked):\n${describe({ ...hit, where: "was " + hit.where })}`);
  } else if (cmd === "drop") {
    const hit = drop(args[0]);
    console.log(`dropped ${hit.id}: ${hit.fields.task || hit.line}`);
  } else if (cmd === "show") {
    console.log(show() ?? "none in this session");
  } else {
    fail("usage: lock.mjs open GATE <category> <question...> --task \"...\" | close <passed|abandoned|override> | pause [--step \"...\"] | list | resume <id> | drop <id> | show");
  }
}
