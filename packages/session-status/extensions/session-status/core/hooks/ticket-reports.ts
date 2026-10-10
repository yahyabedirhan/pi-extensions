// Ticket reports as data: what the orchestrator says about the tickets it
// runs. Only the orchestrator knows that a ticket is being built or that its
// commit is on the effort branch; the tracker says neither until the issue
// closes, often long after. register.tsx answers the status tool's `ticket`
// action with these rules; session-progress.ts counts the reports.

import type { SessionStatus, TicketReport } from '../types'
import { withEffort } from './effort'
import { isDeleted } from './set-by'

/** What a `ticket` call says about one ticket. `stopped` takes a started ticket back. */
export type TicketState = TicketReport['state'] | 'stopped'

/** One `ticket` call, read from its input. */
export type TicketRequest = {
  state: TicketState
  /** The ticket's issue number, when it has one. */
  number?: number
  /** The ticket's title; a ticket reported before keeps its title without one. */
  title?: string
  /** The effort's name, as its `effort:<name>` label writes it, when the call gives it. */
  effort?: string
}

/**
 * What one `ticket` call did to its ticket: nothing (`same`), moved it to the
 * state it named (`moved`), took a started ticket out (`dropped`), or took a
 * reworked one back to landed (`relanded`).
 */
export type TicketChange = 'same' | 'moved' | 'dropped' | 'relanded'

/** What one `ticket` call did: the ticket after it (null when it is not reported) and the change. */
export type TicketOutcome = { ticket: TicketReport | null; change: TicketChange }

/** The ticket's name as the tool reply writes it: `#3 Play a video`, or the title alone. */
export function ticketName(ticket: Pick<TicketReport, 'number' | 'title'>): string {
  return ticket.number === undefined ? ticket.title : `#${ticket.number} ${ticket.title}`
}

/** The ticket's short name, for lists: `#3`, or the title when it has no number. */
export function ticketShortName(ticket: Pick<TicketReport, 'number' | 'title'>): string {
  return ticket.number === undefined ? ticket.title : `#${ticket.number}`
}

/**
 * The reports of the effort the session runs now, in the order the
 * orchestrator first named them. A report made before any effort was named
 * belongs to the effort that runs now.
 */
export function effortReports(status: SessionStatus): TicketReport[] {
  const effort = status.effort?.name

  return status.ticketReports.filter(report => report.effort === undefined || report.effort === effort)
}

/** The current effort's reports of one state (see `effortReports`). */
export function reportsIn(status: SessionStatus, state: TicketReport['state']): TicketReport[] {
  return effortReports(status).filter(report => report.state === state)
}

/**
 * The status after one `ticket` call, and what the call did. A call that
 * names an effort other than the session's switches the session to it. A
 * ticket is found again by its number, or by its title when the call gives
 * no number, among the reports of the effort the call is about.
 *
 * `started` and `landed` move the ticket to that state; a landed ticket
 * started again is rework and remembers that it landed. `stopped` takes a
 * started ticket back: to landed after rework, else out of the reports. A
 * `stopped` for a ticket not started changes nothing.
 *
 * A report is a new change: it overwrites a title or state the agent set
 * with `update`. A ticket the agent deleted is not added again; `create`
 * adds it again.
 *
 * Says what is wrong when a new ticket has no title, for the model to fix
 * and call again.
 */
export function reportTicket(
  status: SessionStatus,
  request: TicketRequest,
  now: number,
): ({ status: SessionStatus } & TicketOutcome) | { error: string } {
  const switched = request.effort === undefined ? status : withEffort(status, { name: request.effort, from: 'report' })
  const reports = switched.ticketReports
  const known = effortReports(switched).find(report =>
    request.number === undefined ? report.title === request.title : report.number === request.number,
  )
  const unchanged = { status: switched, change: 'same' as const }

  if (request.state === 'stopped') {
    if (known?.state !== 'started') {
      return { ...unchanged, ticket: known ?? null }
    }
    const back: TicketReport | null =
      known.landedAt === undefined ? null : { ...withoutLandedAt(known), state: 'landed', at: known.landedAt }
    const ticketReports =
      back === null ? reports.filter(report => report !== known) : reports.map(report => (report === known ? back : report))

    return back === null
      ? { status: { ...switched, ticketReports }, ticket: known, change: 'dropped' }
      : { status: { ...switched, ticketReports }, ticket: back, change: 'relanded' }
  }

  if (known === undefined && isDeleted(switched, 'ticket', ticketShortName({ number: request.number, title: request.title ?? '' }))) {
    return { ...unchanged, ticket: null }
  }
  const title = request.title ?? known?.title
  if (title === undefined) {
    return { error: "A ticket not reported before needs `title`: the ticket's title." }
  }
  if (known !== undefined && known.state === request.state && known.title === title) {
    return { ...unchanged, ticket: known }
  }
  const ticket = nextReport(known, { state: request.state, number: request.number }, title, switched.effort?.name, now)

  return {
    status: {
      ...switched,
      ticketReports:
        known === undefined ? [...reports, ticket] : reports.map(report => (report === known ? ticket : report)),
    },
    ticket,
    change: 'moved',
  }
}

/**
 * The report a `started` or `landed` call leaves. A ticket keeps the time it
 * reached its state: a second `landed` only renames it. A landed ticket
 * started again keeps when it landed, for a `stopped` to go back to.
 */
function nextReport(
  known: TicketReport | undefined,
  request: { state: TicketReport['state']; number?: number },
  title: string,
  effort: string | undefined,
  now: number,
): TicketReport {
  const number = request.number ?? known?.number
  const at = known?.state === request.state ? known.at : now
  const landedAt = request.state === 'started' && known?.state === 'landed' ? known.at : known?.landedAt
  const ticket: TicketReport = { title, state: request.state, at }
  if (number !== undefined) {
    ticket.number = number
  }
  const owner = known?.effort ?? effort
  if (owner !== undefined) {
    ticket.effort = owner
  }
  if (request.state === 'started' && landedAt !== undefined) {
    ticket.landedAt = landedAt
  }

  return ticket
}

function withoutLandedAt(report: TicketReport): TicketReport {
  const { landedAt: _landedAt, ...rest } = report

  return rest
}
