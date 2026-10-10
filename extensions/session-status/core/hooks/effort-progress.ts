// Effort progress as data: the tracker's count of the effort's tickets,
// closed of all its `effort:<name>` issues. It never mixes in what the
// orchestrator reported: that is the session's progress (see
// session-progress.ts). This module builds the `gh` command, reads its output
// and says when to read again; register.tsx runs the command and keeps the
// count in the status.

import type { SessionStatus, TicketCount, TrackedTicket } from '../types'
import { isQaTitle } from './session-progress'

/** The least time between two ticket reads that no ticket change asked for. */
export const TICKET_REFRESH_MS = 2 * 60_000

/**
 * The least time between two reads while the status holds no count for the
 * effort: a read failed, or a `/clear` started the status over.
 */
export const TICKET_RETRY_MS = 30_000

/** How long one `gh issue list` may run. */
export const TICKET_TIMEOUT_MS = 15_000

/** A Bash command that likely changed a ticket: closed, reopened, edited, or a PR merged. */
const TICKET_CHANGE = /\bgh\s+(?:issue\s+(?:close|reopen|edit)|pr\s+merge)\b/

/**
 * An issue whose title starts with `Spec:` is the effort's spec, not one of
 * its tickets: it stays open while the tickets close, so it is not counted.
 */
const SPEC_TITLE = /^\s*spec:/i

/** The `gh` command that lists every issue of the effort, open and closed. */
export function ticketListArgv(effort: string): string[] {
  return [
    'gh',
    'issue',
    'list',
    '--label',
    `effort:${effort}`,
    '--state',
    'all',
    '--limit',
    '200',
    '--json',
    'number,title,state,labels',
  ]
}

/**
 * The tickets closed, the total, the tickets to build and each ticket from
 * `gh issue list --json` output; null when the output is not such a list, so the last good
 * count holds. The total keeps the `QA:` tickets: the effort is not finished
 * until they close. The tickets to build leave them out: the orchestrator
 * never lands one, so the session's count would stop short of them.
 */
export function parseTicketList(stdout: string): Pick<TicketCount, 'done' | 'total' | 'builds' | 'list'> | null {
  let issues: unknown
  try {
    issues = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(issues)) {
    return null
  }
  const tickets = issues.filter(
    (issue): issue is { number?: unknown; title?: unknown; state?: unknown } =>
      typeof issue === 'object' && issue !== null && !(typeof issue.title === 'string' && SPEC_TITLE.test(issue.title)),
  )
  const closed = tickets.filter(issue => typeof issue.state === 'string' && issue.state.toUpperCase() === 'CLOSED')

  const qa = tickets.filter(issue => typeof issue.title === 'string' && isQaTitle(issue.title))

  const list = tickets.flatMap((issue): TrackedTicket[] =>
    typeof issue.number === 'number' && typeof issue.title === 'string'
      ? [{ number: issue.number, title: issue.title, isClosed: closed.includes(issue) }]
      : [],
  )

  return { done: closed.length, total: tickets.length, builds: tickets.length - qa.length, list }
}

/** Whether a tool call likely changed the effort's tickets. */
export function changesTickets(call: { tool: string }): boolean {
  const command = (call as unknown as Record<string, unknown>).command

  return call.tool === 'Bash' && typeof command === 'string' && TICKET_CHANGE.test(command)
}

/**
 * Whether to read the effort's tickets after a tool call: never outside an
 * effort; else on the effort's first read, after a call that likely changed
 * a ticket, or when the last read is TICKET_REFRESH_MS old (TICKET_RETRY_MS
 * while the status holds no count for the effort).
 */
export function isTicketReadDue(
  status: SessionStatus | null,
  lastRead: { effort: string; at: number } | null,
  call: { tool: string },
  now: number,
): boolean {
  const effort = status?.effort?.name
  if (effort === undefined) {
    return false
  }
  if (lastRead?.effort !== effort || changesTickets(call)) {
    return true
  }
  const isCounted = status?.tickets?.effort === effort

  return now - lastRead.at >= (isCounted ? TICKET_REFRESH_MS : TICKET_RETRY_MS)
}

/**
 * The effort's tickets closed and the total, as the tracker last counted
 * them: null outside an effort, before the first count for it, and while the
 * effort has no tickets.
 */
export function effortProgress(status: SessionStatus | null): { closed: number; total: number } | null {
  const effort = status?.effort?.name
  const count = status?.tickets ?? null
  if (effort === undefined || count === null || count.effort !== effort || count.total === 0) {
    return null
  }

  return { closed: count.done, total: count.total }
}

/**
 * The effort's tickets the Effort section lists: the open ones first, then
 * the closed ones, each in issue-number order. Empty outside an effort and
 * before a count for it.
 */
export function effortTickets(status: SessionStatus | null): TrackedTicket[] {
  const effort = status?.effort?.name
  const count = status?.tickets ?? null
  if (effort === undefined || count === null || count.effort !== effort) {
    return []
  }
  const byNumber = [...(count.list ?? [])].sort((a, b) => a.number - b.number)

  return [...byNumber.filter(ticket => !ticket.isClosed), ...byNumber.filter(ticket => ticket.isClosed)]
}

/** The status with a new ticket count. */
export function withTickets(status: SessionStatus, count: TicketCount): SessionStatus {
  return { ...status, tickets: count }
}
