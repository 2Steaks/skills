// lib.mjs: shared helpers for the learning-guardrails scripts. Node 18+, no dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CATS = ["data", "concurrency", "security", "performance", "state", "contracts"];
// What triage and checkpoints can log: the rules' categories, plus architecture, which is
// judged on the plan (SKILL.md §1) and has no patterns.
export const LOG_CATS = [...CATS, "architecture"];
export const STATUSES = ["unfamiliar", "learning", "demonstrated", "needs-reinforcement"];
export const EVIDENCE = ["predict", "explain", "debug", "experiment", "transfer"];
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const home = () => process.env.HOME || os.homedir();
export const generalDir = () => path.join(home(), ".learning", "general");
export const today = () => new Date().toISOString().slice(0, 10);
export const now = () => new Date().toISOString();

export const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// The project a record belongs to: the nearest .learning/ above `start` (never
// the one under HOME, which holds general concepts), else the git root, else `start`.
export function projectRoot(start = process.cwd()) {
  const homeLearning = path.join(home(), ".learning");
  let gitRoot = null;
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const learning = path.join(dir, ".learning");
    if (learning !== homeLearning && isDir(learning)) return dir;
    if (gitRoot === null && fs.existsSync(path.join(dir, ".git"))) gitRoot = dir;
    if (path.dirname(dir) === dir) break;
  }
  return gitRoot ?? path.resolve(start);
}

export const learningDir = (root) => path.join(root, ".learning");
// This session: the learning-gate mod's id when it's on (the id it enforces), else the one Claude
// Code gives its shell. Neither: "local", one lock shared by the whole project.
export const sessionId = () =>
  String(process.env.LEARNING_GATE_SESSION || process.env.CLAUDE_CODE_SESSION_ID || "local").replace(/[^\w-]/g, "") || "local";
export const sessionKnown = () => sessionId() !== "local";
export const locksDir = (root) => path.join(root, ".learning", "locks");
export const lockPath = (root, id = sessionId()) => path.join(locksDir(root), `${id}.lock`);
export const legacyLockPath = (root) => path.join(root, ".learning", "gate.lock");
export const eventsPath = (root) => path.join(root, ".learning", "events.jsonl");
export const projectDir = (root) => path.join(root, ".learning", "project");

// The repo's local exclude file (.git/info/exclude), following a worktree's .git file.
export function excludeFile(root) {
  const dotgit = path.join(root, ".git");
  let gitDir;
  try {
    if (fs.statSync(dotgit).isDirectory()) gitDir = dotgit;
    else {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotgit, "utf8"));
      if (!m) return null;
      gitDir = path.resolve(root, m[1].trim());
    }
  } catch {
    return null;
  }
  let common = gitDir;
  try {
    common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim());
  } catch {}
  return path.join(common, "info", "exclude");
}

export function fail(message) {
  console.error(message);
  process.exit(1);
}

// True when this module is the script node was asked to run.
export const isMain = (url) => process.argv[1] !== undefined && url === pathToFileURL(path.resolve(process.argv[1])).href;

// Flags as `--name value` (repeatable) or bare `--name`; the rest are positional.
export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : (i++, next);
    flags[name] = flags[name] === undefined ? value : [].concat(flags[name], value);
  }
  return { flags, rest };
}
