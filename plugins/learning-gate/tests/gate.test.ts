import type { On } from 'claude-code'
import { describe, expect, mock, test, type TestBody } from 'claude-code/testing'

import { askedCheckpoint, askedInDialog, clean, isInRecord, parseConcept, parseLock, summarise } from '../hooks/register'

const CWD = '/proj'
const SESSION = 'sess-1'
const LOCK = `/proj/.learning/locks/${SESSION}.lock`
const QUESTION = 'If Start is clicked twice within 200ms, how many runs exist, and why?'
const LOCK_LINE = `GATE · concurrency · ${QUESTION}\n`
const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'learning-gate',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

// The world beneath the plugin: an in-memory file system, a cwd, a HOME,
// and tools that "run" (Bash may delete files), with status and toasts recorded.
function world(on: On, entries: Record<string, string> = {}, stored: Record<string, unknown> = {}) {
  const files = new Map(Object.entries(entries))
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'

  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 9, 9, 0, 0) })
  mock.store(on, stored)
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: SESSION }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) || [...files.keys()].some(p => p.startsWith(`${e.path}/`)) }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.list', ($, e) => ({
    value: [...files.keys()]
      .filter(p => parent(p) === e.path)
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  // The engine's own band: nothing of its own to show.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Bash' && e.command.includes('lock.mjs close')) files.delete(LOCK)
    if (e.tool === 'Write') files.set(e.file_path, e.content)
    return { result: 'ran' } as never
  })

  return { files, statuses, toasts, clock }
}

const events = (files: Map<string, string>, path = '/proj/.learning/events.jsonl') =>
  (files.get(path) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)

// Appends a row through the plugin. The test kit can't store one: a test hook
// that answers session.append is skipped (it must relay next), and next reaches
// a bottom that throws. The plugin acts before its own next, so that one throw
// is ignored; anything else still fails the test.
const append = async ($: Parameters<TestBody>[0], row: never) => {
  try {
    await $.session.append(row)
  } catch (error) {
    if (!String(error).includes('no implementation for session.append')) throw error
  }
}

const edit = (file_path: string) => ({ tool: 'Edit' as const, file_path, old_string: 'a', new_string: 'b' })
const ask = (header: string, question: string) =>
  ({
    tool: 'AskUserQuestion',
    questions: [{ question, header, multiSelect: false, options: [{ label: 'One' }, { label: 'Two' }, { label: 'Not sure yet' }] }],
  }) as never
const refusal = (ran: { deny?: string; text?: string }) => ran.deny ?? ''
const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const command = (name: string) => ({
  command: name,
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})
const COMPOSE = {
  model: 'claude-test',
  promptModel: 'claude-test',
  surfaces: ['terminal' as const],
  tools: [],
  outputStyle: null,
  traits: [],
}

describe('the gate', () => {
  test('no lock: code edits run', async ($, on) => {
    world(on)
    const ran = await $.tool.call(edit('/proj/src/a.ts'))
    expect(ran.deny).toBeUndefined()
  })

  test('lock: a code edit is refused, with the open question', async ($, on) => {
    world(on, { [LOCK]: LOCK_LINE })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    const ran = await $.tool.call(edit('/proj/src/a.ts'))
    expect(refusal(ran)).toContain(QUESTION)
    expect(refusal(ran)).toContain('learning-guardrails')
  })

  test('lock: Write, a relative path and a nested package are refused too', async ($, on) => {
    world(on, { [LOCK]: LOCK_LINE })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    const write = await $.tool.call({ tool: 'Write', file_path: '/proj/src/new.ts', content: 'x' })
    expect(refusal(write)).toContain(QUESTION)
    expect(refusal(await $.tool.call(edit('src/a.ts')))).toContain(QUESTION)
    expect(refusal(await $.tool.call(edit('/proj/packages/ui/src/b.tsx')))).toContain(QUESTION)
  })

  test('lock: a .. path cannot sneak out through .learning', async ($, on) => {
    world(on, { [LOCK]: LOCK_LINE })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    const ran = await $.tool.call(edit('/proj/.learning/../src/a.ts'))
    expect(refusal(ran)).toContain(QUESTION)
  })

  test('lock: the record itself can still be written', async ($, on) => {
    world(on, { [LOCK]: LOCK_LINE })
    const ran = await $.tool.call({ tool: 'Write', file_path: '/proj/.learning/session.md', content: '## Now' })
    expect(ran.deny).toBeUndefined()
  })

  test('deleting the lock lifts the gate, with a toast', async ($, on) => {
    const { toasts, statuses } = world(on, { [LOCK]: LOCK_LINE })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    expect(refusal(await $.tool.call(edit('/proj/src/a.ts')))).toContain(QUESTION)
    expect(statuses.at(-1)).toContain('Checkpoint open')
    await $.tool.call({ tool: 'Bash', command: 'node lock.mjs close passed' })
    expect(toasts).toContain('Gate lifted. Carry on.')
    expect(statuses.at(-1)).toBeUndefined()
    expect((await $.tool.call(edit('/proj/src/a.ts'))).deny).toBeUndefined()
  })
})

describe('telling the shells', () => {
  test("every Bash call runs with this session's id, the one the mod enforces", async ($, on) => {
    world(on)
    const sets: { name: string; value?: string }[] = []
    on('env.set', ($, e) => {
      sets.push({ name: e.name, value: e.value })
      return { value: undefined }
    })
    await $.tool.call({ tool: 'Bash', command: 'node lock.mjs show' })
    expect(sets).toEqual([{ name: 'LEARNING_GATE_SESSION', value: SESSION }])
  })
})

describe('the mod logs the mechanical events', () => {
  test('gate open, a refused edit and gate close, with time open', async ($, on) => {
    const { files, clock } = world(on, { '/proj/.learning/session.md': '## Now' })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await $.tool.call({ tool: 'Write', file_path: LOCK, content: LOCK_LINE })
    await $.tool.call(edit('/proj/src/a.ts'))
    await clock.advance(30_000)
    // the question shrinks: the band follows, but it's the same gate
    await $.tool.call({ tool: 'Write', file_path: LOCK, content: 'GATE · concurrency · One run or two, and why?' })
    await clock.advance(60_000)
    await $.tool.call({ tool: 'Bash', command: 'node lock.mjs close passed' })
    const log = events(files)
    expect(log.map(e => e.e)).toEqual(['gate_open', 'edit_refused', 'gate_close'])
    expect(log.every(e => e.by === 'mod')).toBe(true)
    expect(log[0]).toMatchObject({ tier: 'gate', label: 'concurrency', d: '2026-10-09T09:00:00.000Z' })
    expect(log[2]).toMatchObject({ e: 'gate_close', ms: 90_000 })
  })

  test('a triage line is logged and shown in the status line', async ($, on) => {
    const { files, statuses } = world(on, { '/proj/.learning/session.md': '## Now' })
    await append($, {
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Guardrail · CHECK · new to you: Intl.DurationFormat\n\nChecking…' }] },
      door: 'response',
      origin: { kind: 'model', model: 'claude-test' },
      uuid: 'row-1',
    } as never)
    expect(statuses.at(-1)).toBe('Guardrail · CHECK · new to you: Intl.DurationFormat')
    expect(events(files)).toMatchObject([{ e: 'triage', tier: 'check', what: 'new to you: Intl.DurationFormat' }])
  })

  test('no project record: nothing is logged, not even under HOME', async ($, on) => {
    const { files } = world(on, { '/home/u/.learning/general/retries.md': '---\nstatus: learning\n---\n' })
    await append($, {
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Guardrail · GO · copy tweak' }] },
      door: 'response',
      origin: { kind: 'model', model: 'claude-test' },
      uuid: 'row-2',
    } as never)
    expect([...files.keys()].some(p => p.endsWith('events.jsonl'))).toBe(false)
  })
})

describe('gates across sessions', () => {
  const OPEN = { gates: { [LOCK]: { at: Date.UTC(2026, 9, 9, 8, 0, 0), tier: 'GATE', label: 'concurrency' } } }

  test('a lock still open from last session is not a new gate', async ($, on) => {
    const { files } = world(on, { [LOCK]: LOCK_LINE }, OPEN)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit(prompt('next morning'))
    expect(events(files)).toEqual([])
  })

  test('a lock deleted between sessions closes its gate, timed from when it opened', async ($, on) => {
    const { files } = world(on, { '/proj/.learning/session.md': '## Now' }, OPEN)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit(prompt('back again'))
    expect(events(files)).toMatchObject([{ e: 'gate_close', label: 'concurrency', ms: 3_600_000 }])
  })
})

const reply = (text: string, uuid: string) =>
  ({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid,
  }) as never

describe('a question asked without a lock', () => {
  test('opens a lock from the Your move line, labelled from the header and triage', async ($, on) => {
    const { files } = world(on, { '/proj/.learning/session.md': '## Now' })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await append($, reply('Guardrail · GATE · concurrency: retry on a POST', 'r1'))
    await append($, reply('Checkpoint 1/1 · ~2 min · concurrency\nWhy it matters: two runs.\n👉 **Your move:** One run or two, and why?', 'r2'))
    expect(files.get(LOCK)).toBe('GATE · concurrency · One run or two, and why?\n')
    expect(events(files).map(e => e.e)).toEqual(['triage', 'gate_open'])
    expect(refusal(await $.tool.call(edit('/proj/src/a.ts')))).toContain('One run or two')
  })

  test('a CHECK question never locks', async ($, on) => {
    const { files } = world(on, { '/proj/.learning/session.md': '## Now' })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await append($, reply('Guardrail · CHECK · new to you: Intl.DurationFormat', 'r3'))
    await append($, reply('Built it.\n\n👉 **Your move:** What does style narrow change?\nA. Units\nB. Rounding\nC. Locale\nD. Not sure yet', 'r3b'))
    expect(files.has(LOCK)).toBe(false)
  })

  test('a GATE question in the dialog opens a lock, and edits are refused', async ($, on) => {
    const { files } = world(on, { '/proj/.learning/session.md': '## Now' })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await append($, reply('Guardrail · GATE · concurrency: retry on a POST', 'r6'))
    await $.tool.call(ask('concurrency', 'Two clicks within 200ms: how many runs?'))
    expect(files.get(LOCK)).toBe('GATE · concurrency · Two clicks within 200ms: how many runs?\n')
    expect(refusal(await $.tool.call(edit('/proj/src/a.ts')))).toContain('Two clicks')
  })

  test('a clarifying question in the dialog opens nothing', async ($, on) => {
    const { files } = world(on, { '/proj/.learning/session.md': '## Now' })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await append($, reply('Guardrail · GATE · concurrency: retry on a POST', 'r7'))
    await $.tool.call(ask('Approach', 'Retry in the client or the server?'))
    expect(files.has(LOCK)).toBe(false)
  })

  test("Claude's own lock is never overwritten", async ($, on) => {
    const { files } = world(on, { [LOCK]: LOCK_LINE })
    await append($, reply('👉 **Your move:** A smaller question?', 'r4'))
    expect(files.get(LOCK)).toBe(LOCK_LINE)
  })

  test('a reply with no question opens nothing', async ($, on) => {
    const { files } = world(on, { '/proj/.learning/session.md': '## Now' })
    await append($, reply('Yes. Nothing cancels the first request. Logged. Building.', 'r5'))
    expect(files.has(LOCK)).toBe(false)
  })

  test('parsing the question, tier and label', () => {
    expect(askedCheckpoint('👉 **Your move:** Why?', 'Guardrail · GATE · data: a migration')).toEqual({ tier: 'GATE', label: 'data', question: 'Why?' })
    expect(askedCheckpoint('👉 **Your move:** Why?', 'Guardrail · CHECK · new to you: Intl')).toBeNull()
    expect(askedCheckpoint('👉 Your move: Why?', null)).toBeNull()
    expect(askedCheckpoint('No question here.', 'Guardrail · GATE · data: a migration')).toBeNull()
    const dialog = (header: string) => ({ questions: [{ question: 'One run or two?', header }] })
    expect(askedInDialog(dialog('Concurrency'), 'Guardrail · GATE · concurrency: retry')).toEqual({ tier: 'GATE', label: 'concurrency', question: 'One run or two?' })
    expect(askedInDialog(dialog('intl'), 'Guardrail · CHECK · new to you: Intl')).toBeNull()
    expect(askedInDialog({}, 'Guardrail · GATE · concurrency: retry')).toBeNull()
  })
})

describe('opt-in', () => {
  const load = (skill: string) => ({ tool: 'Skill' as const, skill })

  test("Claude can't load the skill on its own", async ($, on) => {
    world(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit(prompt('add a retry to startRun'))
    expect((await $.tool.call(load('learning-guardrails'))).deny).toContain('opt-in')
    expect((await $.tool.call(load('my-org:learning-guardrails'))).deny).toContain('opt-in')
  })

  test('naming it opens the door for that message only', async ($, on) => {
    world(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit(prompt('use learning guardrails for this one'))
    expect((await $.tool.call(load('learning-guardrails'))).deny).toBeUndefined()
    await $.prompt.submit(prompt('now add a timeout'))
    expect((await $.tool.call(load('learning-guardrails'))).deny).toContain('opt-in')
  })

  test('other skills load freely', async ($, on) => {
    world(on)
    expect((await $.tool.call(load('commit'))).deny).toBeUndefined()
  })

  test("no auto-lock until the skill is called", async ($, on) => {
    const { files } = world(on, { '/proj/.learning/session.md': '## Now' })
    await append($, reply('👉 **Your move:** One run or two?', 'r9'))
    expect(files.has(LOCK)).toBe(false)
  })

  test('a lock left from an earlier session is parked: edits run, the band says /pickup', async ($, on) => {
    const { statuses } = world(on, { [LOCK]: LOCK_LINE })
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text }
    })
    await $.prompt.submit(prompt('add a timeout'))
    expect(context).toBeUndefined()
    expect((await $.tool.call(edit('/proj/src/a.ts'))).deny).toBeUndefined()
    expect(statuses.at(-1)).toContain('Paused checkpoint')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect((await ui.find({ type: 'Text', text: 'Paused checkpoint' }))?.text).toContain('/pickup')
      await ui.unmount()
    }
  })

  test("another session's lock never holds this one, and the band counts it for /pickup", async ($, on) => {
    world(on, { '/proj/.learning/locks/sess-0.lock': `${LOCK_LINE}task: Make claimSlot safe\n` })
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text }
    })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await $.prompt.submit(prompt('add a timeout'))
    expect(context).toBeUndefined()
    expect((await $.tool.call(edit('/proj/src/a.ts'))).deny).toBeUndefined()
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect((await ui.find({ type: 'Text', text: 'unfinished' }))?.text).toBe('⏸ 1 unfinished checkpoint · /pickup to carry on')
      await ui.unmount()
    }
  })

  test('paused checkpoints and a lock from before sessions were tracked count too', async ($, on) => {
    world(on, {
      '/proj/.learning/locks/paused-abc.lock': `${LOCK_LINE}paused: 2026-10-08T09:00:00.000Z\n`,
      '/proj/.learning/gate.lock': LOCK_LINE,
      [LOCK]: LOCK_LINE,
    })
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit(prompt('hello'))
    await $.tool.call({ tool: 'Bash', command: 'node lock.mjs close passed' })
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect((await ui.find({ type: 'Text', text: 'unfinished' }))?.text).toBe('⏸ 2 unfinished checkpoints · /pickup to carry on')
      await ui.unmount()
    }
  })

  test('/pickup loads the skill with the pickup ask, and the gate holds again', async ($, on) => {
    world(on, { [LOCK]: LOCK_LINE })
    const ran: { command: string; args?: string }[] = []
    on('command.list', () => ({ value: [{ name: 'learning-guardrails', description: 'x', source: 'skill' }] as never }))
    on('command.run', { command: 'learning-guardrails' }, ($, e) => {
      ran.push({ command: e.command, args: e.args })
      return { text: '' }
    })
    await $.command.run(command('pickup'))
    await new Promise(r => setTimeout(r, 0))
    expect(ran).toHaveLength(1)
    expect(ran[0]?.args).toContain('Pick up an unfinished learning checkpoint')
    expect((await $.tool.call({ tool: 'Skill', skill: 'learning-guardrails' } as never)).deny).toBeUndefined()
    const after = refusal(await $.tool.call(edit('/proj/src/a.ts')))
    expect(after).toContain('Re-ask the question, options and all')
    expect(after).toContain(QUESTION)
  })

  test('/pickup falls back to a plain prompt when the skill command is missing', async ($, on) => {
    world(on, { [LOCK]: LOCK_LINE })
    const asked: string[] = []
    on('command.list', () => ({ value: [] as never }))
    on('prompt.submit', ($, e) => {
      asked.push(e.text)
      return { text: e.text }
    })
    await $.command.run(command('pickup'))
    await new Promise(r => setTimeout(r, 0))
    expect(asked.at(-1)).toContain('Pick up an unfinished learning checkpoint')
  })

  test('the standing rule says opt-in', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
    const { sections } = await $.prompt.compose(COMPOSE)
    expect(sections.at(-1)?.text).toContain('opt-in')
    expect(sections.at(-1)?.text).toContain('Never load it on your own')
  })
})

describe('a record deleted outright', () => {
  test('forgets its open gate, so the next lock is a fresh one', async ($, on) => {
    const { files } = world(on, {}, { gates: { [LOCK]: { at: 0, tier: 'GATE', label: 'old' } } })
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit(prompt('fresh start'))
    await $.tool.call({ tool: 'Write', file_path: LOCK, content: LOCK_LINE })
    expect(events(files)).toMatchObject([{ e: 'gate_open', label: 'concurrency' }])
  })
})

describe('keeping the record private', () => {
  const EXCLUDE = '/proj/.git/info/exclude'

  test('the first lock adds .learning/ to the local exclude, once', async ($, on) => {
    const { files, toasts } = world(on, { [EXCLUDE]: '# local excludes\n' })
    await $.tool.call({ tool: 'Write', file_path: LOCK, content: LOCK_LINE })
    await $.tool.call({ tool: 'Write', file_path: '/proj/.learning/session.md', content: '## Now' })
    expect(files.get(EXCLUDE)).toBe('# local excludes\n.learning/\n')
    expect(toasts.filter(t => t.includes('out of git'))).toHaveLength(1)
  })

  test('an exclude that already lists it is left alone', async ($, on) => {
    const { files, toasts } = world(on, { [EXCLUDE]: '.learning/\n' })
    await $.tool.call({ tool: 'Write', file_path: LOCK, content: LOCK_LINE })
    expect(files.get(EXCLUDE)).toBe('.learning/\n')
    expect(toasts.some(t => t.includes('out of git'))).toBe(false)
  })

  test('no git repo: nothing is written', async ($, on) => {
    const { files } = world(on)
    await $.tool.call({ tool: 'Write', file_path: LOCK, content: LOCK_LINE })
    expect(files.has(EXCLUDE)).toBe(false)
  })
})

describe('keeping the question in front of everyone', () => {
  test('a prompt carries the open question while the lock is there', async ($, on) => {
    world(on, { [LOCK]: LOCK_LINE })
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await $.prompt.submit(prompt('two runs, because nothing cancels the first'))
    expect(context?.join('\n')).toContain(QUESTION)
  })

  test('no lock: the prompt goes through untouched', async ($, on) => {
    world(on)
    let context: readonly string[] | undefined = ['unset']
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text }
    })
    await $.prompt.submit(prompt('hello'))
    expect(context).toBeUndefined()
  })

  test('the system prompt always carries the rule, last', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
    const { sections } = await $.prompt.compose(COMPOSE)
    expect(sections.at(-1)?.id).toBe('learning-gate:rules')
    expect(sections.at(-1)?.text).toContain('learning-guardrails skill')
  })

  test('the band pins the question, then clears', async ($, on) => {
    const { files } = world(on, { [LOCK]: LOCK_LINE })
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.skill.prompt({ skill: 'learning-guardrails', text: 'the skill' })
    await $.prompt.submit(prompt('loads the lock'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect((await ui.find({ type: 'Text', text: 'Checkpoint open' }))?.text).toContain('GATE · concurrency')
      expect(await ui.find({ type: 'Text', text: QUESTION })).toBeDefined()
      await ui.unmount()
    }
    files.delete(LOCK)
    await $.prompt.submit(prompt('lock is gone'))
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: 'Checkpoint open' })).toBeUndefined()
      await ui.unmount()
    }
  })
})

describe('/learned', () => {
  const GENERAL = '/home/u/.learning/general/idempotency.md'
  const PROJECT = '/proj/.learning/project/run-start.md'

  test('summarises the general and project record', async ($, on) => {
    world(on, {
      [GENERAL]: '---\nconcept: idempotency\nstatus: demonstrated      # note\n---\n## Evidence\n- x\n\n## Known gaps\n- cross-service retries\n',
      [PROJECT]: '---\nconcept: run-start\nstatus: learning\n---\n## Evidence\n',
    })
    const { text } = await $.command.run(command('learned'))
    expect(text).toContain('2 concepts')
    expect(text).toContain('Demonstrated (1): idempotency')
    expect(text).toContain('Learning (1): run-start')
    expect(text).toContain('Open gaps: 1')
  })

  test('says so when nothing is recorded', async ($, on) => {
    world(on)
    const { text } = await $.command.run(command('learned'))
    expect(text).toContain('Nothing recorded yet')
  })
})

describe('parsing', () => {
  test('a lock line splits into tier, category and question', () => {
    expect(parseLock(LOCK, LOCK_LINE)).toEqual({ path: LOCK, tier: 'GATE', category: 'concurrency', question: QUESTION })
  })

  test("lock.mjs's fields after the first line stay out of the question", () => {
    expect(parseLock(LOCK, `${LOCK_LINE}task: Make claimSlot safe\nopened: 2026-10-09T09:00:00.000Z\n`)).toEqual({ path: LOCK, tier: 'GATE', category: 'concurrency', question: QUESTION })
  })

  test('a question holding a separator stays whole', () => {
    expect(parseLock(LOCK, 'CHECK · state · Why A · not B?').question).toBe('Why A · not B?')
  })

  test('an unstructured lock still shows its text', () => {
    expect(parseLock(LOCK, 'Explain the retry\nin your own words')).toEqual({
      path: LOCK,
      tier: 'CHECKPOINT',
      category: '',
      question: 'Explain the retry in your own words',
    })
  })

  test('paths fold . and .. before the record check', () => {
    expect(clean('/proj/./src/../.learning/x.md')).toBe('/proj/.learning/x.md')
    expect(isInRecord('/proj/.learning/../src/a.ts')).toBe(false)
    expect(isInRecord('/proj/src/.learning-notes.ts')).toBe(false)
  })

  test('a concept file reads its name, status and gaps', () => {
    const text = '---\nconcept: retries\nstatus: needs-reinforcement\n---\n## Known gaps\n- one\n- two\n\n## Other\n- not a gap\n'
    expect(parseConcept('retries.md', text)).toEqual({ name: 'retries', status: 'needs-reinforcement', gaps: 2 })
    expect(summarise([])).toContain('Nothing recorded yet')
  })
})
