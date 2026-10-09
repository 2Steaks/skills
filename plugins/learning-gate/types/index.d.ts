/** The open checkpoint, as read from `.learning/gate.lock`. */
export type GateLock = {
  /** Absolute path of the lock file. */
  path: string
  /** GO, CHECK or GATE as the skill wrote it; `CHECKPOINT` when unparsed. */
  tier: string
  /** The risk category (`concurrency`, `data`, ...); may be empty. */
  category: string
  /** The open question, on one line. */
  question: string
}

declare module 'claude-code' {
  interface PluginState {
    'learning-gate': {
      /** The open checkpoint, or null when none is open. */
      lock: GateLock | null
      /** The last `Guardrail · TIER · ...` line the model wrote. */
      triage: string | null
      /** Whether the learning-guardrails skill was expanded this session. */
      active: boolean
      /** Whether the user's latest prompt named the skill (lets Claude load it). */
      named: boolean
    }
  }
}
