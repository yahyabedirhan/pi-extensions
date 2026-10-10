// Shipyard pings: the `shipyard ping` commands the mod runs, as argv. A
// blocked decision or a blocker pings the person, resolving it withdraws that ping, and
// the decide list sends one ping with the count of decisions to make before settling.
// register.tsx runs them; this module only builds them.

import type { Blocker, Decision } from '../types'
import { asSentence } from './text'

const FROM = 'session-status'
/** The longest title a ping gets; a longer question is cut and ends in "…". */
const TITLE_MAX = 100

/**
 * The shipyard id of one ping: `ss-<session>-<name>`. Shipyard ids are global
 * and lowercase, but decision ids (`D1`) repeat across sessions, so the id
 * carries the session id's first 8 characters (lowercase, letters and digits
 * only) too. `name` is the decision id, or `end` for the decide-list ping.
 */
export function pingId(sessionId: string, name: string): string {
  const session = sessionId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '')
  const tail = name.toLowerCase().replace(/[^a-z0-9]/g, '')

  return `ss-${session}-${tail}`
}

function title(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`
}

/** `shipyard ping` with a title, body and id; clicking it focuses the session's Herdr pane. */
function ping(heading: string, body: string, id: string): string[] {
  return ['shipyard', 'ping', title(heading), '--body', body, '--from', FROM, '--id', id, '--herdr']
}

/** The ping for a blocked decision: its question, its recommended answer and what unblocks it. */
export function blockedPing(
  sessionId: string,
  decision: Pick<Decision, 'id' | 'question' | 'default' | 'unblocks'>,
): string[] {
  return ping(
    decision.question,
    `Recommended: ${asSentence(decision.default)} To unblock: ${decision.unblocks}`,
    pingId(sessionId, decision.id),
  )
}

/** The ping for a blocker: what failed and what unblocks it. */
export function blockerPing(sessionId: string, blocker: Pick<Blocker, 'id' | 'failed' | 'needs'>): string[] {
  return ping(`Stuck: ${blocker.failed}`, `To unblock: ${blocker.needs}`, pingId(sessionId, blocker.id))
}

/** Withdraws a ping by its shipyard id (see `pingId`). */
export function withdrawPing(id: string): string[] {
  return ['shipyard', 'ping', 'withdraw', id]
}

/**
 * The decide-list ping: the count of open decisions on the list. One id per
 * session, so a second list replaces the first ping.
 */
export function endListPing(sessionId: string, decisionIds: readonly string[]): string[] {
  const count = decisionIds.length

  return ping(
    `${count} ${count === 1 ? 'decision' : 'decisions'} before settling`,
    `To decide before the session settles: ${decisionIds.join(', ')}`,
    pingId(sessionId, 'end'),
  )
}
