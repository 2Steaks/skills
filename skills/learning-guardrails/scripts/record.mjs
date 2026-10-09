#!/usr/bin/env node
// record.mjs: the concept record, in one exact format the mod, /learned and the audit can read.
// It enforces the rules: evidence is append-only, a status never resets to unfamiliar, and
// demonstrated needs unaided evidence. Notes are words only: no code, no quotes from the chat.
// Usage:
//   node record.mjs find [words...]          concepts matching any word (all when none)
//   node record.mjs show <concept>           the general and project files
//   node record.mjs summary                  what the user has learned
//   node record.mjs update <concept> [--project] [--general <concept>] [--status <status>]
//        [--evidence "<type>: <note>"] [--unaided] [--context "<where>: <what>"]
//        [--gap "<text>"] [--close-gap "<text>"] [--requires a,b] [--related a,b]
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE, SLUG, STATUSES, fail, generalDir, isMain, parseArgs, projectDir, projectRoot, today } from "./lib.mjs";
import { setup } from "./setup.mjs";

const template = (slug, scope, general) => `---
concept: ${slug}
scope: ${scope}
general: ${general ?? "null"}
status: unfamiliar
requires: []
related: []
last_revisited: ${today()}
---
## Evidence

## Contexts

## Known gaps
`;

// ---- the file format ----

export function parse(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const front = [];
  let i = 0;
  if (lines[0] === "---") {
    i = 1;
    while (i < lines.length && lines[i] !== "---") front.push(lines[i++]);
    i++;
  }
  const sections = [];
  let current = null;
  for (; i < lines.length; i++) {
    const heading = /^## (.+?)\s*$/.exec(lines[i]);
    if (heading) sections.push((current = { title: heading[1], body: [] }));
    else if (current) current.body.push(lines[i]);
    else if (lines[i].trim()) sections.push((current = { title: "", body: [lines[i]] }));
  }
  for (const s of sections) {
    while (s.body.length && !s.body.at(-1).trim()) s.body.pop();
    while (s.body.length && !s.body[0].trim()) s.body.shift();
  }
  return { front, sections };
}

export function render({ front, sections }) {
  const out = ["---", ...front, "---"];
  for (const s of sections) {
    if (s.title) out.push(`## ${s.title}`);
    out.push(...s.body, "");
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

export const field = (doc, key) =>
  doc.front.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).replace(/\s#.*$/, "").trim();

function setField(doc, key, value) {
  const i = doc.front.findIndex((l) => l.startsWith(`${key}:`));
  if (i >= 0) doc.front[i] = `${key}: ${value}`;
  else doc.front.push(`${key}: ${value}`);
}

function section(doc, title) {
  let s = doc.sections.find((x) => x.title.toLowerCase() === title.toLowerCase());
  if (!s) doc.sections.push((s = { title, body: [] }));
  return s;
}

const bullets = (s) => s.body.filter((l) => /^\s*- /.test(l));
const listField = (doc, key) => (field(doc, key) ?? "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);

function addBullet(s, text) {
  const exists = bullets(s).some((l) => l.replace(/^\s*- /, "").trim().toLowerCase() === text.toLowerCase());
  if (!exists) s.body.push(`- ${text}`);
  return !exists;
}

const words = (text, what) => {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean === "" || clean.length > 160) fail(`${what}: one line, under 160 characters`);
  if (/[`{}]|=>/.test(clean)) fail(`${what}: words only. No code, no quotes from the chat.`);
  return clean;
};

// ---- commands ----

export function update(slug, flags, start = process.cwd()) {
  if (!SLUG.test(slug ?? "")) fail(`concept names are kebab-case (database-indexes): ${slug}`);
  const scope = flags.project ? "project" : "general";
  const root = projectRoot(start);
  const inProject = fs.existsSync(path.join(root, ".learning"));
  let dir;
  if (scope === "project") {
    setup(start);
    dir = projectDir(root);
  } else {
    dir = generalDir();
    fs.mkdirSync(dir, { recursive: true });
  }
  const where = scope === "project" || inProject ? path.basename(root) : null;
  const file = path.join(dir, `${slug}.md`);
  const isNew = !fs.existsSync(file);
  if (flags.general !== undefined && !SLUG.test(String(flags.general))) fail("--general takes a concept name");
  const doc = parse(isNew ? template(slug, scope, flags.general) : fs.readFileSync(file, "utf8"));
  const evidence = section(doc, "Evidence");
  const notes = [];

  for (const raw of [].concat(flags.evidence ?? [])) {
    const m = /^\s*([a-z]+)\s*:\s*([\s\S]+)$/.exec(String(raw));
    if (!m || !EVIDENCE.includes(m[1])) fail(`--evidence "<type>: <note>", type one of ${EVIDENCE.join(", ")}`);
    const note = words(m[2], "evidence note");
    evidence.body.push(`- ${today()} · ${m[1]} · ${note}${flags.unaided ? " (unaided)" : ""}${where ? ` (${where})` : ""}`);
    setField(doc, "last_revisited", today());
  }
  if (flags.status !== undefined) {
    const status = String(flags.status);
    if (!STATUSES.includes(status)) fail(`--status one of ${STATUSES.join(", ")}`);
    if (status === "unfamiliar" && bullets(evidence).length > 0) {
      fail("never reset to unfamiliar once there's evidence: use needs-reinforcement, or add a known gap");
    }
    if (status === "demonstrated" && !bullets(evidence).some((l) => l.includes("(unaided)"))) {
      fail("demonstrated needs unaided evidence: add --evidence \"...\" --unaided, or record learning");
    }
    setField(doc, "status", status);
  }
  for (const raw of [].concat(flags.context ?? [])) addBullet(section(doc, "Contexts"), words(raw, "context"));
  for (const raw of [].concat(flags.gap ?? [])) addBullet(section(doc, "Known gaps"), words(raw, "gap"));
  for (const raw of [].concat(flags["close-gap"] ?? [])) {
    const gaps = section(doc, "Known gaps");
    const before = gaps.body.length;
    gaps.body = gaps.body.filter((l) => !(/^\s*- /.test(l) && l.toLowerCase().includes(String(raw).toLowerCase())));
    notes.push(before === gaps.body.length ? `no gap matched "${raw}"` : `closed gap "${raw}"`);
  }
  for (const key of ["requires", "related"]) {
    if (flags[key] === undefined) continue;
    const add = String(flags[key]).split(",").map((x) => x.trim()).filter(Boolean);
    for (const s of add) if (!SLUG.test(s)) fail(`--${key} takes concept names: ${s}`);
    setField(doc, key, `[${[...new Set([...listField(doc, key), ...add])].join(", ")}]`);
  }
  if (flags.general !== undefined) setField(doc, "general", String(flags.general));

  fs.writeFileSync(file, render(doc));
  return { file, isNew, status: field(doc, "status"), notes };
}

export function list(start = process.cwd()) {
  const out = [];
  for (const [scope, dir] of [["general", generalDir()], ["project", projectDir(projectRoot(start))]]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      const doc = parse(fs.readFileSync(path.join(dir, name), "utf8"));
      out.push({
        slug: name.slice(0, -3),
        scope,
        status: field(doc, "status") || "unknown",
        gaps: bullets(section(doc, "Known gaps")).length,
        evidence: bullets(section(doc, "Evidence")),
        last: field(doc, "last_revisited") || "",
        file: path.join(dir, name),
      });
    }
  }
  return out;
}

const GROUPS = [
  ["demonstrated", "Demonstrated"],
  ["learning", "Learning"],
  ["needs-reinforcement", "Needs reinforcement"],
  ["unfamiliar", "Unfamiliar"],
];

export function summary(concepts) {
  if (concepts.length === 0) return "Nothing recorded yet. The record fills in as concepts come up.";
  const names = (l) => (l.length > 8 ? `${l.slice(0, 8).map((c) => c.slug).join(", ")}, +${l.length - 8} more` : l.map((c) => c.slug).join(", "));
  const lines = [`Learning record: ${concepts.length} concept${concepts.length === 1 ? "" : "s"}`];
  for (const [status, title] of GROUPS) {
    const l = concepts.filter((c) => c.status === status);
    if (l.length) lines.push(`${title} (${l.length}): ${names(l)}`);
  }
  const other = concepts.filter((c) => !GROUPS.some(([s]) => s === c.status));
  if (other.length) lines.push(`Other (${other.length}): ${names(other)}`);
  const gaps = concepts.reduce((n, c) => n + c.gaps, 0);
  if (gaps) lines.push(`Open gaps: ${gaps}`);
  return lines.join("\n");
}

if (isMain(import.meta.url)) {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseArgs(argv);
  if (cmd === "find") {
    const want = rest.join(" ").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const hits = list().filter((c) => want.length === 0 || want.some((w) => c.slug.includes(w)));
    console.log(hits.length === 0 ? "no record of that yet" : hits.map((c) => `${c.slug} · ${c.scope} · ${c.status} · gaps ${c.gaps} · last ${c.last}`).join("\n"));
  } else if (cmd === "show") {
    const hits = list().filter((c) => c.slug === rest[0]);
    console.log(hits.length === 0 ? `no record of ${rest[0]} yet` : hits.map((c) => `# ${c.scope}: ${c.file}\n${fs.readFileSync(c.file, "utf8")}`).join("\n"));
  } else if (cmd === "summary") {
    console.log(summary(list()));
  } else if (cmd === "update") {
    const { file, isNew, status, notes } = update(rest[0], flags);
    console.log(`${isNew ? "created" : "updated"}: ${file} (status: ${status})${notes.length ? `\n${notes.join("\n")}` : ""}`);
  } else {
    fail("usage: record.mjs find [words...] | show <concept> | summary | update <concept> [flags]");
  }
}
