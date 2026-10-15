// floor.mjs: the rule packs' deterministic floor, as the learning-guardrails skill writes it to
// .learning/floor.json (rules.mjs floorOf). Plain JavaScript with no engine or Node APIs, so the
// skill's tests can hold floorMatches() to the skill's own matches(), case by case.

export const CATS = ['data', 'concurrency', 'security', 'performance', 'state', 'contracts']

// The JSON compiled to patterns, or null when it isn't a floor this version reads.
export function compileFloor(raw) {
  try {
    if (raw === null || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.packs)) return null
    const re = (list, flags) => (Array.isArray(list) ? list : []).map(p => new RegExp(p, flags))
    return {
      commentOnly: raw.commentOnly !== false,
      comment: new RegExp(typeof raw.comment === 'string' ? raw.comment : '^\\s*$'),
      ignore: re(raw.ignore, 'i'),
      packs: raw.packs.map(p => ({
        name: String(p.name),
        scope: Array.isArray(p.files) ? re(p.files, 'i') : null,
        categories: Object.fromEntries(
          CATS.map(cat => {
            const c = p.categories?.[cat] ?? {}
            return [cat, { paths: re(c.paths, 'i'), diff: [...re(c.diff, 'i'), ...re(c.diffExact, '')] }]
          }),
        ),
      })),
    }
  } catch {
    return null
  }
}

// Every pattern a change matches, as rules.mjs matches() finds them. A line is { file, text }, or a
// bare string that belongs to every changed file.
export function floorMatches(floor, allFiles = [], lines = []) {
  const seen = new Map()
  const ignored = f => {
    if (!seen.has(f)) seen.set(f, floor.ignore.some(re => re.test(f)))
    return seen.get(f)
  }
  const files = allFiles.filter(f => !ignored(f))
  const counts = text => floor.commentOnly === false || !floor.comment.test(text)
  const rows = lines
    .map(l => (typeof l === 'string' ? { file: null, text: l } : l))
    .filter(r => counts(r.text) && (r.file === null ? files.length > 0 || allFiles.length === 0 : !ignored(r.file)))
  const inScope = (pack, file) => pack.scope === null || (file === null ? files : [file]).some(f => pack.scope.some(re => re.test(f)))
  const found = []
  for (const pack of floor.packs) {
    const scoped = rows.filter(r => inScope(pack, r.file))
    for (const cat of CATS) {
      const { paths, diff } = pack.categories[cat]
      for (const re of paths) for (const f of files) if (re.test(f)) found.push({ cat, pack: pack.name, pattern: re.source, file: f })
      for (const re of diff) for (const r of scoped) if (re.test(r.text)) found.push({ cat, pack: pack.name, pattern: re.source, file: r.file, text: r.text })
    }
  }
  return found
}

// The risk categories a change points at, in the usual order.
export function floorSignals(floor, files = [], lines = []) {
  const cats = new Set(floorMatches(floor, files, lines).map(m => m.cat))
  return CATS.filter(cat => cats.has(cat))
}

// The lines an edit changes: those in `after` that `before` lacks, then those `before` had that
// `after` lacks, as a diff counts them. Order kept; a line repeated counts each time.
export function changedLines(before = '', after = '') {
  const split = text => (text === '' ? [] : String(text).replace(/\r\n/g, '\n').split('\n'))
  const minus = (a, b) => {
    const left = new Map()
    for (const line of b) left.set(line, (left.get(line) ?? 0) + 1)
    return a.filter(line => {
      const n = left.get(line) ?? 0
      if (n === 0) return true
      left.set(line, n - 1)
      return false
    })
  }
  const was = split(before)
  const now = split(after)
  return [...minus(now, was), ...minus(was, now)]
}
