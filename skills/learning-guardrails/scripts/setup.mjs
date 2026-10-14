#!/usr/bin/env node
// setup.mjs: the first run in a project. Creates the record and keeps it out of git
// (the repo's own .git/info/exclude, never the team's .gitignore). Safe to run any time.
// Usage: node setup.mjs [--gate mod|hook|declined]
import fs from "node:fs";
import path from "node:path";
import { excludeFile, fail, generalDir, home, isMain, learningDir, parseArgs, projectDir, projectRoot } from "./lib.mjs";

const SESSION = `## Now
- Task: none
- Open checkpoint: none
## Parked
## Setup
- Gate: unknown            # mod | hook | declined
`;

export function setup(start = process.cwd()) {
  const root = projectRoot(start);
  const dir = learningDir(root);
  const created = [];
  for (const d of [dir, projectDir(root), generalDir()]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(d);
    }
  }
  for (const [name, text] of [["session.md", SESSION], ["events.jsonl", ""]]) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, text);
      created.push(file);
    }
  }
  return { root, created, git: keepPrivate(root) };
}

function keepPrivate(root) {
  const exclude = excludeFile(root);
  if (exclude === null) return "not a git repo";
  const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  if (/^\/?\.learning\/?$/m.test(text)) return "already kept out of git";
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.writeFileSync(exclude, `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}.learning/\n`);
  return "kept out of git (local exclude)";
}

export function setGate(root, gate) {
  const file = path.join(learningDir(root), "session.md");
  const text = fs.readFileSync(file, "utf8");
  const line = `- Gate: ${gate.padEnd(18)}# mod | hook | declined`;
  fs.writeFileSync(file, /^- Gate:.*$/m.test(text) ? text.replace(/^- Gate:.*$/m, line) : `${text.trimEnd()}\n## Setup\n${line}\n`);
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const { root, created, git } = setup();
  if (flags.gate !== undefined) {
    if (!["mod", "hook", "declined"].includes(flags.gate)) fail("--gate must be mod, hook or declined");
    setGate(root, flags.gate);
  }
  console.log(`root: ${root}`);
  const shown = (p) => (p.startsWith(root + path.sep) ? path.relative(root, p) : p.startsWith(home() + path.sep) ? `~/${path.relative(home(), p)}` : p);
  console.log(`record: ${created.length > 0 ? `created ${created.map(shown).join(", ")}` : "already set up"}`);
  console.log(`git: ${git}`);
}
