#!/usr/bin/env node
// learning-gate.mjs: blocks code edits while a learning-guardrails checkpoint is open.
// Lock: <project>/.learning/gate.lock, written by the skill when it asks, deleted when the user passes.
// Hook: PreToolUse on Edit|MultiEdit|Write|NotebookEdit in ~/.claude/settings.json.
// Exit 2 blocks the edit; anything else fails open, so a broken gate never locks you out.
// Usage: node learning-gate.mjs --install | --test | --uninstall  (--uninstall is the user's call, never Claude's)
// --install copies this file to ~/.claude/hooks/learning-gate.mjs and registers that copy.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const INSTALLED = path.join(os.homedir(), ".claude", "hooks", "learning-gate.mjs");
const COMMAND = `node "${INSTALLED}"`;
const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const MATCHER = "Edit|MultiEdit|Write|NotebookEdit";
const mode = process.argv[2];

if (mode === "--install" || mode === "--uninstall") manage(mode);
else if (mode === "--test") selfTest();
else gate();

function gate() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
  const message = check(input);
  if (!message) process.exit(0);
  process.stderr.write(message + "\n");
  process.exit(2);
}

// Returns null to allow, or the reason the edit is blocked.
function check(input) {
  const toolInput = input.tool_input ?? {};
  const cwd = input.cwd || process.cwd();
  const target = toolInput.file_path ?? toolInput.notebook_path;
  const file = target ? path.resolve(cwd, target) : "";
  if (file && file.split(path.sep).includes(".learning")) return null; // the record can always update
  const lock = findLock([file && path.dirname(file), process.env.CLAUDE_PROJECT_DIR, cwd]);
  if (!lock) return null;
  const question = fs.readFileSync(lock, "utf8").trim() || "(see .learning/session.md)";
  return [
    "Learning checkpoint open: code edits are refused until the user shows they understand.",
    `Open question: ${question}`,
    "If the learning-guardrails skill is loaded, re-ask the question, options and all, and wait for the answer. If it isn't, tell the user, and that calling /learning-guardrails continues it. Don't load it yourself.",
    `Close the checkpoint (delete ${lock}) only as that skill allows. Never offer the user a way around it.`,
  ].join("\n");
}

// Walks up from each start dir looking for .learning/gate.lock.
function findLock(starts) {
  for (const start of starts) {
    if (!start) continue;
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
      const lock = path.join(dir, ".learning", "gate.lock");
      if (fs.existsSync(lock)) return lock;
      if (path.dirname(dir) === dir) break;
    }
  }
  return null;
}

function manage(mode) {
  let settings = {};
  if (fs.existsSync(SETTINGS)) {
    const raw = fs.readFileSync(SETTINGS, "utf8");
    try { settings = raw.trim() ? JSON.parse(raw) : {}; }
    catch { console.error(`${SETTINGS} isn't valid JSON. Nothing changed.`); process.exit(1); }
    fs.writeFileSync(`${SETTINGS}.bak`, raw);
  }
  const hooks = (settings.hooks ??= {});
  const groups = (hooks.PreToolUse ??= []);
  if (!Array.isArray(groups)) { console.error("hooks.PreToolUse isn't a list. Nothing changed."); process.exit(1); }
  const ours = (hook) => String(hook?.command ?? "").includes("learning-gate.mjs");
  hooks.PreToolUse = groups.filter((group) => {
    if (!Array.isArray(group?.hooks)) return true;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter((hook) => !ours(hook));
    return group.hooks.length > 0 || before === 0;
  });
  if (mode === "--install") {
    if (path.resolve(SELF) !== path.resolve(INSTALLED)) {
      fs.mkdirSync(path.dirname(INSTALLED), { recursive: true });
      fs.copyFileSync(SELF, INSTALLED);
    }
    hooks.PreToolUse.push({ matcher: MATCHER, hooks: [{ type: "command", command: COMMAND, timeout: 10 }] });
  }
  if (!hooks.PreToolUse.length) delete hooks.PreToolUse;
  if (!Object.keys(hooks).length) delete settings.hooks;
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Edit gate ${mode === "--install" ? "installed in" : "removed from"} ${SETTINGS}`);
}

function selfTest() {
  delete process.env.CLAUDE_PROJECT_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "learning-gate-"));
  fs.mkdirSync(path.join(root, ".learning"));
  const edit = (file) => check({ cwd: root, tool_name: "Edit", tool_input: { file_path: path.join(root, file) } });
  const results = [["no lock: code edit allowed", edit("src/a.ts") === null]];
  fs.writeFileSync(path.join(root, ".learning", "gate.lock"), "GATE · test · Why?");
  results.push(["lock: code edit blocked", edit("src/a.ts")?.includes("Why?") === true]);
  results.push(["lock: record edit allowed", edit(".learning/session.md") === null]);
  fs.rmSync(root, { recursive: true, force: true });
  let registered = false;
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
    registered = (settings.hooks?.PreToolUse ?? []).some((group) =>
      (group.hooks ?? []).some((hook) => hook.command === COMMAND));
  } catch {}
  results.push([`hook registered in ${SETTINGS}`, registered && fs.existsSync(INSTALLED)]);
  for (const [name, ok] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}
