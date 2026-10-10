// The session status as data: the pure rules for changing it. The status
// store's reads and writes (`$.state`, `$.store`) and its atom live in
// register.tsx, because the engine follows `$` and the state library's
// sources only within the hooks module's own file.

import type { Blocker, Decision, SessionItem, SessionStatus, StatusItem } from '../types'
import { highestDeletedId } from './set-by'

/** An item before it is recorded: `recordItem` adds its id and its time. */
export type ItemDraft = StatusItem extends infer I
  ? I extends StatusItem
    ? Omit<I, 'id' | 'recordedAt'>
    : never
  : never

/** Each kind's id prefix: decisions count `D1`, `D2`, ...; surprises `S1`, ...; blockers `B1`, ... */
const ID_PREFIX = { decision: 'D', surprise: 'S', blocker: 'B' } as const

/** The kind an id names by its prefix (`B1` a blocker), or null for another prefix. */
export function kindOfId(id: string): StatusItem['kind'] | null {
  const prefix = id.trim().charAt(0).toUpperCase()
  const found = (Object.keys(ID_PREFIX) as StatusItem['kind'][]).find(kind => ID_PREFIX[kind] === prefix)

  return found ?? null
}

/** The action that closes each kind, and the word for it closed. */
const CLOSING = {
  decision: { action: 'resolve', closed: 'resolved' },
  surprise: { action: 'dismiss', closed: 'dismissed' },
  blocker: { action: 'resolve', closed: 'resolved' },
} as const

/**
 * The status with one more item, and that item: the draft given the next id
 * of its kind and the time it was recorded. Ids only grow within a session,
 * a deleted id too, so pings and resolves can name an item by its id.
 */
export function recordItem(
  status: SessionStatus,
  draft: ItemDraft,
  now: number,
): { status: SessionStatus; item: StatusItem } {
  const prefix = ID_PREFIX[draft.kind]
  const highest = status.items
    .filter(item => item.kind === draft.kind)
    .map(item => Number(item.id.slice(prefix.length)))
    .reduce((max, n) => (Number.isInteger(n) && n > max ? n : max), highestDeletedId(status, draft.kind, prefix))
  const item = { ...draft, id: `${prefix}${highest + 1}`, recordedAt: now } as StatusItem

  return { status: { ...status, items: [...status.items, item] }, item }
}

/** Whether an item is open: not resolved (a decision, a blocker) or dismissed (a surprise). */
export function isOpen(item: StatusItem): boolean {
  return item.resolvedAt === undefined
}

/** The open decisions to make before the session settles, oldest first: what the decide list holds. */
export function openToDecide(status: SessionStatus): Decision[] {
  return openOfUrgency(status, 'before_settling')
}

/** The open decisions that can wait until after the session settles, oldest first. */
export function openFollowUps(status: SessionStatus): Decision[] {
  return openOfUrgency(status, 'after_settling')
}

function openOfUrgency(status: SessionStatus, urgency: Decision['urgency']): Decision[] {
  return status.items.filter(
    (item): item is Decision => item.kind === 'decision' && item.urgency === urgency && isOpen(item),
  )
}

/**
 * The decisions the last decide list named that are still open, oldest
 * first; none before the agent posts a list. A decision recorded after the
 * list was posted is not on it.
 */
export function onEndList(status: SessionStatus): Decision[] {
  const postedAt = status.endListPostedAt

  return postedAt === null ? [] : openToDecide(status).filter(item => item.recordedAt <= postedAt)
}

/** The open blockers, oldest first. */
export function openBlockers(status: SessionStatus): Blocker[] {
  return status.items.filter((item): item is Blocker => item.kind === 'blocker' && isOpen(item))
}

/**
 * The status with one open item closed at `now`: a decision or a blocker
 * resolved, or a surprise dismissed. A surprise the user `acted` on from the
 * pane is marked acted on too. Says what is wrong when no open item of that
 * kind has the id, for the model to fix and call again.
 */
export function closeItem(
  status: SessionStatus,
  target: { kind: StatusItem['kind']; id: string },
  now: number,
  { acted = false }: { acted?: boolean } = {},
): { status: SessionStatus; item: StatusItem } | { error: string } {
  const id = target.id.trim().toUpperCase()
  const item = status.items.find(candidate => candidate.id === id)
  const noun = target.kind
  if (item === undefined || item.kind !== target.kind) {
    const hint =
      item === undefined
        ? 'Use an id from the status (D1, S1, B1, ...).'
        : `${id} is a ${item.kind}: use \`${CLOSING[item.kind].action}\`.`

    return { error: `No ${noun} ${id}. ${hint}` }
  }
  if (!isOpen(item)) {
    return { error: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${item.id} is already ${CLOSING[item.kind].closed}.` }
  }
  const done: StatusItem = item.kind === 'surprise' && acted ? { ...item, resolvedAt: now, actedAt: now } : { ...item, resolvedAt: now }

  return {
    status: { ...status, items: status.items.map(candidate => (candidate === item ? done : candidate)) },
    item: done,
  }
}

/**
 * The status with an open decision or surprise marked as in discussion at
 * `now`; the status as it was when no open item of that kind has the id.
 */
export function markDiscussing(
  status: SessionStatus,
  target: { kind: 'decision' | 'surprise'; id: string },
  now: number,
): SessionStatus {
  return {
    ...status,
    items: status.items.map(item =>
      item.kind === target.kind && item.id === target.id && isOpen(item) ? { ...item, discussingAt: now } : item,
    ),
  }
}

/** A status with nothing in it yet, for one session. */
export function emptyStatus(sessionId: string): SessionStatus {
  return {
    version: 1,
    sessionId,
    doingNow: null,
    items: [],
    tasks: [],
    progress: null,
    links: [],
    subagents: { running: [], finished: [] },
    endListPostedAt: null,
    observer: { checks: 0, seen: [] },
    effort: null,
    tickets: null,
    ticketReports: [],
    sessionItems: [],
    place: null,
    places: [],
    crons: [],
    activity: null,
    deleted: [],
    updatedAt: null,
  }
}

/**
 * A status held from an older shape, with the fields it lacks taken from an
 * empty status; null stays null.
 */
export function withDefaults(status: SessionStatus | null): SessionStatus | null {
  if (status === null) {
    return null
  }
  const full = { ...emptyStatus(status.sessionId), ...status }

  return full.items.some(isOldUrgency) ? { ...full, items: full.items.map(withNewUrgency) } : full
}

/** A decision saved before 0.4.0 with `review_later`: it reads as `before_settling`. */
function isOldUrgency(item: StatusItem): boolean {
  return item.kind === 'decision' && (item.urgency as string) === 'review_later'
}

function withNewUrgency<T extends StatusItem>(item: T): T {
  return isOldUrgency(item) ? { ...item, urgency: 'before_settling' } : item
}

/**
 * A value read from `$.store` as the saved status of `sessionId`, or null
 * when it is not one: missing, another session's, or not a status at all.
 */
export function savedStatus(value: unknown, sessionId: string): SessionStatus | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const status = value as Partial<SessionStatus>
  if (status.version !== 1 || status.sessionId !== sessionId || !Array.isArray(status.items)) {
    return null
  }

  return withDefaults(status as SessionStatus)
}

/**
 * The status `sessionId` holds, given the one held now and the one saved for
 * it: the held one when it is this session's; else the saved one (a resume);
 * else none. A status belongs to one session id: a `/clear`, a fork or a
 * resume with nothing saved starts empty, never with the status the process
 * held before.
 */
export function statusForSession(
  held: SessionStatus | null,
  sessionId: string,
  saved: SessionStatus | null,
): SessionStatus | null {
  if (held?.sessionId === sessionId) {
    return held
  }

  return saved
}

/**
 * How many of each list a status keeps within a session: finished subagent
 * ids, links, reported tickets, session items, deleted entries, the files of each place, and
 * closed items of each kind. The oldest drop first (reported tickets and
 * files by their last change); an open item never drops.
 */
export const CAP = 200

/** How many places a status keeps; the one changed longest ago drops first. */
export const PLACES_KEPT = 50

/**
 * The status within its bounds (see CAP). The newest closed item of each
 * kind always stays, so the next id of that kind never repeats an old one.
 */
export function withinBounds(status: SessionStatus): SessionStatus {
  const closedCount = { decision: 0, surprise: 0, blocker: 0 }
  for (const item of status.items) {
    if (!isOpen(item)) {
      closedCount[item.kind] += 1
    }
  }
  const isOver =
    status.subagents.finished.length > CAP ||
    status.links.length > CAP ||
    status.ticketReports.length > CAP ||
    status.sessionItems.length > CAP ||
    status.crons.length > CAP ||
    status.deleted.length > CAP ||
    status.places.length > PLACES_KEPT ||
    status.places.some(place => place.files.length > CAP) ||
    closedCount.decision > CAP ||
    closedCount.surprise > CAP ||
    closedCount.blocker > CAP
  if (!isOver) {
    return status
  }
  const toDrop = {
    decision: closedCount.decision - CAP,
    surprise: closedCount.surprise - CAP,
    blocker: closedCount.blocker - CAP,
  }
  const items = status.items.filter(item => {
    if (isOpen(item) || toDrop[item.kind] <= 0) {
      return true
    }
    toDrop[item.kind] -= 1

    return false
  })

  return {
    ...status,
    items,
    links: status.links.slice(-CAP),
    ticketReports: newestByChange(status.ticketReports, CAP),
    sessionItems: newestSessionItems(status.sessionItems),
    crons: newestByChange(status.crons, CAP),
    deleted: status.deleted.slice(-CAP),
    places: newestByChange(status.places, PLACES_KEPT).map(place => ({ ...place, files: place.files.slice(-CAP) })),
    subagents: { ...status.subagents, finished: status.subagents.finished.slice(-CAP) },
  }
}

/**
 * The `limit` entries that changed last, in their order. A ticket that
 * landed long ago drops before one started since, so past the cap the
 * Session count holds the run's recent tickets.
 */
function newestByChange<T extends { at: number }>(reports: readonly T[], limit: number): T[] {
  if (reports.length <= limit) {
    return [...reports]
  }
  const kept = new Set(
    reports
      .map((report, index) => ({ at: report.at, index }))
      .sort((a, b) => b.at - a.at || b.index - a.index)
      .slice(0, limit)
      .map(entry => entry.index),
  )

  return reports.filter((_report, index) => kept.has(index))
}

/**
 * The session items within CAP: open items always stay; done and dropped
 * ones drop by their last change. The newest item always stays, so the
 * next id never repeats an old one.
 */
function newestSessionItems(items: readonly SessionItem[]): SessionItem[] {
  if (items.length <= CAP) {
    return [...items]
  }
  const last = items[items.length - 1]
  const closed = items.filter(item => item.state !== 'added' && item !== last)
  const kept = new Set(newestByChange(closed, Math.max(CAP - (items.length - closed.length), 0)))

  return items.filter(item => item.state === 'added' || item === last || kept.has(item))
}

/** How many sessions' statuses `$.store` keeps; older ones are dropped. */
export const KEPT_SESSIONS = 30

/**
 * The store keys to delete so at most KEPT_SESSIONS sessions stay: the
 * oldest by their last update, a value that is not a status counting as
 * oldest. The current session always stays.
 */
export function keysToPrune(saved: { key: string; value: unknown }[], current: string): string[] {
  if (saved.length <= KEPT_SESSIONS) {
    return []
  }
  const updatedAt = (value: unknown) => {
    const at = (value as { updatedAt?: unknown } | null)?.updatedAt

    return typeof at === 'number' ? at : 0
  }
  const others = saved
    .filter(entry => entry.key !== current)
    .sort((a, b) => updatedAt(b.value) - updatedAt(a.value))
  const kept = saved.length - others.length

  return others.slice(Math.max(KEPT_SESSIONS - kept, 0)).map(entry => entry.key)
}

/**
 * The status after one change: `change` applied to the current status (an
 * empty one before the first change), kept within its bounds and stamped
 * with the session and the time. A current status of another session is
 * never stamped with this one: the change applies to an empty status.
 */
export function applyChange(
  current: SessionStatus | null,
  change: (status: SessionStatus) => SessionStatus,
  stamp: { sessionId: string; now: number },
): SessionStatus {
  const held = withDefaults(current)
  const base = held !== null && held.sessionId === stamp.sessionId ? held : emptyStatus(stamp.sessionId)

  return { ...withinBounds(change(base)), sessionId: stamp.sessionId, updatedAt: stamp.now }
}
