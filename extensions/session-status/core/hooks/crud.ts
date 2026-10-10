// The status tool's generic actions as data: `create`, `read`, `update` and
// `delete`, the same way on every kind of entry. One table names each kind's
// fields; the four pure functions change a SessionStatus by it. The older
// actions (`record_decision`, `item`, `link`, `resolve`, ...) are shortcuts
// that call the same functions. register.tsx runs them and sends the pings;
// nothing here calls `$`.

import type { Blocker, CronJob, Decision, DecisionUrgency, LinkState, SessionLink, SessionStatus, StatusItem, Task } from '../types'
import type { ListFilter } from './reset'
import { EVERYTHING, listText } from './reset'
import { linkLabel, linksFound, readPageUrl } from './links'
import type { FoundLink } from './links'
import { pingId } from './pings'
import { placeId } from './places'
import { movedItem, reportItem } from './session-items'
import type { ItemState } from './session-items'
import { manualSet, sameKey, withDeleted, withoutDeleted } from './set-by'
import { closeItem, isOpen, recordItem } from './status'
import type { ItemDraft } from './status'
import { deletedTaskKey, taskCreated, taskUpdated, withTasks } from './tasks'
import { effortReports, reportTicket, ticketShortName } from './ticket-reports'

/** The kinds of entry the generic actions change. An observation is a `surprise`. */
export const CRUD_KINDS = ['item', 'decision', 'surprise', 'blocker', 'ticket', 'link', 'effort', 'task', 'cron', 'place'] as const
export type CrudKind = (typeof CRUD_KINDS)[number]

/** What the table says of one kind. */
type KindSpec = {
  /** The kind's name in a reply: `Item I5 deleted.` */
  noun: string
  /** How an id of the kind is written, for an error. */
  id: string
  /** The fields `create` takes; none when only an automatic source creates the kind. */
  create: readonly string[]
  /** The fields `update` can set. */
  update: readonly string[]
  /** The values each field of a fixed set takes. */
  values?: Readonly<Record<string, readonly string[]>>
}

export const URGENCIES: readonly DecisionUrgency[] = ['blocked', 'before_settling', 'after_settling']
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4
const DECISION_FIELDS = ['urgency', 'question', 'options', 'default', 'unblocks'] as const

/** Each kind's id, fields and values: what the status tool checks a call against. */
export const KINDS: Readonly<Record<CrudKind, KindSpec>> = {
  item: { noun: 'Item', id: 'I5', create: ['title'], update: ['title', 'state'], values: { state: ['added', 'done', 'dropped'] } },
  decision: {
    noun: 'Decision',
    id: 'D1',
    create: DECISION_FIELDS,
    update: [...DECISION_FIELDS, 'state'],
    values: { state: ['open', 'resolved'], urgency: URGENCIES },
  },
  surprise: { noun: 'Surprise', id: 'S2', create: ['occurred', 'changed'], update: ['occurred', 'changed', 'state'], values: { state: ['open', 'dismissed'] } },
  blocker: { noun: 'Blocker', id: 'B1', create: ['failed', 'needs'], update: ['failed', 'needs', 'state'], values: { state: ['open', 'resolved'] } },
  ticket: { noun: 'Ticket', id: '#4', create: ['number', 'title', 'state', 'effort'], update: ['title', 'state'], values: { state: ['started', 'landed'] } },
  link: { noun: 'Link', id: 'claude-mods#27', create: ['url'], update: ['state'], values: { state: ['open', 'merged', 'closed'] } },
  effort: { noun: 'Effort', id: "the effort's name", create: ['name'], update: ['name'] },
  task: { noun: 'Task', id: 'the task id', create: ['subject', 'status'], update: ['subject', 'status'], values: { status: ['pending', 'in_progress', 'completed'] } },
  cron: { noun: 'Cron job', id: 'the job id', create: [], update: ['state'], values: { state: ['active', 'fired', 'expired', 'cancelled'] } },
  place: { noun: 'Place', id: 'owner/repo', create: [], update: [] },
}

/** One generic call, read from its input. */
export type CrudRequest =
  | { action: 'create'; kind: CrudKind; fields: Fields }
  | { action: 'read'; filter: ListFilter | null }
  | { action: 'update'; kind: CrudKind; id: string; fields: Fields }
  | { action: 'delete'; kind: CrudKind; id: string }

type Fields = Readonly<Record<string, unknown>>

/** Who calls, and when: a subagent's id rides the call. */
export type CrudContext = { now: number; agentId?: string }

/**
 * What a create, update or delete did: the status after it and its one-line
 * reply. A decision or blocker it touched comes before and after, so
 * register.tsx can send or withdraw its ping.
 */
export type CrudOutcome = {
  status: SessionStatus
  text: string
  pinged?: { before: StatusItem | null; after: StatusItem | null }
}

/** A failed call: what is wrong, for the model to fix and call again. */
export type CrudError = { error: string }

/**
 * The error for a call whose kind or fields the table does not have; null
 * when they all are. `create` and `update` check their own field lists.
 */
export function checkFields(action: 'create' | 'update', kind: CrudKind, fields: Fields): string | null {
  const spec = KINDS[kind]
  const allowed = spec[action]
  if (allowed.length === 0) {
    return action === 'create'
      ? `A ${spec.noun.toLowerCase()} is created only by ${kind === 'cron' ? 'CronCreate' : 'the changes the session makes'}. Use \`create\` for: ${CRUD_KINDS.filter(k => KINDS[k].create.length > 0).join(', ')}.`
      : `A ${spec.noun.toLowerCase()} has no field that \`update\` can set. Use \`delete\` to remove it.`
  }
  const unknown = Object.keys(fields).filter(field => !allowed.includes(field))
  if (unknown.length > 0) {
    return `A ${spec.noun.toLowerCase()} has no field ${unknown.map(f => `\`${f}\``).join(', ')} that \`${action}\` can set. Use: ${allowed.join(', ')}.`
  }
  if (action === 'update' && Object.keys(fields).length === 0) {
    return `\`update\` needs \`fields\`: the fields to change. A ${spec.noun.toLowerCase()} has: ${allowed.join(', ')}.`
  }
  for (const [field, values] of Object.entries(spec.values ?? {})) {
    const value = fields[field]
    if (value !== undefined && !values.includes(value as string)) {
      return `A ${spec.noun.toLowerCase()}'s \`${field}\` is one of: ${values.join(', ')}.`
    }
  }

  return null
}

/** What `read` returns: the entries `filter` keeps, or every entry without one. */
export function readEntries(status: SessionStatus, filter: ListFilter | null): string {
  return listText(status, filter ?? EVERYTHING)
}

// create

/**
 * Reads a decision's, surprise's or blocker's fields into the item to
 * record, or says which one is missing. `record_decision`, `record_surprise`
 * and `record_blocker` read their input with it too.
 */
export function readDraft(kind: StatusItem['kind'], fields: Fields): ItemDraft | CrudError {
  switch (kind) {
    case 'decision': {
      // `review_later` is the name before 0.4.0 of `before_settling`.
      const urgency = fields.urgency === 'review_later' ? 'before_settling' : fields.urgency
      if (!URGENCIES.includes(urgency as DecisionUrgency)) {
        return { error: 'A decision needs an urgency: `blocked`, `before_settling` or `after_settling`.' }
      }
      const question = text(fields.question)
      if (question === null) {
        return { error: 'A decision needs a question.' }
      }
      const options = readOptions(fields.options)
      if (options === null) {
        return { error: 'A decision needs two to four options, each a non-empty string.' }
      }
      const fallback = text(fields.default)
      if (fallback === null) {
        return { error: 'A decision needs a default: the answer you recommend.' }
      }
      const unblocks = text(fields.unblocks)
      if (unblocks === null) {
        return { error: 'A decision needs `unblocks`: what the user must say or do to settle it.' }
      }

      return { kind, urgency: urgency as DecisionUrgency, question, options, default: fallback, unblocks }
    }
    case 'surprise': {
      const occurred = text(fields.occurred)
      if (occurred === null) {
        return { error: 'A surprise needs `occurred`: what occurred.' }
      }
      const changed = text(fields.changed)
      if (changed === null) {
        return { error: 'A surprise needs `changed`: what it changed in the work or the plan.' }
      }
      // `suggested_action`: the input's `action` names the tool's own action.
      const action = text(fields.suggested_action)

      return { kind, occurred, changed, ...(action === null ? {} : { action }) }
    }
    case 'blocker': {
      const failed = text(fields.failed)
      if (failed === null) {
        return { error: 'A blocker needs `failed`: what you tried that failed.' }
      }
      const needs = text(fields.needs)
      if (needs === null) {
        return { error: 'A blocker needs `needs`: what the user can do to unblock you.' }
      }

      return { kind, failed, needs }
    }
  }
}

/**
 * The status with one more decision, surprise or blocker, and that item. A
 * blocked decision or a blocker keeps the id of the ping it sends, so a
 * resolve after a /clear withdraws that ping.
 */
export function recordDraft(status: SessionStatus, draft: ItemDraft, now: number): { status: SessionStatus; item: StatusItem } {
  const recorded = recordItem(status, draft, now)
  if (!pings(recorded.item)) {
    return recorded
  }
  const pinged = { ...recorded.item, pingId: pingId(status.sessionId, recorded.item.id) }

  return {
    status: { ...recorded.status, items: recorded.status.items.map(item => (item === recorded.item ? pinged : item)) },
    item: pinged,
  }
}

/**
 * The status with a page the agent links: listed once, and no longer
 * deleted, so the automatic sources keep it again. `link` and `create` both
 * call it. `isAdded` is false when the page was listed already.
 */
export function linkPage(
  status: SessionStatus,
  link: FoundLink,
  stamp: { agentId?: string; at: number },
): { status: SessionStatus; isAdded: boolean } {
  const restored = withoutDeleted(status, 'link', link.url)
  const linked = linksFound(restored, [link], stamp)
  if (linked === restored) {
    return { status, isAdded: false }
  }

  return { status: { ...linked, links: linked.links.map(known => (known.url === link.url ? { ...known, setBy: 'manual' as const } : known)) }, isAdded: true }
}

/** The status with one new entry of `kind`, made from `fields`. */
export function createEntry(
  status: SessionStatus,
  kind: CrudKind,
  fields: Fields,
  context: CrudContext,
): CrudOutcome | CrudError {
  const wrong = checkFields('create', kind, fields)
  if (wrong !== null) {
    return { error: wrong }
  }
  const { now } = context
  switch (kind) {
    case 'item': {
      if (context.agentId !== undefined) {
        return { error: 'Only the main session reports items. Put the work in your final report.' }
      }
      const title = text(fields.title)
      if (title === null) {
        return { error: 'A new item needs `title`: the work, in a few words.' }
      }
      const outcome = reportItem(status, { state: 'added', title }, now)
      if ('error' in outcome) {
        return outcome
      }

      return { status: outcome.status, text: `Item ${outcome.item.id} created.` }
    }
    case 'decision':
    case 'surprise':
    case 'blocker': {
      const draft = readDraft(kind, fields)
      if ('error' in draft) {
        return draft
      }
      const { status: next, item } = recordDraft(status, context.agentId === undefined ? draft : { ...draft, agentId: context.agentId }, now)

      return { status: next, text: `${KINDS[kind].noun} ${item.id} created.`, pinged: { before: null, after: item } }
    }
    case 'ticket': {
      const number = ticketNumber(fields.number)
      if (number === null) {
        return { error: "A ticket's `number` is its issue number: a positive integer." }
      }
      const title = text(fields.title)
      if (number === undefined && title === null) {
        return { error: 'A ticket needs `number` (its issue number) or, when it has none, `title`.' }
      }
      const state = fields.state === undefined ? 'started' : (fields.state as 'started' | 'landed')
      const effort = text(fields.effort)
      const restored = withoutDeleted(status, 'ticket', ticketShortName({ number, title: title ?? '' }))
      const outcome = reportTicket(
        restored,
        { state, ...(number === undefined ? {} : { number }), ...(title === null ? {} : { title }), ...(effort === null ? {} : { effort }) },
        now,
      )
      if ('error' in outcome) {
        return outcome
      }
      const name = ticketShortName(outcome.ticket ?? { number, title: title ?? '' })

      return outcome.change === 'same'
        ? { status, text: `Ticket ${name} exists already. Nothing changed.` }
        : { status: outcome.status, text: `Ticket ${name} created.` }
    }
    case 'link': {
      const link = readPageUrl(text(fields.url) ?? '')
      if (link === null) {
        return { error: 'A link needs `url`: the page of a GitHub pull request or issue, as https://github.com/<owner>/<repo>/pull/<number> or .../issues/<number>.' }
      }
      const linked = linkPage(status, link, { agentId: context.agentId, at: now })

      return linked.isAdded
        ? { status: linked.status, text: `Link ${linkLabel(link)} created.` }
        : { status, text: `Link ${linkLabel(link)} exists already. Nothing changed.` }
    }
    case 'effort': {
      const name = text(fields.name)
      if (name === null) {
        return { error: "An effort needs `name`: the name in its `effort:<name>` label." }
      }
      const restored = withoutDeleted(status, 'effort', name)

      return { status: { ...restored, effort: { name, from: 'report', setBy: 'manual' } }, text: `Effort ${name} created.` }
    }
    case 'task': {
      const subject = text(fields.subject)
      if (subject === null) {
        return { error: 'A task needs `subject`: its title.' }
      }
      const id = nextTaskId(status)
      const created = taskCreated(status, { id, subject }, now)
      const moved = fields.status === undefined ? created : taskUpdated(created, { id, status: fields.status as Task['status'] }, now)

      return {
        status: withTasks(
          moved,
          moved.tasks.map(task =>
            task.id === id ? { ...task, setBy: 'manual' as const, ...(context.agentId === undefined ? {} : { agentId: context.agentId }) } : task,
          ),
        ),
        text: `Task ${id} created.`,
      }
    }
    case 'cron':
    case 'place':
      // checkFields refused these above: only their automatic sources create them.
      return { error: checkFields('create', kind, {}) ?? 'Not created.' }
  }
}

// update

/** The status with the given fields of one entry changed; a closed entry can open again. */
export function updateEntry(
  status: SessionStatus,
  kind: CrudKind,
  id: string,
  fields: Fields,
  context: CrudContext,
): CrudOutcome | CrudError {
  const wrong = checkFields('update', kind, fields)
  if (wrong !== null) {
    return { error: wrong }
  }
  const found = findEntry(status, kind, id, context)
  if ('error' in found) {
    return found
  }
  const { now } = context
  const said = `${KINDS[kind].noun} ${found.name} updated: ${Object.entries(fields)
    .map(([field, value]) => `${field} ${Array.isArray(value) ? value.join(' / ') : String(value)}`)
    .join(', ')}.`
  switch (found.kind) {
    case 'item': {
      const title = fields.title === undefined ? undefined : text(fields.title)
      if (title === null) {
        return { error: "An item's `title` is a non-empty string." }
      }
      const moved = movedItem(status, found.entry, { title, state: fields.state as ItemState | undefined }, now)

      return { status: moved.status, text: said }
    }
    case 'status-item': {
      const before = found.entry
      const changed = changedItem(before, fields)
      if ('error' in changed) {
        return changed
      }
      let next = { ...status, items: status.items.map(item => (item === before ? changed.item : item)) }
      let after = changed.item
      if (fields.state !== undefined && fields.state !== 'open' && isOpen(after)) {
        const closed = closeItem(next, { kind: after.kind, id: after.id }, now)
        if ('error' in closed) {
          return closed
        }
        next = closed.status
        after = closed.item
      }
      if (pings(after) && after.pingId === undefined && isOpen(after)) {
        const pinged = { ...after, pingId: pingId(status.sessionId, after.id) }
        next = { ...next, items: next.items.map(item => (item === after ? pinged : item)) }
        after = pinged
      }

      return { status: next, text: said, pinged: { before, after } }
    }
    case 'ticket': {
      const title = fields.title === undefined ? undefined : text(fields.title)
      if (title === null) {
        return { error: "A ticket's `title` is a non-empty string." }
      }
      const known = found.entry
      const state = fields.state as 'started' | 'landed' | undefined
      let ticket = title === undefined ? known : manualSet(known, 'title', title)
      if (state !== undefined && state !== known.state) {
        ticket = { ...manualSet(ticket, 'state', state), at: now }
      }

      return { status: { ...status, ticketReports: status.ticketReports.map(report => (report === known ? ticket : report)) }, text: said }
    }
    case 'link': {
      const known = found.entry
      const link = manualSet({ ...known, state: known.state ?? 'open' }, 'state', fields.state as LinkState)

      return { status: { ...status, links: status.links.map(candidate => (candidate === known ? link : candidate)) }, text: said }
    }
    case 'effort': {
      const name = text(fields.name)
      if (name === null) {
        return { error: "An effort's `name` is a non-empty string." }
      }

      return { status: { ...status, effort: manualSet(found.entry, 'name', name) }, text: said }
    }
    case 'task': {
      const subject = fields.subject === undefined ? undefined : text(fields.subject)
      if (subject === null) {
        return { error: "A task's `subject` is a non-empty string." }
      }
      let task: Task = { ...found.entry, at: now }
      if (subject !== undefined) {
        task = manualSet(task, 'subject', subject)
      }
      if (fields.status !== undefined) {
        task = manualSet(task, 'status', fields.status as Task['status'])
      }

      return { status: withTasks(status, status.tasks.map(candidate => (candidate === found.entry ? task : candidate))), text: said }
    }
    case 'cron': {
      const job = { ...manualSet(found.entry, 'state', fields.state as CronJob['state']), at: now }

      return { status: { ...status, crons: status.crons.map(candidate => (candidate === found.entry ? job : candidate)) }, text: said }
    }
    case 'place':
      // checkFields refused this above: a place has no field to set.
      return { error: checkFields('update', 'place', { any: true }) ?? 'Not updated.' }
  }
}

/** A decision, surprise or blocker with the given fields set, opened again when `state` is `open`. */
function changedItem(item: StatusItem, fields: Fields): { item: StatusItem } | CrudError {
  const next: Record<string, unknown> = { ...item }
  for (const [field, value] of Object.entries(fields)) {
    if (field === 'state') {
      if (value === 'open') {
        // Open again, so no longer acted on from the pane either.
        delete next.resolvedAt
        delete next.actedAt
      }
      continue
    }
    if (field === 'options') {
      const options = readOptions(value)
      if (options === null) {
        return { error: 'A decision needs two to four options, each a non-empty string.' }
      }
      next.options = options
      continue
    }
    const set = field === 'urgency' ? value : text(value)
    if (set === null) {
      return { error: `A ${item.kind}'s \`${field}\` is a non-empty string.` }
    }
    next[field] = set
  }

  return { item: next as StatusItem }
}

// delete

/** The status without one entry. An automatic source does not add it again, and its id is not given again. */
export function deleteEntry(status: SessionStatus, kind: CrudKind, id: string, context: CrudContext): CrudOutcome | CrudError {
  const found = findEntry(status, kind, id, context)
  if ('error' in found) {
    return found
  }
  const said = `${KINDS[kind].noun} ${found.name} deleted.`
  const { now } = context
  switch (found.kind) {
    case 'item':
      return {
        status: withDeleted({ ...status, sessionItems: status.sessionItems.filter(item => item !== found.entry) }, 'item', found.entry.id, now),
        text: said,
      }
    case 'status-item': {
      const before = found.entry
      const next = withDeleted({ ...status, items: status.items.filter(item => item !== before) }, before.kind, before.id, now)

      return { status: next, text: said, pinged: { before, after: null } }
    }
    case 'ticket':
      return {
        status: withDeleted({ ...status, ticketReports: status.ticketReports.filter(report => report !== found.entry) }, 'ticket', found.name, now),
        text: said,
      }
    case 'link':
      return {
        status: withDeleted({ ...status, links: status.links.filter(link => link !== found.entry) }, 'link', found.entry.url, now),
        text: said,
      }
    case 'effort':
      return { status: withDeleted({ ...status, effort: null, tickets: null }, 'effort', found.entry.name, now), text: said }
    case 'task':
      return {
        status: withDeleted(taskUpdated(status, { id: found.entry.id, status: 'deleted' }, now), 'task', deletedTaskKey(found.entry), now),
        text: said,
      }
    case 'cron':
      return {
        status: withDeleted({ ...status, crons: status.crons.filter(job => job !== found.entry) }, 'cron', found.entry.id, now),
        text: said,
      }
    case 'place': {
      // A place is known by its GitHub name and by its folder: both are remembered.
      const removed = status.places.filter(place => sameKey(placeId(place)) === sameKey(found.name))
      const kept = { ...status, places: status.places.filter(place => !removed.includes(place)) }
      const next = [found.name, ...removed.map(place => place.key)].reduce((current, key) => withDeleted(current, 'place', key, now), kept)

      return { status: next, text: said }
    }
  }
}

// finding an entry

/** One entry `findEntry` found, with the name a reply gives it. */
type Found =
  | { kind: 'item'; entry: SessionStatus['sessionItems'][number]; name: string }
  | { kind: 'status-item'; entry: StatusItem; name: string }
  | { kind: 'ticket'; entry: SessionStatus['ticketReports'][number]; name: string }
  | { kind: 'link'; entry: SessionLink; name: string }
  | { kind: 'effort'; entry: NonNullable<SessionStatus['effort']>; name: string }
  | { kind: 'task'; entry: Task; name: string }
  | { kind: 'cron'; entry: CronJob; name: string }
  | { kind: 'place'; entry: SessionStatus['places'][number]; name: string }

/**
 * The entry of `kind` with `id`, or what is wrong: an unknown id names the
 * ids there are, and a subagent finds only the entries it created.
 */
function findEntry(status: SessionStatus, kind: CrudKind, id: string, context: CrudContext): Found | CrudError {
  const wanted = sameKey(id)
  const same = (candidate: string) => sameKey(candidate) === wanted
  const candidates = entriesOf(status, kind)
  const found = candidates.find(candidate => candidate.keys.some(same))
  if (found === undefined) {
    const ids = candidates.map(candidate => candidate.found.name)

    return {
      error: `No ${KINDS[kind].noun.toLowerCase()} ${id.trim()}. ${
        ids.length === 0 ? `The status has no ${KINDS[kind].noun.toLowerCase()}.` : `Use one of: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', ...' : ''}.`
      }`,
    }
  }
  if (context.agentId !== undefined) {
    const owner = 'agentId' in found.found.entry ? found.found.entry.agentId : undefined
    if (owner !== context.agentId) {
      return { error: `A subagent can change only the entries that it created. ${KINDS[kind].noun} ${found.found.name} is not one of them.` }
    }
  }

  return found.found
}

/** Every entry of `kind`, with the keys an id can name it by. */
function entriesOf(status: SessionStatus, kind: CrudKind): { found: Found; keys: string[] }[] {
  switch (kind) {
    case 'item':
      return status.sessionItems.map(entry => ({ found: { kind, entry, name: entry.id }, keys: [entry.id] }))
    case 'decision':
    case 'surprise':
    case 'blocker':
      return status.items
        .filter(entry => entry.kind === kind)
        .map(entry => ({ found: { kind: 'status-item', entry, name: entry.id }, keys: [entry.id] }))
    case 'ticket':
      return effortReports(status).map(entry => ({
        found: { kind, entry, name: ticketShortName(entry) },
        keys: [ticketShortName(entry), entry.title],
      }))
    case 'link':
      return status.links.map(entry => ({
        found: { kind, entry, name: linkLabel(entry) },
        keys: [linkLabel(entry), `${entry.repo}#${entry.number}`, entry.url],
      }))
    case 'effort':
      return status.effort === null ? [] : [{ found: { kind, entry: status.effort, name: status.effort.name }, keys: [status.effort.name] }]
    case 'task':
      return status.tasks.map(entry => ({ found: { kind, entry, name: entry.id }, keys: [entry.id] }))
    case 'cron':
      return status.crons.map(entry => ({ found: { kind, entry, name: entry.id }, keys: [entry.id] }))
    case 'place': {
      const seen = new Set<string>()

      return status.places.flatMap(entry => {
        const name = placeId(entry)
        if (seen.has(name.toLowerCase())) {
          return []
        }
        seen.add(name.toLowerCase())

        return [{ found: { kind, entry, name }, keys: [name, entry.key, entry.name] }]
      })
    }
  }
}

/** The id of a task the agent creates: `manual-1`, `manual-2`, ..., never one used before. */
function nextTaskId(status: SessionStatus): string {
  const used = [...status.tasks.map(task => task.id), ...status.deleted.filter(entry => entry.kind === 'task').map(entry => entry.key)]
  const highest = used
    .map(id => (/^manual-(\d+)$/.exec(id)?.[1] ?? '0'))
    .map(Number)
    .reduce((max, n) => (n > max ? n : max), 0)

  return `manual-${highest + 1}`
}

/** Whether an item pings the person: a blocked decision or a blocker. */
export function pings(item: StatusItem): item is Decision | Blocker {
  return item.kind === 'blocker' || (item.kind === 'decision' && item.urgency === 'blocked')
}

/** A decision's options: two to four non-empty strings, or null. */
function readOptions(value: unknown): string[] | null {
  const options = Array.isArray(value) ? value.map(text) : []

  return options.length < MIN_OPTIONS || options.length > MAX_OPTIONS || options.some(option => option === null)
    ? null
    : (options as string[])
}

/**
 * A ticket's issue number from the input: `3`, `"3"` and `"#3"` all read as
 * 3; undefined when the input has none; null when it is no issue number.
 */
export function ticketNumber(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const number = typeof value === 'string' ? Number(value.trim().replace(/^#/, '')) : value

  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null
}

/** A trimmed, non-empty string, or null. */
export function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}
