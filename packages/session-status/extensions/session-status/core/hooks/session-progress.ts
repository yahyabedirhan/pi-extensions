// Session progress as data: the items this session is responsible for, done
// of all. The total grows as items are added. Three bars never mix (see
// docs/low-level-design.md): Session counts items, Effort the issues GitHub
// closed (effort-progress.ts), Task the task list (tasks.ts).

import type { Progress, SessionItem, SessionStatus, TicketReport } from '../types'
import { countedItems, openItems } from './session-items'
import { reportsIn } from './ticket-reports'

/** The progress the Session section shows. */
export type SessionProgress = {
  /** Items done. */
  done: number
  /** Items not dropped. */
  total: number
  /** The items still to do, oldest first. */
  open: SessionItem[]
  /** The tickets the orchestrator builds now, oldest first. */
  building: TicketReport[]
}

/**
 * A ticket whose title starts with `QA:` is checked by the person, who
 * closes it by hand: the orchestrator never lands it, so the session does
 * not count it.
 */
const QA_TITLE = /^\s*qa:/i

/** Whether a ticket title names a QA ticket. */
export function isQaTitle(title: string): boolean {
  return QA_TITLE.test(title)
}

/**
 * The session's progress: its items, done of all not dropped, and the tickets
 * the orchestrator builds now (the "Building" line); null when the session
 * has neither. Effort tickets never count here: the Effort section shows
 * which issues GitHub closed, and a session that builds a ticket adds an
 * item for it.
 */
export function sessionProgress(status: SessionStatus | null): SessionProgress | null {
  if (status === null) {
    return null
  }
  const items = countedItems(status)
  const building = reportsIn(status, 'started').filter(report => !isQaTitle(report.title))
  if (items.length === 0 && building.length === 0) {
    return null
  }

  return {
    done: items.filter(item => item.state === 'done').length,
    total: items.length,
    open: openItems(status),
    building,
  }
}

/** The task list's progress, which the Task section shows; null before the first task. */
export function taskProgress(status: SessionStatus | null): Progress | null {
  return status?.progress ?? null
}
