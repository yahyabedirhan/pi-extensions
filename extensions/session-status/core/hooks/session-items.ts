// Session items as data: the work the session is expected to do, as the main
// session reports it with the status tool's `item` action. The person's
// requests, the follow-up work the agent takes on and the steps left before
// the session settles are all items, so the total grows as the session goes
// on. register.tsx answers the `item` action with these rules;
// session-progress.ts counts the items.

import type { SessionItem, SessionStatus } from '../types'
import { highestDeletedId } from './set-by'

/** What an `item` call says about one item. */
export type ItemState = SessionItem['state']

/** One `item` call, read from its input. */
export type ItemRequest =
  /** Adds a new item: it needs a title, and takes the next id. */
  | { state: 'added'; title: string }
  /** Marks an item done or dropped, by its id. */
  | { state: 'done' | 'dropped'; id: string }

/** What one `item` call did: nothing (`same`) or moved the item to its state (`moved`). */
export type ItemChange = 'same' | 'moved'

/** The items that count: all but the dropped ones. */
export function countedItems(status: SessionStatus): SessionItem[] {
  return status.sessionItems.filter(item => item.state !== 'dropped')
}

/**
 * The items the pane lists: the open ones first, oldest first, as the work
 * to do next; then the done ones, newest first. Dropped items are left out,
 * as the count leaves them out.
 */
export function listedItems(status: SessionStatus): SessionItem[] {
  const done = status.sessionItems.filter(item => item.state === 'done').reverse()

  return [...openItems(status), ...done]
}

/** The items still to do, oldest first. */
export function openItems(status: SessionStatus): SessionItem[] {
  return status.sessionItems.filter(item => item.state === 'added')
}

/**
 * The status after one `item` call, the item after it and what the call
 * did. `added` adds a new item with the next id (`I1`, `I2`, ...; a deleted id is not given again). `done`
 * finishes an open item; `dropped` takes an open or done item out of the
 * total, for work no longer needed or replaced by a later item. A done item
 * never goes back to added, and a dropped item stays dropped: rework is a new
 * item. Says what is wrong otherwise, for the model to fix and call again.
 */
export function reportItem(
  status: SessionStatus,
  request: ItemRequest,
  now: number,
): { status: SessionStatus; item: SessionItem; change: ItemChange } | { error: string } {
  const items = status.sessionItems
  if (request.state === 'added') {
    const highest = items
      .map(item => Number(item.id.slice(1)))
      .reduce((max, n) => (Number.isInteger(n) && n > max ? n : max), highestDeletedId(status, 'item', 'I'))
    const item: SessionItem = { id: `I${highest + 1}`, title: request.title, state: 'added', addedAt: now, at: now }

    return { status: { ...status, sessionItems: [...items, item] }, item, change: 'moved' }
  }

  const known = items.find(item => item.id === request.id.toUpperCase())
  if (known === undefined) {
    return { error: `No item ${request.id}. Use an id from an \`added\` reply (I1, I2, ...).` }
  }
  if (known.state === request.state) {
    return { status, item: known, change: 'same' }
  }
  if (known.state === 'dropped') {
    return { error: `Item ${known.id} is dropped. Add a new item for the work.` }
  }

  return { ...movedItem(status, known, { state: request.state }, now), change: 'moved' }
}

/**
 * The status with one item changed: its title, or its state at `now`. The
 * status tool's `update` moves an item to any state, a done or dropped one
 * back to `added` too; `item` checks its rules first.
 */
export function movedItem(
  status: SessionStatus,
  known: SessionItem,
  change: { title?: string; state?: ItemState },
  now: number,
): { status: SessionStatus; item: SessionItem } {
  const item: SessionItem = {
    ...known,
    ...(change.title === undefined ? {} : { title: change.title }),
    ...(change.state === undefined || change.state === known.state ? {} : { state: change.state, at: now }),
  }

  return { status: { ...status, sessionItems: status.sessionItems.map(candidate => (candidate === known ? item : candidate)) }, item }
}
