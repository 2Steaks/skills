#!/usr/bin/env node
// pick.mjs: where the right option goes, picked at random, so the position gives nothing away.
// A model left to choose keeps landing on the same letter. Run it before writing each question.
// Usage: node pick.mjs [<options>]   (default 3: A-C; "Not sure yet" always comes last)
import { randomInt } from "node:crypto";
import { fail, isMain } from "./lib.mjs";

export const pick = (options = 3) => "ABCDEFGH"[randomInt(options)];

if (isMain(import.meta.url)) {
  const n = Number(process.argv[2] ?? 3);
  if (!Number.isInteger(n) || n < 2 || n > 8) fail("options: a whole number from 2 to 8.");
  console.log(`right answer at: ${pick(n)}`);
}
