// The session's state in one word, for the top of the pane: Blocked, In
// progress, Settling, Waiting for reply or Settled. The turn events and the settle
// skills set what the session does; an open blocked decision or blocker wins over it.

import type { Activity, SessionStatus } from '../types'
import { isOpen } from './status'

/** The skills that settle a session: a Skill call to one marks it settled. */
export const SETTLE_SKILLS: readonly string[] = ['settle-session', 'settle-effort']

/** The state the pane shows, by priority; null before the first turn. */
export type Headline = 'blocked' | 'working' | 'settling' | 'waiting' | 'settled'

/** What the pane's top line says for each state. */
export const HEADLINE_TEXT: Record<Headline, string> = {
  blocked: 'Blocked',
  working: 'In progress',
  settling: 'Settling',
  waiting: 'Waiting for reply',
  settled: 'Settled',
}

/**
 * The session's state: Blocked while a blocked decision or a blocker is open; Settling
 * while a turn that runs a settle skill runs; In progress while another turn
 * or a subagent runs; else what the last turn left, waiting for a reply or
 * settled.
 */
export function headline(status: SessionStatus): Headline | null {
  const isBlocked = status.items.some(
    item => (item.kind === 'blocker' || (item.kind === 'decision' && item.urgency === 'blocked')) && isOpen(item),
  )
  if (isBlocked) {
    return 'blocked'
  }
  if (status.activity === 'settling') {
    return 'settling'
  }
  if (status.activity === 'working' || status.subagents.running.length > 0) {
    return 'working'
  }

  return status.activity
}

/** Whether a tool call runs a settle skill (a plugin's `<plugin>:<skill>` too). */
export function settles(call: { tool: string; skill?: unknown }): boolean {
  if (call.tool !== 'Skill' || typeof call.skill !== 'string') {
    return false
  }

  return SETTLE_SKILLS.includes(call.skill.slice(call.skill.lastIndexOf(':') + 1))
}

/** A settle skill's slash command: `/settle-session`, `/settle-effort` or a plugin's `/<plugin>:settle-effort`. */
const SETTLE_NAME = `\\/(?:[\\w-]+:)?(?:${SETTLE_SKILLS.join('|')})`

/**
 * A prompt that runs a settle skill as a slash command. A typed command
 * reaches `turn.start` as tags, `<command-message>…</command-message>
 * <command-name>/settle-session</command-name><command-args>…`, so the tag
 * counts wherever it is; a bare `/settle-session` counts first in the prompt.
 */
const SETTLE_COMMAND = new RegExp(`<command-name>${SETTLE_NAME}</command-name>|^\\s*${SETTLE_NAME}(?:\\s|$)`)

/** Whether a turn's prompt runs a settle skill as a slash command. */
export function settlesByPrompt(text: string): boolean {
  return SETTLE_COMMAND.test(text)
}

/**
 * The activity a turn's end leaves: settled after a settle skill ran in it,
 * else waiting for a reply. An interrupted turn did not finish its settle.
 */
export function afterTurn(activity: Activity | null, isAborted: boolean): Activity {
  return !isAborted && (activity === 'settling' || activity === 'settled') ? 'settled' : 'waiting'
}
