// learning-gate: the enforcement half of the learning-guardrails skill.
// The skill is opt-in: Claude may load it only when the user's latest message runs
// /learning-guardrails or names it (/pickup and /audit do); any other attempt is refused.
// The skill writes .learning/locks/<session id>.lock (first line: `TIER · category ·
// question`) right before it asks a GATE question, and deletes it when the user passes,
// drops the task, or gives a valid override; a pause keeps it under another name for
// /pickup. Each session is held only by its own lock, so sessions never block each
// other; the band counts the others. While this session's lock exists:
// - code edits are refused, with the open question as the reason;
// - the question is pinned above the prompt;
// - every prompt carries it to the model, so it survives a compacted context.
// Edits inside any .learning/ folder always pass, so the record can update.
// A project's .learning/ is kept out of git via the repo's local exclude list.
// Only a GATE locks. A GATE question asked with no lock open (a `👉 Your move:`
// line, or the question dialog headed with the GATE's category) opens one, so a
// checkpoint Claude forgot to lock still holds. It never overwrites a lock.
// It logs the mechanical events (triage, gate open/close, refusals) to
// .learning/events.jsonl as "by":"mod"; the skill logs the judgement calls.
// Until the skill is in play this session, its lock is parked, not enforced: the band
// says so and /pickup resumes it (loading the skill), or picks another from a menu.
// The tripwire, while the skill is in play: a code edit is refused when no triage line
// has come since the user's last message, or when the skill's rule packs flag it
// (.learning/floor.json, which the skill writes each session) and no triage line since
// then GATEs that category or rates it lower with a reason (`· not data: test-fixture`).
// An open checkpoint counts as triage. Prose and files the packs ignore always pass.
// A hook that fails is skipped: the gate fails open, never locking you out.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cover, GateLock } from '../types'
import { CATS, changedLines, compileFloor, floorMatches } from './floor.mjs'
import type { Floor, FloorMatch } from './floor.mjs'

type Engine = EngineInterface

const UNCOVERED: Cover = { triaged: false, gated: [], waived: [] }
const lockState = atom({ plugin: 'learning-gate', key: 'lock' } as const, null)
const triageState = atom({ plugin: 'learning-gate', key: 'triage' } as const, null)
const activeState = atom({ plugin: 'learning-gate', key: 'active' } as const, false)
const namedState = atom({ plugin: 'learning-gate', key: 'named' } as const, false)
const unfinishedState = atom({ plugin: 'learning-gate', key: 'unfinished' } as const, 0)
const coverState = atom({ plugin: 'learning-gate', key: 'cover' } as const, UNCOVERED)
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
    "While this session's lock (.learning/locks/<session id>.lock) exists, the plugin refuses code edits and pins the open question above the prompt. Other sessions' locks never hold this one. Close a checkpoint only as the skill allows, and never offer the user a way around one.",
    "While the skill is in play, it also refuses a code edit made before any triage line since the user's last message, or one the skill's rule packs flag that no triage line since then GATEs or gives a reason for (`· not <category>: <reason-code>`). Write the line, then edit again. Judge the change, not the words: never GATE just to get past it.",
    "The plugin replaces the skill's hook script: do not install learning-gate.mjs.",
  ].join('\n'),
} as const

const PICKUP =
  'Pick up an unfinished learning checkpoint, per the learning-guardrails skill: list them, ask me which if there is more than one, then a three-line recap and the question in full.'
const AUDIT = 'Audit the learning guardrails, per section 10 of the learning-guardrails skill.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await tellShells($)
    await Promise.all([
      $.command.register({ name: 'learned', description: 'Show what your learning record says you have demonstrated' }),
      $.command.register({ name: 'pickup', description: 'Pick up an unfinished learning checkpoint, from a menu when there are several' }),
      $.command.register({ name: 'audit', description: 'Audit the learning guardrails against their own logs' }),
    ])
    await refresh($)

    return next(e)
  })

  // Opt-in: the skill is in play once its prompt is expanded (/name, or an allowed Skill call).
  // Where an organization manages Claude Code this hook never runs for an installed plugin,
  // so prompt.submit (the slash command) and tool.call (the Skill call) turn it on as well.
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

    // Every shell, lock.mjs's included, knows which session it runs in: the id this mod enforces.
    if (tool === 'Bash') await tellShells($)

    // A GATE question in the dialog: lock first, so the gate holds while it's open.
    if (tool === 'AskUserQuestion' && (await read($, activeState))) {
      const asked = askedInDialog(e, await read($, triageState))
      if (asked !== null) await lockIfOpen($, asked)
    }

    if (EDIT_TOOLS.has(tool)) {
      const cwd = await $.session.cwd()
      const target = editTarget(e)
      const file = target === undefined ? undefined : resolvePath(cwd, target)
      touchesRecord = file !== undefined && isInRecord(file)

      // Opt-in: a lock only blocks once the skill is in play this session.
      if (!touchesRecord && (await read($, activeState))) {
        const lock = await readLock($, file === undefined ? [cwd] : [parentOf(file), cwd])
        if (lock !== null) {
          await setLock($, lock)
          await logEvent($, { e: 'edit_refused', tier: lock.tier.toLowerCase(), label: lock.category, tool })

          return { deny: blockMessage(lock) }
        }
        // The tripwire: triage before building, and nothing the rule packs flag slips past it.
        const refused = file === undefined ? null : await tripwire($, e, tool, file)
        if (refused !== null) {
          await logEvent($, refused.event)

          return { deny: refused.message }
        }
      }
    }

    const ran = await next(e)
    if (tool === 'Skill' && isThisSkill((e as { skill?: unknown }).skill) && ran.deny === undefined) await update($, activeState, () => true)
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
    const named = NAMES_SKILL.test(e.text)
    await update($, namedState, () => named)
    if (isThisSkill(e.command?.name)) await update($, activeState, () => true)
    const lock = await refresh($)
    // A new message starts new work, to triage before building. An answer to the open checkpoint doesn't.
    if (lock === null || !(await read($, activeState))) await uncover($)
    // Parked checkpoints stay quiet until the user opts back in.
    if (lock === null || !(named || (await read($, activeState)))) return next(e)
    const note =
      `Learning checkpoint open (${label(lock)}): "${lock.question}" ` +
      'Read this message as the answer unless it plainly is not one (a pickup request is not: re-ask the question in full), and judge it by the learning-guardrails evidence bar. ' +
      `Code edits stay refused until the checkpoint closes, only as the learning-guardrails skill allows (lock.mjs).`

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
        showStatus($, await read($, lockState), last, await read($, activeState))
      }
      const triaged = triageLines(text)
      for (const t of triaged) {
        const lowered = t.waived.length > 0 ? { waived: t.waived.map(w => w.cat), why: t.waived[0]?.why } : {}
        await logEvent($, { e: 'triage', tier: t.tier.toLowerCase(), what: t.what.slice(0, 80), ...lowered })
      }
      if (triaged.length > 0) await cover($, triaged)
      const asked = (await read($, activeState)) ? askedCheckpoint(text, await read($, triageState)) : null
      if (asked !== null) await lockIfOpen($, asked)
    }

    return next(e)
  })

  // The band above the prompt: the open question, pinned until answered.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lock = await read($, lockState)
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    if (lock === null) {
      const others = await read($, unfinishedState)
      if (others === 0) return next(e)

      return (
        <Text dimColor wrap="wrap">
          ⏸ {others} unfinished checkpoint{others === 1 ? '' : 's'} · /pickup to carry on
        </Text>
      )
    }

    if (!(await read($, activeState))) {
      return (
        <Text dimColor wrap="wrap">
          ⏸ Paused checkpoint · {label(lock)} · /pickup to carry on
        </Text>
      )
    }

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
    await optIn($)
    void runSkill($, PICKUP)

    return {}
  })

  on('command.run', { command: 'audit' }, async $ => {
    await optIn($)
    void runSkill($, AUDIT)

    return {}
  })
}

// ---- opting in ----

// /pickup and /audit are the user asking for the skill: let it load and enforce.
async function optIn($: Engine): Promise<void> {
  await update($, namedState, () => true)
  await update($, activeState, () => true)
  await refresh($)
}

// Load the skill the way the user would (/learning-guardrails <ask>), else ask in words.
async function runSkill($: Engine, ask: string): Promise<void> {
  try {
    const found = (await $.command.list()).find(c => isThisSkill(c.name))
    if (found !== undefined) {
      await $.command.run({ command: found.name, args: ask })

      return
    }
  } catch {
    // fall through to a plain prompt
  }
  await $.prompt.submit({ text: ask, asUser: true })
}

// ---- the lock ----

async function refresh($: Engine): Promise<GateLock | null> {
  const lock = await readLock($, [await $.session.cwd()])
  await setLock($, lock)
  if (lock !== null) await keepPrivate($, lock.path)
  const others = await countUnfinished($)
  if ((await read($, unfinishedState)) !== others) await update($, unfinishedState, () => others)

  return lock
}

// This session, as the engine names it: the same id the CLI gives the shell, so
// lock.mjs and the mod agree on whose lock is whose.
async function sessionId($: Engine): Promise<string> {
  try {
    return String(await $.session.id()).replace(/[^\w-]/g, '') || 'local'
  } catch {
    return 'local'
  }
}

const ownLock = async ($: Engine) => `locks/${await sessionId($)}.lock`

// lock.mjs names its lock from LEARNING_GATE_SESSION, so the mod and the skill always agree on whose
// lock is whose, even where Claude Code gives the shell no session id of its own.
async function tellShells($: Engine): Promise<void> {
  try {
    await $.env.set('LEARNING_GATE_SESSION', await sessionId($))
  } catch {
    // lock.mjs falls back to CLAUDE_CODE_SESSION_ID
  }
}

// Checkpoints left in this project by other sessions or paused: /pickup's menu.
async function countUnfinished($: Engine): Promise<number> {
  try {
    const root = await projectRecord($)
    if (root === null) return 0
    const own = (await ownLock($)).slice('locks/'.length)
    const dir = join(root, 'locks')
    const locks = (await $.fs.exists(dir))
      ? (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.lock') && f.name !== own).length
      : 0

    return locks + ((await $.fs.exists(join(root, 'gate.lock'))) ? 1 : 0)
  } catch {
    return 0
  }
}

async function readLock($: Engine, starts: readonly string[]): Promise<GateLock | null> {
  const path = await findUp($, starts, `.learning/${await ownLock($)}`)
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
  const active = await read($, activeState)
  if (lock !== null && active) await coverLock($, lock)
  showStatus($, lock, await read($, triageState), active)
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
      if (!(await $.fs.exists(recordOf(stored)))) {
        delete gates[stored]
        pruned = true
      }
    }
    if (pruned) await $.store.set(GATES, gates)
    const root = await projectRecord($)
    if (root === null) return
    const path = join(root, await ownLock($))
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

function showStatus($: Engine, lock: GateLock | null, triage: string | null, active: boolean): void {
  if (lock !== null) $.ui.status(active ? `🛑 Checkpoint open · ${label(lock)}` : `⏸ Paused checkpoint · ${label(lock)}`)
  else $.ui.status(triage ?? undefined)
}

// The first line is the checkpoint; any `key: value` lines after it are lock.mjs's own.
export function parseLock(path: string, text: string): GateLock {
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  const [tier, category, ...rest] = first.split(' · ')
  if (tier !== undefined && category !== undefined && rest.length > 0 && /^(GO|CHECK|GATE)$/i.test(tier.trim())) {
    return { path, tier: tier.trim().toUpperCase(), category: category.trim(), question: rest.join(' · ').trim() }
  }
  const line = text.trim().replace(/\s*\n\s*/g, ' ')

  return { path, tier: 'CHECKPOINT', category: '', question: line || 'See lock.mjs show' }
}

const label = (lock: GateLock) => [lock.tier, lock.category].filter(Boolean).join(' · ')

const blockMessage = (lock: GateLock) =>
  [
    'Learning checkpoint open: code edits are refused until the user shows they understand.',
    `Open question: ${lock.question}`,
    'Re-ask the question, options and all, and wait for the answer.',
    'Close the checkpoint only as the learning-guardrails skill allows (lock.mjs). Never offer the user a way around it.',
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

// The last triage line's category, when it was a GATE: only a GATE locks.
function gateCategory(triage: string | null): string | null {
  const triaged = triage === null ? null : /Guardrail · (GO|CHECK|GATE) · ([^:\n]+)/.exec(triage)
  if (triaged?.[1] !== 'GATE') return null
  const label = triaged[2]?.trim() ?? ''

  return label.split(JOIN)[0]?.trim() || label
}

// Between the categories a GATE line names: `concurrency + data: a double removal`.
const JOIN = /\s*(?:\+|,|&|\/|\band\b)\s*/

// The last `👉 Your move:` question in a reply after a GATE triage line, labelled
// from the checkpoint header or that line. A CHECK question never locks.
export function askedCheckpoint(text: string, triage: string | null): Asked | null {
  const question = [...text.matchAll(MOVE)].at(-1)?.[1]?.replace(/\*\*/g, '').trim()
  const category = gateCategory(triage)
  if (!question || category === null) return null
  const header = text.split('\n').find(line => /^\s*Checkpoint \d+\/\d+ · /.test(line))
  const fromHeader = header?.split(' · ').at(-1)?.trim()

  return { tier: 'GATE', label: fromHeader || category || 'checkpoint', question }
}

// A GATE question asked in the AskUserQuestion dialog: its header is the category
// from the last GATE triage line. Any other question (a clarifying one) isn't a checkpoint.
export function askedInDialog(input: unknown, triage: string | null): Asked | null {
  const first = (input as { questions?: readonly { question?: unknown; header?: unknown }[] }).questions?.[0]
  const question = typeof first?.question === 'string' ? first.question.trim() : ''
  const category = gateCategory(triage)
  if (question === '' || !category || String(first?.header ?? '').trim().toLowerCase() !== category.toLowerCase()) return null

  return { tier: 'GATE', label: category, question }
}

async function lockIfOpen($: Engine, asked: Asked): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    if ((await readLock($, [cwd])) !== null) return // Claude's own lock stands
    const root = (await projectRecord($)) ?? join(cwd, '.learning')
    await $.fs.write(join(root, await ownLock($)), `${asked.tier} · ${asked.label} · ${asked.question}\n`)
    await refresh($)
  } catch {
    // the skill still holds the line if this fails
  }
}

// ---- the tripwire ----

type Triaged = { tier: string; what: string; gated: readonly string[]; waived: readonly { cat: string; why: string }[] }

const WAIVER = /·\s*not\s+(data|concurrency|security|performance|state|contracts)\s*:\s*([a-z0-9][a-z0-9-]*)/gi

// Each triage line in a reply: the categories a GATE covers (one, or two joined: `concurrency +
// data: …`), and each one rated lower with a reason (`Guardrail · GO · token rename · not security: rename`).
export function triageLines(text: string): Triaged[] {
  return [...text.matchAll(TRIAGE)].map(m => {
    const tier = m[1] ?? ''
    const what = (m[2] ?? '').trim()
    const at = m.index ?? 0
    const end = text.indexOf('\n', at)
    const line = text.slice(at, end < 0 ? undefined : end).replace(/`/g, '')
    const cats = (what.split(':')[0] ?? '').split(JOIN).map(c => c.trim().toLowerCase())
    const waived = [...line.matchAll(WAIVER)].map(w => ({ cat: (w[1] ?? '').toLowerCase(), why: (w[2] ?? '').toLowerCase() }))

    return { tier, what, gated: tier === 'GATE' ? cats.filter(c => CATS.includes(c)) : [], waived }
  })
}

async function cover($: Engine, lines: readonly Triaged[]): Promise<void> {
  await update($, coverState, c => ({
    triaged: true,
    gated: [...new Set([...c.gated, ...lines.flatMap(t => t.gated)])],
    waived: [...new Set([...c.waived, ...lines.flatMap(t => t.waived.map(w => w.cat))])],
  }))
}

// An open checkpoint is triage: its category stays covered once it closes, until the next message.
async function coverLock($: Engine, lock: GateLock): Promise<void> {
  const cat = lock.category.trim().toLowerCase()
  const known = CATS.includes(cat)
  const c = await read($, coverState)
  if (c.triaged && (!known || c.gated.includes(cat))) return
  await update($, coverState, now => ({ ...now, triaged: true, gated: known && !now.gated.includes(cat) ? [...now.gated, cat] : now.gated }))
}

async function uncover($: Engine): Promise<void> {
  const c = await read($, coverState)
  if (c.triaged || c.gated.length > 0 || c.waived.length > 0) await update($, coverState, () => UNCOVERED)
}

const PROSE = /\.(md|mdx|markdown|rst|adoc|txt)$/i

const TRIAGE_FIRST = [
  "Learning guardrails: triage before building. No triage line has come since the user's last message.",
  'Write it first (`Guardrail · GO|CHECK|GATE · <label>`, learning-guardrails §1), then make the edit.',
].join('\n')

type Refusal = { message: string; event: Record<string, unknown> }

// Null lets the edit through. Anything unexpected fails open, like the gate.
async function tripwire($: Engine, e: unknown, tool: string, file: string): Promise<Refusal | null> {
  try {
    const record = await projectRecord($)
    if (record === null) return null // not set up here: nothing to check against
    const rel = relativeTo(parentOf(record), file)
    if (rel === null) return null // outside this project
    const floor = await loadFloor($, join(record, 'floor.json'))
    if (floor === null ? PROSE.test(rel) : floor.ignore.some(re => re.test(rel))) return null // not building
    const covered = await read($, coverState)
    if (!covered.triaged) return { message: TRIAGE_FIRST, event: { e: 'triage_refused', tool } }
    if (floor === null) return null
    const lines = await editedLines($, e, file)
    const found = floorMatches(floor, [rel], lines.map(text => ({ file: rel, text })))
    const missing = CATS.filter(cat => found.some(m => m.cat === cat) && !covered.gated.includes(cat) && !covered.waived.includes(cat))
    if (missing.length === 0) return null

    return { message: floorMessage(rel, missing, found), event: { e: 'floor_refused', cats: missing, tool } }
  } catch {
    return null
  }
}

function relativeTo(root: string, file: string): string | null {
  const path = clean(file)
  const prefix = root === '/' ? '/' : `${root}/`

  return path.startsWith(prefix) ? path.slice(prefix.length) : null
}

// The lines this edit adds or removes, whichever tool makes it.
async function editedLines($: Engine, e: unknown, file: string): Promise<string[]> {
  const input = e as { old_string?: unknown; new_string?: unknown; content?: unknown; edits?: unknown; new_source?: unknown }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (Array.isArray(input.edits)) {
    return input.edits.flatMap((one: { old_string?: unknown; new_string?: unknown } | null) => changedLines(str(one?.old_string), str(one?.new_string)))
  }
  if (typeof input.content === 'string') {
    let before = ''
    try {
      if (await $.fs.exists(file)) before = await $.fs.read(file)
    } catch {
      before = '' // unreadable: every line counts
    }
    return changedLines(before, input.content)
  }
  if (typeof input.new_source === 'string') return changedLines('', input.new_source)

  return changedLines(str(input.old_string), str(input.new_string))
}

let floorCache: { text: string; floor: Floor | null } | undefined

async function loadFloor($: Engine, path: string): Promise<Floor | null> {
  if (!(await $.fs.exists(path))) return null
  const text = await $.fs.read(path)
  if (floorCache === undefined || floorCache.text !== text) {
    let raw: unknown = null
    try {
      raw = JSON.parse(text)
    } catch {
      raw = null
    }
    floorCache = { text, floor: compileFloor(raw) }
  }

  return floorCache.floor
}

function floorMessage(rel: string, cats: readonly string[], found: readonly FloorMatch[]): string {
  const why = cats.map(cat => {
    const hits = found.filter(m => m.cat === cat)
    const shown = [...new Set(hits.map(m => (m.text === undefined ? `its path matches ${m.pattern.replace(/\\\//g, '/')}` : `"${m.text.trim().slice(0, 60)}"`)))]

    return `${cat} (${shown.slice(0, 2).join('; ')})`
  })
  const first = cats[0] ?? 'data'

  return [
    `Learning guardrails: the rule packs flag this edit to ${rel} as ${why.join(', ')}, and no triage line since the user's last message covers ${cats.length === 1 ? 'it' : 'them'}.`,
    `Judge the change, not the words. If it changes how that behaves, it's a GATE: \`Guardrail · GATE · ${first}: <label>\`, then the checkpoint the skill asks for.`,
    `If it doesn't, add the reason to your triage line, one per category: \`· not ${first}: <reason-code>\` (non-functional-edit, test-fixture, rename…). Then edit again.`,
  ].join('\n')
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
  ['needs-reinforcement', 'Worth a refresh'],
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
  // No gap count: gaps are notes for when a concept comes up again, not a to-do list.

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

// The .learning folder a lock belongs to: the record, which outlives its locks folder.
function recordOf(lock: string): string {
  const parts = clean(lock).split('/')
  const at = parts.lastIndexOf('.learning')

  return at < 1 ? parentOf(lock) : parts.slice(0, at + 1).join('/')
}

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
