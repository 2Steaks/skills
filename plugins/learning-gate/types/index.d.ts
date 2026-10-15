/** This session's open checkpoint, as read from `.learning/locks/<session id>.lock`. */
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

/** What triage since the user's last message covers, for the tripwire. */
export type Cover = {
  /** A triage line, or an open checkpoint, has come since the user's last message. */
  triaged: boolean
  /** Risk categories a GATE line or an open checkpoint covers. */
  gated: readonly string[]
  /** Risk categories a triage line rated lower with a reason (`· not security: rename`). */
  waived: readonly string[]
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
      /** Checkpoints left in the project by other sessions, or paused: /pickup's menu. */
      unfinished: number
      /** What triage since the user's last message covers: the tripwire reads it. */
      cover: Cover
    }
  }
}
