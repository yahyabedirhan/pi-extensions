// Who set a value: an automatic source or the agent. The status tool's
// `update` marks the fields it sets as `manual`, and `delete` remembers the
// entries it removes. The automatic sources (links.ts, link-states.ts,
// effort.ts, tasks.ts, crons.ts, places.ts) ask these rules before they
// change a marked field or add an entry again. Nothing here calls `$`.

import type { DeletedEntry, FieldsSetBy, SessionStatus } from '../types'

/**
 * How an automatic source saw a value: an `event` is a new change each time
 * (a `gh pr close`, a TaskUpdate); a `read` states the value again and again
 * (the GitHub read, a TodoWrite list, a label in a command).
 */
export type AutoSource = 'event' | 'read'

/** An entry whose fields the agent can set over an automatic source. */
type Marked<Field extends string> = { fieldsSetBy?: FieldsSetBy<Field> }

/** Whether the agent deleted the entry of `kind` known by `key` (case and a ticket's `#` ignored). */
export function isDeleted(status: SessionStatus, kind: DeletedEntry['kind'], key: string): boolean {
  const wanted = sameKey(key)

  return status.deleted.some(entry => entry.kind === kind && sameKey(entry.key) === wanted)
}

/** The status with one more deleted entry; `withinBounds` keeps the newest CAP. */
export function withDeleted(status: SessionStatus, kind: DeletedEntry['kind'], key: string, at: number): SessionStatus {
  if (isDeleted(status, kind, key)) {
    return status
  }

  return { ...status, deleted: [...status.deleted, { kind, key, at }] }
}

/** The status with an entry no longer deleted: the agent created it again. */
export function withoutDeleted(status: SessionStatus, kind: DeletedEntry['kind'], key: string): SessionStatus {
  if (!isDeleted(status, kind, key)) {
    return status
  }
  const wanted = sameKey(key)

  return { ...status, deleted: status.deleted.filter(entry => entry.kind !== kind || sameKey(entry.key) !== wanted) }
}

/** The highest number among the deleted ids of `kind` with `prefix` (`I`, `D`, ...): ids never repeat. */
export function highestDeletedId(status: SessionStatus, kind: DeletedEntry['kind'], prefix: string): number {
  return status.deleted
    .filter(entry => entry.kind === kind)
    .map(entry => Number(entry.key.slice(prefix.length)))
    .reduce((max, n) => (Number.isInteger(n) && n > max ? n : max), 0)
}

/**
 * The entry with a value its automatic source reported for `field`. A field
 * the agent did not set takes the value at all times. A field the agent set
 * takes it only on a new change: an event, or a read that reports another
 * value than the source last did. The mark drops when the value is taken.
 */
export function autoSet<Field extends string, E extends Marked<Field> & Record<Field, unknown>>(
  entry: E,
  field: Field,
  reported: E[Field],
  source: AutoSource,
): E {
  const mark = entry.fieldsSetBy?.[field]
  if (mark !== undefined) {
    if (source === 'read' && mark.lastAuto === stored(reported)) {
      return entry
    }

    return { ...withoutMark(entry, field), [field]: reported }
  }

  return entry[field] === reported ? entry : { ...entry, [field]: reported }
}

/**
 * The entry with a value the agent set for `field`, marked `manual`. The
 * mark keeps what the automatic source last reported: the value the field
 * had, or the one an earlier mark kept.
 */
export function manualSet<Field extends string, E extends Marked<Field> & Record<Field, unknown>>(
  entry: E,
  field: Field,
  value: E[Field],
): E {
  const lastAuto = entry.fieldsSetBy?.[field]?.lastAuto ?? stored(entry[field])

  return { ...entry, [field]: value, fieldsSetBy: { ...entry.fieldsSetBy, [field]: { setBy: 'manual', lastAuto } } }
}

function withoutMark<Field extends string, E extends Marked<Field>>(entry: E, field: Field): E {
  const { [field]: _dropped, ...rest } = entry.fieldsSetBy ?? {}
  const { fieldsSetBy: _old, ...plain } = entry

  return (Object.keys(rest).length === 0 ? plain : { ...plain, fieldsSetBy: rest }) as E
}

/** A field's value as a mark keeps it. */
function stored(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value)
}

/** A key or an id as the status tool compares it: ticket `#3` is `3`, and `d1` is `D1`. */
export function sameKey(key: string): string {
  return key.trim().replace(/^#(?=\d+$)/, '').toLowerCase()
}
