// rules.mjs: the triage rules, in layers.
//   1. every pack in assets/rules/: one per stack, shipped with the skill
//   2. ~/.learning/rules.json: your layer, for every project
//   3. <project>/.learning/rules.json: the project's layer, for what's true of that codebase alone
// A pack's path patterns see every changed file; its diff patterns only see changed lines from files
// in its `files` scope (no scope: every file). Comment lines don't count, unless a layer sets
// "go": {"commentOnly": false}. Files matching an `ignore` pattern (docs, lock files, vendored code)
// don't count at all.
// A layer ("version": 2) adds patterns and removes them by exact string, `ignore` included. A rules
// file without "version": 2 is an old full copy: it replaces everything below it.
// Deterministic: no network, randomness or AI. The engagement judgement stays with Claude.
// Usage: node rules.mjs floor    writes the rules in force to .learning/floor.json, for the learning-gate mod
//        node rules.mjs check    what the rules flag in the work not yet committed
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATS, fail, home, isMain, projectRoot } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PACKS = path.join(HERE, "..", "assets", "rules");
const KINDS = ["paths", "diff", "diffExact"];

// Blank, or a comment in most languages. `#[` is a Rust or PHP attribute and `*p` a dereference: code.
const COMMENT = /^\s*$|^\s*(\/\/|\/\*|\*(\s|\/|$)|#(?!!?\[)|<!--)/;
export const isComment = (line) => COMMENT.test(line);

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    fail(`${file}: not found.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${file} isn't valid JSON. Nothing changed.`);
  }
}

// Pattern lists by category and kind. Unknown names fail: a typo would drop patterns silently.
function patterns(raw, where) {
  for (const [cat, kinds] of Object.entries(raw ?? {})) {
    if (!CATS.includes(cat)) fail(`${where}: unknown category "${cat}". Use ${CATS.join(", ")}.`);
    for (const kind of Object.keys(kinds ?? {})) {
      if (!KINDS.includes(kind)) fail(`${where}: unknown list "${cat}.${kind}". Use ${KINDS.join(", ")}.`);
    }
  }
  return Object.fromEntries(CATS.map((cat) => [cat, Object.fromEntries(KINDS.map((k) => [k, [...(raw?.[cat]?.[k] ?? [])]]))]));
}

const list = (value, where) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${where} must be a list of patterns.`);
  return [...value];
};

export function readPack(file, raw = readJson(file)) {
  return {
    name: raw.pack ?? path.basename(file, ".json"),
    files: raw.files === undefined ? null : list(raw.files, `${file}: files`),
    ignore: list(raw.ignore, `${file}: ignore`),
    categories: patterns(raw.categories, file),
  };
}

export const readPacks = (dir = PACKS) =>
  fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readPack(path.join(dir, f)));

// The layer files in force for a project: yours, then the project's.
export function layerFiles(root = projectRoot()) {
  const mine = path.join(home(), ".learning", "rules.json");
  const project = path.join(root, ".learning", "rules.json");
  return [...new Set([mine, project])].filter((f) => fs.existsSync(f));
}

// Puts one rules file on top: a pack (added, or replacing the pack of that name), a layer
// (its removals, then its additions), or an old full copy (replacing everything below it).
export function apply(set, file) {
  const raw = readJson(file);
  const sources = [...set.sources, file];
  if (raw.pack !== undefined) {
    const pack = readPack(file, raw);
    return { ...set, packs: [...set.packs.filter((p) => p.name !== pack.name), pack], sources };
  }
  const commentOnly = raw.go?.commentOnly;
  const added = { name: file, files: null, ignore: list(raw.ignore, `${file}: ignore`), categories: patterns(raw.categories, file) };
  if (raw.version !== 2) return { packs: [added], commentOnly: commentOnly !== false, sources: [file], warnings: set.warnings };

  const { ignore: dropIgnore, ...dropRest } = raw.remove ?? {};
  const remove = patterns(dropRest, `${file} (remove)`);
  const unignore = list(dropIgnore, `${file}: remove.ignore`);
  const warnings = [...set.warnings];
  for (const cat of CATS) {
    for (const k of KINDS) {
      for (const re of remove[cat][k]) {
        if (!set.packs.some((p) => p.categories[cat][k].includes(re))) warnings.push(`${file} removes ${cat}.${k} ${re}, which nothing below it has`);
      }
    }
  }
  for (const re of unignore) if (!set.packs.some((p) => p.ignore.includes(re))) warnings.push(`${file} removes ignore ${re}, which nothing below it has`);
  const kept = (p) => ({
    ...p,
    ignore: p.ignore.filter((re) => !unignore.includes(re)),
    categories: Object.fromEntries(CATS.map((cat) => [cat, Object.fromEntries(KINDS.map((k) => [k, p.categories[cat][k].filter((re) => !remove[cat][k].includes(re))]))])),
  });
  return { packs: [...set.packs.map(kept), added], commentOnly: commentOnly === undefined ? set.commentOnly : commentOnly !== false, sources, warnings };
}

function compile(set) {
  const re = (patternList, flags, where) =>
    patternList.map((p) => {
      try {
        return new RegExp(p, flags);
      } catch {
        fail(`${where}: bad pattern ${p}`);
      }
    });
  const packs = set.packs.map((p) => ({
    name: p.name,
    scope: p.files === null ? null : re(p.files, "i", p.name),
    categories: Object.fromEntries(CATS.map((cat) => {
      const c = p.categories[cat];
      return [cat, { paths: re(c.paths, "i", p.name), diff: [...re(c.diff, "i", p.name), ...re(c.diffExact, "", p.name)] }];
    })),
  }));
  const ignore = set.packs.flatMap((p) => re(p.ignore, "i", p.name));
  return { packs, ignore, commentOnly: set.commentOnly, sources: set.sources, warnings: set.warnings };
}

// The rules in force for a project: every pack, your layer, the project's layer, then `extra` files.
export function loadRules({ root = projectRoot(), extra = [], packs = PACKS } = {}) {
  let set = { packs: readPacks(packs), commentOnly: true, sources: [packs], warnings: [] };
  for (const file of [...layerFiles(root), ...extra]) set = apply(set, file);
  return compile(set);
}

// Every pattern a change matches. A line is { file, text }, or a bare string that belongs to
// every changed file (the benchmark's form).
export function matches(allFiles = [], lines = [], rules) {
  const seen = new Map();
  const ignored = (f) => {
    if (!seen.has(f)) seen.set(f, (rules.ignore ?? []).some((re) => re.test(f)));
    return seen.get(f);
  };
  const files = allFiles.filter((f) => !ignored(f));
  const counts = (text) => rules.commentOnly === false || !isComment(text);
  const rows = lines
    .map((l) => (typeof l === "string" ? { file: null, text: l } : l))
    .filter((r) => counts(r.text) && (r.file === null ? files.length > 0 || allFiles.length === 0 : !ignored(r.file)));
  const inScope = (pack, file) => pack.scope === null || (file === null ? files : [file]).some((f) => pack.scope.some((re) => re.test(f)));
  const found = [];
  for (const pack of rules.packs) {
    const scoped = rows.filter((r) => inScope(pack, r.file));
    for (const cat of CATS) {
      const { paths, diff } = pack.categories[cat];
      for (const re of paths) for (const f of files) if (re.test(f)) found.push({ cat, pack: pack.name, pattern: re.source, file: f });
      for (const re of diff) for (const r of scoped) if (re.test(r.text)) found.push({ cat, pack: pack.name, pattern: re.source, file: r.file, text: r.text });
    }
  }
  return found;
}

// The risk categories a change points at, in the usual order.
export function signals(files = [], lines = [], rules) {
  const cats = new Set(matches(files, lines, rules).map((m) => m.cat));
  return CATS.filter((cat) => cats.has(cat));
}

// A path from a ---/+++ line: without git's quotes, its a/ or b/ prefix, or the tab git adds after
// a path with a space in it.
const diffPath = (raw, prefix) => {
  let p = raw.replace(/\t$/, "");
  if (p.length > 1 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).replace(/\\(["\\])/g, "$1");
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
};

// A unified diff's changed files, and its changed lines with the file each belongs to.
// A deleted file keeps its old path, so its lines still count.
export function parseDiff(text) {
  const files = [];
  const lines = [];
  let header = false;
  let from = null;
  let file = null;
  for (const l of String(text ?? "").split("\n")) {
    if (l.startsWith("diff --git ")) {
      header = true;
      from = null;
      file = null;
    } else if (l.startsWith("@@")) header = false;
    else if (header) {
      if (l.startsWith("--- ")) from = l === "--- /dev/null" ? null : diffPath(l.slice(4), "a/");
      else if (l.startsWith("+++ ")) {
        file = l === "+++ /dev/null" ? from : diffPath(l.slice(4), "b/");
        if (file !== null && !files.includes(file)) files.push(file);
      }
    } else if (/^[+-]/.test(l)) lines.push({ file, text: l.slice(1) });
  }
  return { files, lines };
}

// A short description of where the rules came from, for report headers.
export function describe(rules, root = projectRoot()) {
  const short = (f) => (f === PACKS ? `assets/rules (${readPacks(f).length} packs)` : f.replace(root, ".").replace(home(), "~"));
  return rules.sources.map(short).join(" + ");
}

// ---- the floor, for the learning-gate mod ----

// The rules in force as plain JSON. The mod checks each edit against them before it lands, with
// its own copy of matches() (plugins/learning-gate/hooks/floor.mjs), held to this one by the tests.
export function floorOf(rules, root = projectRoot()) {
  const src = (list) => list.map((re) => re.source);
  return {
    version: 1,
    sources: describe(rules, root),
    commentOnly: rules.commentOnly !== false,
    comment: COMMENT.source,
    ignore: src(rules.ignore),
    packs: rules.packs.map((p) => ({
      name: p.name,
      files: p.scope === null ? null : src(p.scope),
      categories: Object.fromEntries(CATS.map((cat) => {
        const { paths, diff } = p.categories[cat];
        return [cat, { paths: src(paths), diff: src(diff.filter((re) => re.flags.includes("i"))), diffExact: src(diff.filter((re) => !re.flags.includes("i"))) }];
      })),
    })),
  };
}

export const floorPath = (root) => path.join(root, ".learning", "floor.json");

export function writeFloor(root = projectRoot()) {
  const floor = floorOf(loadRules({ root }), root);
  fs.mkdirSync(path.dirname(floorPath(root)), { recursive: true });
  fs.writeFileSync(floorPath(root), `${JSON.stringify(floor)}\n`);
  return floor;
}

// ---- check: the work not yet committed ----

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// Tracked changes against HEAD (the empty tree before the first commit), plus new files. Null outside git.
export function workingChanges(root) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  let base;
  try {
    git("rev-parse", "--is-inside-work-tree");
    base = (() => {
      try {
        git("rev-parse", "--verify", "-q", "HEAD");
        return "HEAD";
      } catch {
        return EMPTY_TREE;
      }
    })();
  } catch {
    return null;
  }
  const { files, lines } = parseDiff(git("diff", base, "--unified=0", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"));
  for (const file of git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean)) {
    const full = path.join(root, file);
    let text;
    try {
      if (fs.statSync(full).size > 1024 * 1024) continue;
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue; // binary
    files.push(file);
    for (const line of text.split("\n")) lines.push({ file, text: line });
  }
  return { files, lines };
}

// Each flagged category with up to three examples: the file and the line, or the path pattern.
export function flagged(found) {
  const out = [];
  for (const cat of CATS) {
    const hits = found.filter((m) => m.cat === cat);
    if (hits.length === 0) continue;
    const seen = new Set();
    const shown = [];
    for (const m of hits) {
      const what = m.text === undefined ? `${m.file} (path)` : `${m.file ?? "?"} "${m.text.trim().slice(0, 60)}"`;
      if (!seen.has(what) && shown.length < 3) shown.push(what);
      seen.add(what);
    }
    out.push(`- ${cat}: ${shown.join(" · ")}${seen.size > shown.length ? ` · +${seen.size - shown.length} more` : ""}`);
  }
  return out;
}

if (isMain(import.meta.url)) {
  const [cmd] = process.argv.slice(2);
  const root = projectRoot();
  if (cmd === "floor") {
    const floor = writeFloor(root);
    console.log(`floor: ${path.relative(root, floorPath(root))} (${floor.sources})`);
  } else if (cmd === "check") {
    const changes = workingChanges(root);
    if (changes === null) fail("check reads git: this isn't a git repo.");
    const lines = flagged(matches(changes.files, changes.lines, loadRules({ root })));
    console.log(lines.length ? `The packs flag (review, not a verdict):\n${lines.join("\n")}` : "The packs flag nothing in the uncommitted work.");
  } else {
    fail("usage: rules.mjs floor | check");
  }
}
