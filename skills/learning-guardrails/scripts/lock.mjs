#!/usr/bin/env node
// lock.mjs: opens and closes the gate. The lock is one line, `TIER · label · question`,
// read by the learning-gate mod (and the fallback hook) to refuse code edits.
// Usage:
//   node lock.mjs open <CHECK|GATE> <label> <question...>   (rewrites an open lock: same gate)
//   node lock.mjs close <passed|paused|abandoned|override>
//   node lock.mjs show
import fs from "node:fs";
import { fail, isMain, lockPath, projectRoot } from "./lib.mjs";
import { setup } from "./setup.mjs";

const REASONS = ["passed", "paused", "abandoned", "override"];

export function open(tierRaw, labelRaw, words, start = process.cwd()) {
  const tier = String(tierRaw ?? "").toUpperCase();
  if (!["CHECK", "GATE"].includes(tier)) fail("tier must be CHECK or GATE. GO never locks.");
  const label = String(labelRaw ?? "").trim();
  if (label === "" || label.length > 40 || label.includes("·")) {
    fail("label: 1-40 characters, no '·'. The category for a GATE, the concept for a CHECK, or 'own it'.");
  }
  const question = words.join(" ").replace(/\s+/g, " ").trim();
  if (question === "") fail("question missing: the question exactly as you ask it.");
  if (question.length > 300) fail(`question is ${question.length} characters. Keep it under ~200: it's pinned above the prompt.`);
  const { root } = setup(start); // the first lock in a project sets the record up, privacy included
  const file = lockPath(root);
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, `${tier} · ${label} · ${question}\n`);
  return { file, existed, line: `${tier} · ${label} · ${question}` };
}

export function close(reason, start = process.cwd()) {
  if (!REASONS.includes(reason)) {
    fail(`closing needs a reason the skill allows: ${REASONS.join(" | ")}. A skip isn't one.`);
  }
  const file = lockPath(projectRoot(start));
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

export function show(start = process.cwd()) {
  const file = lockPath(projectRoot(start));
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "open") {
    const [tier, label, ...words] = rest;
    const { existed, line } = open(tier, label, words);
    console.log(`${existed ? "relocked" : "locked"}: ${line}`);
    if (line.length > 220) console.log("note: long for the band above the prompt; it will wrap");
  } else if (cmd === "close") {
    console.log(close(rest[0]) ? `unlocked (${rest[0]})` : "no lock was open");
  } else if (cmd === "show") {
    console.log(show() ?? "none");
  } else {
    fail("usage: lock.mjs open <CHECK|GATE> <label> <question...> | close <passed|paused|abandoned|override> | show");
  }
}
