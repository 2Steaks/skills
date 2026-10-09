// learning-gate: the enforcement half of the learning-guardrails skill.
// The skill is opt-in: Claude may load it only when the user's latest message runs
// /learning-guardrails or names it (/pickup and /audit do); any other attempt is refused.
// The skill writes .learning/gate.lock (one line: `TIER · category · question`)
// right before it asks a checkpoint question, and deletes it when the user
// passes, pauses, drops the task, or gives a valid override. While it exists:
// - code edits are refused, with the open question as the reason;
// - the question is pinned above the prompt;
// - every prompt carries it to the model, so it survives a compacted context.
// Edits inside any .learning/ folder always pass, so the record can update.
// A project's .learning/ is kept out of git via the repo's local exclude list.
// A reply that ends on a `👉 Your move:` question with no lock open opens one,
// so a checkpoint Claude forgot to lock still holds. It never overwrites a lock.
// It logs the mechanical events (triage, gate open/close, refusals) to
// .learning/events.jsonl as "by":"mod"; the skill logs the judgement calls.
// A hook that fails is skipped: the gate fails open, never locking you out.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GateLock } from '../types'

type Engine = EngineInterface

const lockState = atom({ plugin: 'learning-gate', key: 'lock' } as const, null)
const triageState = atom({ plugin: 'learning-gate', key: 'triage' } as const, null)
const activeState = atom({ plugin: 'learning-gate', key: 'active' } as const, false)
const namedState = atom({ plugin: 'learning-gate', key: 'named' } as const, false)

const LOCK = '.learning/gate.lock'
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const TRIAGE = /Guardrail · (GO|CHECK|GATE) · ([^\n`]+)/g
const SKILL = 'learning-guardrails'
const NAMES_SKILL = /learning[\s_-]*guardrails/i
const isThisSkill = (name: unknown) => typeof name === 'string' && (name === SKILL || name.endsWith(`:${SKILL}`))
const OPT_IN = `${SKILL} is opt-in: it loads only when the user runs /${SKILL} or names it. Carry on without it.`

const RULES = {
  id: 'learning-gate:rules',
  scope: 'session',
  text: [
    'The learning-gate plugin is installed. It enforces the checkpoints the learning-guardrails skill opens, and nothing else.',
    'The learning-guardrails skill is opt-in: load it only when the user runs /learning-guardrails or names it in their latest message. Never load it on your own, even for coding tasks.',
    `While ${LOCK} exists in the project, the plugin refuses code edits and pins the open question above the prompt. Close a checkpoint (delete the lock) only as the skill allows, and never offer the user a way around one.`,
    "The plugin replaces the skill's hook script: do not install learning-gate.mjs.",
  ].join('\n'),
} as const

const PICKUP =
  'Pick up where we left off, per the learning-guardrails skill: a three-line recap from .learning/session.md, then any open question in full.'
const AUDIT = 'Audit the learning guardrails, per section 10 of the learning-guardrails skill.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await Promise.all([
      $.command.register({ name: 'learned', description: 'Show what your learning record says you have demonstrated' }),
      $.command.register({ name: 'pickup', description: 'Pick up the open learning checkpoint where you left off' }),
      $.command.register({ name: 'audit', description: 'Audit the learning guardrails against their own logs' }),
    ])
    await refresh($)

    return next(e)
  })

  // Opt-in: the skill is in play once its prompt is expanded (/name, or an allowed Skill call).
  on('skill.prompt', async ($, e, next) => {
    if (isThisSkill(e.skill)) await update($, activeState, () => true)

    return next(e)
  })

  // The gate: refuse Claude loading the skill unasked, and code edits while a checkpoint is open.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    let touchesRecord = false

    if (tool === 'Skill' && isThisSkill((e as { skill?: unknown }).skill) && !(await read($, namedState))) {
      return { deny: OPT_IN }
    }

    if (EDIT_TOOLS.has(tool)) {
      const cwd = await $.session.cwd()
      const target = editTarget(e)
      const file = target === undefined ? undefined : resolvePath(cwd, target)
      touchesRecord = file !== undefined && isInRecord(file)

      if (!touchesRecord) {
        const lock = await readLock($, file === undefined ? [cwd] : [parentOf(file), cwd])
        if (lock !== null) {
          await setLock($, lock)
          await logEvent($, { e: 'edit_refused', tier: lock.tier.toLowerCase(), label: lock.category, tool })

          return { deny: blockMessage(lock, await read($, activeState)) }
        }
      }
    }

    const ran = await next(e)
    if (touchesRecord) {
      const target = editTarget(e)
      if (target !== undefined) await keepPrivate($, resolvePath(await $.session.cwd(), target))
    }
    // The lock is written with Write and deleted with Bash: look again after either.
    if (touchesRecord || tool === 'Bash') await refresh($)

    return ran
  }).catch(($, e, next) => next(e))

  // Keep the open question in front of the model on every prompt.
  on('prompt.submit', async ($, e, next) => {
    await update($, namedState, () => NAMES_SKILL.test(e.text))
    const lock = await refresh($)
    if (lock === null) return next(e)
    const note = (await read($, activeState))
      ? `Learning checkpoint open (${label(lock)}): "${lock.question}" ` +
        'Read this message as the answer unless it plainly is not one, and judge it by the learning-guardrails evidence bar. ' +
        `Code edits stay refused until the checkpoint closes: delete ${lock.path} only as the learning-guardrails skill allows.`
      : `A learning checkpoint from an earlier learning-guardrails session is still open (${label(lock)}): "${lock.question}" ` +
        'Code edits stay refused until it closes. Tell the user, and that /pickup continues it. Do not load the skill yourself.'

    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  // Always on: the rule rides in the system prompt, not on a skill match.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, RULES] }
  })

  // The status line: the open checkpoint, else the last triage line.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const text = e.message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n')
      const found = [...text.matchAll(TRIAGE)]
      const last = found.at(-1)?.[0].trim()
      if (last !== undefined) {
        await update($, triageState, () => last)
        showStatus($, await read($, lockState), last)
      }
      for (const [, tier, what] of found) {
        await logEvent($, { e: 'triage', tier: (tier ?? '').toLowerCase(), what: (what ?? '').trim().slice(0, 80) })
      }
      const asked = (await read($, activeState)) ? askedCheckpoint(text, await read($, triageState)) : null
      if (asked !== null) await lockIfOpen($, asked)
    }

    return next(e)
  })

  // The band above the prompt: the open question, pinned until answered.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lock = await read($, lockState)
    if (lock === null || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text color="warning" bold>
          🛑 Checkpoint open · {label(lock)}
        </Text>
        <Text wrap="wrap">{lock.question}</Text>
        <Text dimColor>Answer below. You can stop; you can't skip.</Text>
      </Box>
    )
  })

  on('command.run', { command: 'learned' }, async $ => ({ text: await learnedSummary($) }))

  on('command.run', { command: 'pickup' }, async $ => {
    void $.prompt.submit({ text: PICKUP, asUser: true })

    return {}
  })

  on('command.run', { command: 'audit' }, async $ => {
    void $.prompt.submit({ text: AUDIT, asUser: true })

    return {}
  })
}

// ---- the lock ----

async function refresh($: Engine): Promise<GateLock | null> {
  const lock = await readLock($, [await $.session.cwd()])
  await setLock($, lock)
  if (lock !== null) await keepPrivate($, lock.path)

  return lock
}

async function readLock($: Engine, starts: readonly string[]): Promise<GateLock | null> {
  const path = await findUp($, starts, LOCK)
  if (path === null) return null
  try {
    return parseLock(path, await $.fs.read(path))
  } catch {
    return null // deleted between the look and the read
  }
}

async function setLock($: Engine, lock: GateLock | null): Promise<void> {
  const before = await read($, lockState)
  if (JSON.stringify(before) !== JSON.stringify(lock)) {
    await update($, lockState, () => lock)
    if (before !== null && lock === null) $.ui.toast('Gate lifted. Carry on.')
  }
  await trackGate($, lock)
  showStatus($, lock, await read($, triageState))
}

// Which gates are open, by lock path, kept across sessions: a lock seen again
// in a new session is not a new gate, and a rewritten question is the same one.
type OpenGate = { at: number; tier: string; label: string }
const GATES = 'gates'

async function trackGate($: Engine, lock: GateLock | null): Promise<void> {
  try {
    const gates = { ...(((await $.store.get(GATES)) ?? {}) as Record<string, OpenGate>) }
    // A record deleted outright takes its open gate with it (nowhere left to log).
    let pruned = false
    for (const stored of Object.keys(gates)) {
      if (!(await $.fs.exists(parentOf(stored)))) {
        delete gates[stored]
        pruned = true
      }
    }
    if (pruned) await $.store.set(GATES, gates)
    const root = await projectRecord($)
    if (root === null) return
    const path = join(root, 'gate.lock')
    const open = gates[path]
    if (lock !== null && lock.path === path && open === undefined) {
      const at = await $.clock.now()
      await $.store.set(GATES, { ...gates, [path]: { at, tier: lock.tier, label: lock.category } })
      await logEvent($, { e: 'gate_open', tier: lock.tier.toLowerCase(), label: lock.category })
    } else if ((lock === null || lock.path !== path) && open !== undefined) {
      const rest = { ...gates }
      delete rest[path]
      await $.store.set(GATES, rest)
      const ms = (await $.clock.now()) - open.at
      await logEvent($, { e: 'gate_close', tier: open.tier.toLowerCase(), label: open.label, ms })
    }
  } catch {
    // tracking must never get in the way of the gate
  }
}

function showStatus($: Engine, lock: GateLock | null, triage: string | null): void {
  $.ui.status(lock !== null ? `🛑 Checkpoint open · ${label(lock)}` : (triage ?? undefined))
}

export function parseLock(path: string, text: string): GateLock {
  const line = text.trim().replace(/\s*\n\s*/g, ' ')
  const [tier, category, ...rest] = line.split(' · ')
  if (tier !== undefined && category !== undefined && rest.length > 0 && /^(GO|CHECK|GATE)$/i.test(tier.trim())) {
    return { path, tier: tier.trim().toUpperCase(), category: category.trim(), question: rest.join(' · ').trim() }
  }

  return { path, tier: 'CHECKPOINT', category: '', question: line || 'See .learning/session.md' }
}

const label = (lock: GateLock) => [lock.tier, lock.category].filter(Boolean).join(' · ')

const blockMessage = (lock: GateLock, active: boolean) =>
  active
    ? [
        'Learning checkpoint open: code edits are refused until the user shows they understand.',
        `Open question: ${lock.question}`,
        'Re-ask the question in full and end your turn.',
        `Close the checkpoint (delete ${lock.path}) only as the learning-guardrails skill allows. Never offer the user a way around it.`,
      ].join('\n')
    : [
        'A learning checkpoint from an earlier learning-guardrails session is still open, so code edits are refused.',
        `Open question: ${lock.question}`,
        'Tell the user, and that /pickup continues it. Do not load the skill yourself, and never offer a way around it.',
      ].join('\n')

function editTarget(e: unknown): string | undefined {
  const input = e as { file_path?: unknown; notebook_path?: unknown }
  if (typeof input.file_path === 'string') return input.file_path
  if (typeof input.notebook_path === 'string') return input.notebook_path

  return undefined
}

// ---- a question asked without a lock ----

type Asked = { tier: string; label: string; question: string }

const MOVE = /👉\s*(?:\*\*)?Your move(?::\*\*|\*\*:|:)\s*(.+)/g

// The last `👉 Your move:` question in a reply, with its tier and label read
// from the checkpoint header, an Own-it line, or the last triage line.
export function askedCheckpoint(text: string, triage: string | null): Asked | null {
  const question = [...text.matchAll(MOVE)].at(-1)?.[1]?.replace(/\*\*/g, '').trim()
  if (!question) return null
  if (/\bOwn it\b/i.test(text)) return { tier: 'GATE', label: 'own it', question }
  const header = text.split('\n').find(line => /^\s*Checkpoint \d+\/\d+ · /.test(line))
  const fromHeader = header?.split(' · ').at(-1)?.trim()
  const triaged = triage === null ? null : /Guardrail · (GO|CHECK|GATE) · ([^:\n]+)/.exec(triage)
  const tier = triaged?.[1] === 'GATE' ? 'GATE' : 'CHECK'
  const label = fromHeader || triaged?.[2]?.trim() || 'checkpoint'

  return { tier, label, question }
}

async function lockIfOpen($: Engine, asked: Asked): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    if ((await readLock($, [cwd])) !== null) return // Claude's own lock stands
    const root = (await projectRecord($)) ?? join(cwd, '.learning')
    await $.fs.write(join(root, 'gate.lock'), `${asked.tier} · ${asked.label} · ${asked.question}\n`)
    await refresh($)
  } catch {
    // the skill still holds the line if this fails
  }
}

// ---- the log ----

// Best effort: a failure here never touches the gate. Writes go one at a
// time, so two hooks logging at once can't drop each other's lines.
let logQueue: Promise<void> = Promise.resolve()

function logEvent($: Engine, event: Record<string, unknown>): Promise<void> {
  logQueue = logQueue.then(() => writeEvent($, event))

  return logQueue
}

async function writeEvent($: Engine, event: Record<string, unknown>): Promise<void> {
  try {
    const root = await projectRecord($)
    if (root === null) return
    const path = join(root, 'events.jsonl')
    const line = JSON.stringify({ d: new Date(await $.clock.now()).toISOString(), by: 'mod', ...event })
    const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    await $.fs.write(path, `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${line}\n`)
  } catch {
    // logging must never get in the way
  }
}

// This project's .learning/ folder: never the general one under HOME.
async function projectRecord($: Engine): Promise<string | null> {
  const found = await findUp($, [await $.session.cwd()], '.learning')
  const home = await $.env.get('HOME')
  if (found === null || (home !== undefined && found === join(clean(home), '.learning'))) return null

  return found
}

// ---- privacy ----

const privateRoots = new Set<string>()

// Keeps a project's .learning/ out of git with one line in the repo's own
// .git/info/exclude: local to this machine, never the team's .gitignore.
async function keepPrivate($: Engine, file: string): Promise<void> {
  const parts = clean(file).split('/')
  const at = parts.lastIndexOf('.learning')
  if (at < 1) return
  const root = parts.slice(0, at).join('/') || '/'
  if (privateRoots.has(root)) return
  const exclude = join(root, '.git/info/exclude')
  if (!(await $.fs.exists(exclude))) return
  const text = await $.fs.read(exclude)
  if (!/^\/?\.learning\/?$/m.test(text)) {
    await $.fs.write(exclude, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}.learning/\n`)
    $.ui.toast('Kept .learning/ out of git (local exclude only).')
  }
  privateRoots.add(root)
}

// ---- /learned ----

type Concept = { name: string; status: string; gaps: number }

const GROUPS: readonly (readonly [string, string])[] = [
  ['demonstrated', 'Demonstrated'],
  ['learning', 'Learning'],
  ['needs-reinforcement', 'Needs reinforcement'],
  ['unfamiliar', 'Unfamiliar'],
]

async function learnedSummary($: Engine): Promise<string> {
  const home = await $.env.get('HOME')
  const dirs: string[] = []
  if (home !== undefined) dirs.push(join(clean(home), '.learning/general'))
  const project = await findUp($, [await $.session.cwd()], '.learning/project')
  if (project !== null && !dirs.includes(project)) dirs.push(project)

  const concepts: Concept[] = []
  for (const dir of dirs) {
    if (!(await $.fs.exists(dir))) continue
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
      concepts.push(parseConcept(entry.name, await $.fs.read(join(dir, entry.name))))
    }
  }

  return summarise(concepts)
}

export function parseConcept(file: string, text: string): Concept {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const field = (key: string) => new RegExp(`^${key}:[ \\t]*([^#\\n]*)`, 'm').exec(front)?.[1]?.trim()
  const gaps = /^## Known gaps[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? ''

  return {
    name: field('concept') || file.replace(/\.md$/, ''),
    status: field('status') || 'unknown',
    gaps: gaps.split('\n').filter(line => /^\s*- /.test(line)).length,
  }
}

export function summarise(concepts: readonly Concept[]): string {
  if (concepts.length === 0) return 'Nothing recorded yet. The record fills in as concepts come up.'
  const names = (list: readonly Concept[]) => {
    const shown = list.slice(0, 8).map(c => c.name)
    return list.length > 8 ? `${shown.join(', ')}, +${list.length - 8} more` : shown.join(', ')
  }
  const known = new Set(GROUPS.map(([status]) => status))
  const lines = [`Learning record: ${concepts.length} concept${concepts.length === 1 ? '' : 's'}`]
  for (const [status, title] of GROUPS) {
    const list = concepts.filter(c => c.status === status)
    if (list.length > 0) lines.push(`${title} (${list.length}): ${names(list)}`)
  }
  const other = concepts.filter(c => !known.has(c.status))
  if (other.length > 0) lines.push(`Other (${other.length}): ${names(other)}`)
  const gaps = concepts.reduce((sum, c) => sum + c.gaps, 0)
  if (gaps > 0) lines.push(`Open gaps: ${gaps}`)

  return lines.join('\n')
}

// ---- paths (POSIX) ----

export function clean(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return '/' + parts.join('/')
}

export const resolvePath = (cwd: string, path: string) => clean(path.startsWith('/') ? path : `${cwd}/${path}`)

export const isInRecord = (file: string) => clean(file).split('/').includes('.learning')

function ancestors(dir: string): string[] {
  const parts = clean(dir).split('/').filter(Boolean)
  const out: string[] = []
  for (let i = parts.length; i >= 0; i--) out.push('/' + parts.slice(0, i).join('/'))

  return out
}

const parentOf = (file: string) => ancestors(file)[1] ?? '/'

const join = (dir: string, rest: string) => `${dir === '/' ? '' : dir}/${rest}`

async function findUp($: Engine, starts: readonly string[], rest: string): Promise<string | null> {
  const seen = new Set<string>()
  for (const start of starts) {
    for (const dir of ancestors(start)) {
      if (seen.has(dir)) continue
      seen.add(dir)
      const path = join(dir, rest)
      if (await $.fs.exists(path)) return path
    }
  }

  return null
}
