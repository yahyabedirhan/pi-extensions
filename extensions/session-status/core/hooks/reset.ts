// Resetting the session's progress, and listing what is open, as data.
// `/session-status reset` and the status tool's `reset` action clear the
// whole record in one step, so an unrelated task starts from nothing within
// the same session (a `/clear` starts a new session, and so an empty status).
// The `list` action names every open id, which a `/compact` can leave out of
// the model's context; its filter names only the entries the model asks for.
// register.tsx runs both; nothing here calls `$`.

import type { SessionItem, SessionStatus, StatusItem } from '../types'
import { linkLabel } from './links'
import { placeId } from './places'
import { isOpen } from './status'
import { ticketName, ticketShortName } from './ticket-reports'

/** What a reset took out of the status. */
export type ResetRemoved = {
  /** Session items, dropped ones too. */
  items: number
  /** Decisions, surprises and blockers, open and closed. */
  entries: number
  /** Pull requests and issues the Links section listed. */
  links: number
  /** Reported tickets, of every effort. */
  tickets: number
  /** The effort's name; null when the session ran none. */
  effort: string | null
}

/**
 * The status without its record: the session items, the decisions,
 * surprises and blockers, the links, the reported tickets, the
 * effort and its ticket count, and the deleted entries of those kinds; and
 * what it took out. Ids start over at 1. What the session runs now stays:
 * its tasks, crons, subagents, place, places and activity, and the tasks,
 * crons and places the agent deleted.
 */
export function resetProgress(status: SessionStatus): { status: SessionStatus; removed: ResetRemoved } {
  return {
    status: {
      ...status,
      items: [],
      links: [],
      endListPostedAt: null,
      sessionItems: [],
      ticketReports: [],
      effort: null,
      tickets: null,
      deleted: status.deleted.filter(entry => KEPT_DELETES.includes(entry.kind)),
    },
    removed: {
      items: status.sessionItems.length,
      entries: status.items.length,
      links: status.links.length,
      tickets: status.ticketReports.length,
      effort: status.effort?.name ?? null,
    },
  }
}

/** The deleted entries a reset keeps: of the kinds it does not clear. */
const KEPT_DELETES: readonly string[] = ['task', 'cron', 'place']

/** What the person and the model read after a reset. */
export function resetText(removed: ResetRemoved): string {
  const parts = [
    ...(removed.items > 0 ? [count(removed.items, 'session item')] : []),
    ...(removed.entries > 0 ? [count(removed.entries, 'decision, surprise or blocker', 'decisions, surprises and blockers')] : []),
    ...(removed.links > 0 ? [count(removed.links, 'link')] : []),
    ...(removed.tickets > 0 ? [count(removed.tickets, 'ticket report')] : []),
    ...(removed.effort === null ? [] : [`the effort ${removed.effort}`]),
  ]
  if (parts.length === 0) {
    return 'Session status was empty already. Nothing changed.'
  }

  return `Session status reset: removed ${joinAnd(parts)}. Everything starts over.`
}

/**
 * The kinds of entry `list` and `read` name; an observation is a surprise
 * the observer found. `list` without a filter leaves out links, tasks, cron
 * jobs and places, which the pane shows by themselves.
 */
export const LIST_KINDS = ['item', 'decision', 'blocker', 'surprise', 'observation', 'ticket', 'effort', 'link', 'task', 'cron', 'place'] as const
export type ListKind = (typeof LIST_KINDS)[number]

/** `open`, `closed` (resolved, dismissed, done, dropped, landed, a merged or closed link, a completed task, a cron job no longer active) or `all`. */
export const LIST_STATES = ['open', 'closed', 'all'] as const
export type ListState = (typeof LIST_STATES)[number]

/**
 * What a `list` call keeps: entries of one of `kinds`, in `state`, with one
 * of `ids`. Different keys must all match; null keeps every kind or id.
 */
export type ListFilter = {
  kinds: ReadonlySet<ListKind> | null
  state: ListState
  /** As the model gave them; `matchesFilter` ignores case and a ticket's `#`. */
  ids: ReadonlySet<string> | null
}

/** What `matchesFilter` checks of one entry. */
export type ListEntry = {
  kind: ListKind
  /** `D1`, `I2`, a ticket's `#3` or title, the effort's name, a link's `repo#27`, a task's or cron job's id, a place's `owner/repo`. */
  id: string
  /** Whether it is open; null for the effort and a place, which have no state. */
  open: boolean | null
}

/** What `read` keeps without a filter: everything. */
export const EVERYTHING: ListFilter = { kinds: null, state: 'all', ids: null }

/** Whether `filter` keeps `entry`. */
export function matchesFilter(entry: ListEntry, filter: ListFilter): boolean {
  if (filter.kinds !== null && !filter.kinds.has(entry.kind)) {
    return false
  }
  if (entry.open !== null && filter.state !== 'all' && entry.open !== (filter.state === 'open')) {
    return false
  }
  if (filter.ids !== null) {
    const id = sameId(entry.id)

    return [...filter.ids].some(wanted => sameId(wanted) === id)
  }

  return true
}

/** An id as `matchesFilter` compares it: ticket `#3` is `3`, and `d1` is `D1`. */
function sameId(id: string): string {
  return id.trim().replace(/^#(?=\d+$)/, '').toUpperCase()
}

/**
 * What the model reads after `list`: one line for each entry `filter`
 * keeps, grouped by kind, each with its id; a kind with no entry is left
 * out. Without a filter it names the open entries, the done items, the
 * effort and every reported ticket.
 */
export function listText(status: SessionStatus, filter: ListFilter | null): string {
  const keep = filter === null ? keptWithoutFilter : (row: ListRow) => matchesFilter(row, filter)
  const lines: string[] = []
  const group = (heading: string, rows: ListRow[]) => {
    const kept = rows.filter(keep)
    if (kept.length > 0) {
      lines.push(`${heading}:`, ...kept.map(row => `- ${row.line}`))
    }
  }
  const closed = (item: StatusItem, word: string) => (isOpen(item) ? '' : ` (${word})`)
  const itemOrder: readonly SessionItem['state'][] = ['added', 'done', 'dropped']
  group(
    'Session items',
    itemOrder.flatMap(state => status.sessionItems.filter(item => item.state === state)).map(item => ({
      kind: 'item',
      id: item.id,
      open: item.state === 'added',
      ...(item.state === 'dropped' ? { dropped: true } : {}),
      line: `${item.id} ${item.title} (${item.state === 'added' ? 'open' : item.state})`,
    })),
  )
  group(
    'Decisions',
    status.items.flatMap(item =>
      item.kind === 'decision'
        ? [{ kind: 'decision' as const, id: item.id, open: isOpen(item), line: `${item.id} ${item.question} (${item.urgency}${isOpen(item) ? '' : ', resolved'})` }]
        : [],
    ),
  )
  group(
    'Blockers',
    status.items.flatMap(item =>
      item.kind === 'blocker'
        ? [{ kind: 'blocker' as const, id: item.id, open: isOpen(item), line: `${item.id} ${item.failed}${closed(item, 'resolved')}` }]
        : [],
    ),
  )
  const surprises = (kind: 'surprise' | 'observation') =>
    status.items.flatMap(item =>
      item.kind === 'surprise' && (item.source === 'observer' ? 'observation' : 'surprise') === kind
        ? [{ kind, id: item.id, open: isOpen(item), line: `${item.id} ${item.occurred}${closed(item, 'dismissed')}` }]
        : [],
    )
  group('Surprises', surprises('surprise'))
  group('Observations', surprises('observation'))
  group('Effort', status.effort === null ? [] : [{ kind: 'effort', id: status.effort.name, open: null, line: status.effort.name }])
  group(
    'Reported tickets',
    status.ticketReports.map(ticket => ({
      kind: 'ticket',
      id: ticketShortName(ticket),
      open: ticket.state === 'started',
      line: `${ticketName(ticket)} (${ticket.state})`,
    })),
  )
  group(
    'Links',
    status.links.map(link => ({
      kind: 'link',
      id: linkLabel(link),
      open: (link.state ?? 'open') === 'open',
      line: `${linkLabel(link)} ${link.url} (${link.state ?? 'open'}${link.fieldsSetBy?.state === undefined ? '' : ', set by hand'})`,
    })),
  )
  group(
    'Tasks',
    status.tasks.map(task => ({
      kind: 'task',
      id: task.id,
      open: task.status !== 'completed',
      line: `${task.id} ${task.subject} (${task.status})`,
    })),
  )
  group(
    'Cron jobs',
    status.crons.map(job => ({
      kind: 'cron',
      id: job.id,
      open: job.state === 'active',
      line: `${job.id} ${job.schedule}: ${job.prompt} (${job.state})`,
    })),
  )
  group(
    'Places',
    status.places.map(place => ({
      kind: 'place',
      id: placeId(place),
      open: null,
      line: `${placeId(place)} (${count(place.files.length, 'file')}, ${count(place.commands, 'command')})`,
    })),
  )

  if (lines.length > 0) {
    return lines.join('\n')
  }

  return filter === null ? 'Nothing is open, and the session has no progress.' : 'Nothing matches the filter.'
}

/** One line of `list`, and what the filter checks of it. */
type ListRow = ListEntry & {
  line: string
  /** A dropped session item, which `list` without a filter leaves out. */
  dropped?: true
}

/** What `list` names without a filter: open entries, done items, the effort and every reported ticket. */
function keptWithoutFilter(row: ListRow): boolean {
  if (PANE_KINDS.includes(row.kind)) {
    return false
  }

  return row.kind === 'ticket' || row.open !== false || (row.kind === 'item' && row.dropped !== true)
}

/** The kinds `list` without a filter leaves out. */
const PANE_KINDS: readonly ListKind[] = ['link', 'task', 'cron', 'place']

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`
}

function joinAnd(parts: readonly string[]): string {
  return parts.length === 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
