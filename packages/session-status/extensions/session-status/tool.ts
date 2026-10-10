// The status tool for Pi: the same actions, ids and replies as the Claude
// Code mod's `mcp__session-status__status`, answered from the copied core.
// This is register.tsx's `tool.call` branch with `$` replaced by a store and
// a few effects that index.ts supplies.

import type { StatusItem } from './core/types'
import { createEntry, deleteEntry, linkPage, pings, readEntries, recordDraft, updateEntry } from './core/hooks/crud'
import type { CrudOutcome } from './core/hooks/crud'
import { linkedText } from './core/hooks/links'
import { blockedPing, blockerPing, endListPing, pingId, withdrawPing } from './core/hooks/pings'
import { listText, resetProgress, resetText } from './core/hooks/reset'
import type { ResetRemoved } from './core/hooks/reset'
import { reportItem } from './core/hooks/session-items'
import { sessionProgress } from './core/hooks/session-progress'
import {
  STATUS_TOOL,
  STATUS_TOOL_SPEC,
  closedText,
  endListText,
  itemText,
  readStatusToolInput,
  recordedText,
  ticketText,
} from './core/hooks/status-tool'
import { closeItem, isOpen, onEndList, openToDecide } from './core/hooks/status'
import { reportTicket } from './core/hooks/ticket-reports'
import type { StatusStore } from './state'

/** The tool's name in Pi: the short name, as Pi has no MCP prefix for an extension's tool. */
export const TOOL_NAME = STATUS_TOOL_SPEC.name

/**
 * The tool's description for Pi: the mod's, with Pi's words for its
 * harness. The kinds that need Claude Code (tasks, cron jobs, places) stay
 * accepted, so one set of agent instructions works in both harnesses.
 */
export const TOOL_DESCRIPTION = forPi(STATUS_TOOL_SPEC.description)

/** The mod's text with Pi's names: the tool's short name and Pi for Claude Code. */
export function forPi(text: string): string {
  return text.split(STATUS_TOOL).join(TOOL_NAME).split('restart Claude Code').join('restart Pi')
}

/** What a status call does beyond the status: index.ts runs these. */
export type StatusEffects = {
  /** Runs a `shipyard ping` argv and forgets it. */
  ping(argv: string[]): void
  /** A link joined or changed: read the links' states when due. */
  linked(): void
  /** A ticket was reported: name the effort after the branch when it has none, and count its tickets when due. */
  ticketReported(): void
}

/** What the model reads back: the text, and whether the call was refused. */
export type StatusReply = { text: string; isError: boolean }

const ok = (text: string): StatusReply => ({ text, isError: false })
const refused = (text: string): StatusReply => ({ text, isError: true })

/**
 * Answers one status call. A refused call changes nothing and says what is
 * wrong, for the model to fix and call again.
 */
export function runStatusCall(store: StatusStore, params: Record<string, unknown>, now: number, effects: StatusEffects): StatusReply {
  // Pi runs no subagents through this tool: an `agentId` would only switch on the subagent rules.
  const { agentId: _ignored, ...input } = params
  const request = readStatusToolInput(input)
  if ('error' in request) {
    return refused(request.error)
  }

  if ('close' in request) {
    const closed = closeStatusItem(store, request.close, now, effects)

    return 'error' in closed ? refused(closed.error) : ok(closedText(closed.item))
  }

  if ('postEndList' in request) {
    if (openToDecide(store.get()).length === 0) {
      return ok(endListText([]))
    }
    const posted = store.change(status => ({ ...status, endListPostedAt: now }))
    const listed = onEndList(posted)
    effects.ping(endListPing(posted.sessionId, listed.map(item => item.id)))

    return ok(endListText(listed))
  }

  if ('list' in request) {
    return ok(listText(store.get(), request.list))
  }

  if ('reset' in request) {
    return ok(reset(store))
  }

  if ('crud' in request) {
    const crud = request.crud
    if (crud.action === 'read') {
      return ok(readEntries(store.get(), crud.filter))
    }
    const context = { now }
    let outcome: CrudOutcome | { error: string } | undefined
    const after = store.change(status => {
      outcome =
        crud.action === 'create'
          ? createEntry(status, crud.kind, crud.fields, context)
          : crud.action === 'update'
            ? updateEntry(status, crud.kind, crud.id, crud.fields, context)
            : deleteEntry(status, crud.kind, crud.id, context)

      return 'error' in outcome ? status : outcome.status
    })
    const done = outcome as CrudOutcome | { error: string } | undefined
    if (done === undefined || 'error' in done) {
      return refused(done?.error ?? 'Nothing changed.')
    }
    if (done.pinged !== undefined) {
      pingChange(effects, after.sessionId, done.pinged.before, done.pinged.after)
    }
    if (crud.kind === 'link') {
      effects.linked()
    }

    return ok(done.text)
  }

  if ('link' in request) {
    const { link } = request
    let isAdded = false
    store.change(status => {
      const linked = linkPage(status, link, { at: now })
      isAdded = linked.isAdded

      return linked.status
    })
    effects.linked()

    return ok(linkedText(link, isAdded))
  }

  if ('ticket' in request) {
    const ticket = request.ticket
    let outcome: ReturnType<typeof reportTicket> | undefined
    const reported = store.change(status => {
      outcome = reportTicket(status, ticket, now)

      return 'error' in outcome ? status : outcome.status
    })
    const done = outcome as ReturnType<typeof reportTicket> | undefined
    if (done === undefined || 'error' in done) {
      return refused(done?.error ?? 'The ticket was not reported.')
    }
    effects.ticketReported()

    return ok(ticketText(ticket, done, sessionProgress(reported)))
  }

  if ('item' in request) {
    const item = request.item
    let outcome: ReturnType<typeof reportItem> | undefined
    const reported = store.change(status => {
      outcome = reportItem(status, item, now)

      return 'error' in outcome ? status : outcome.status
    })
    const done = outcome as ReturnType<typeof reportItem> | undefined
    if (done === undefined || 'error' in done) {
      return refused(done?.error ?? 'The item was not reported.')
    }

    return ok(itemText(done.item, done.change, sessionProgress(reported)))
  }

  const { draft } = request
  let recorded: StatusItem | undefined
  const after = store.change(status => {
    const next = recordDraft(status, draft, now)
    recorded = next.item

    return next.status
  })
  const item = recorded as StatusItem | undefined
  if (item !== undefined) {
    pingChange(effects, after.sessionId, null, item)
  }

  return ok(item === undefined ? 'Recorded.' : recordedText(item))
}

/**
 * Closes one open item at `now`, saved, and withdraws its ping when it
 * pinged: the tool's `resolve` and `dismiss` and the overlay's answers
 * share it. Says what is wrong when no open item of that kind has the id.
 */
export function closeStatusItem(
  store: StatusStore,
  target: { kind: StatusItem['kind']; id: string },
  now: number,
  effects: Pick<StatusEffects, 'ping'>,
  options: { acted?: boolean } = {},
): { item: StatusItem } | { error: string } {
  let outcome: ReturnType<typeof closeItem> = closeItem(store.get(), target, now, options)
  if ('error' in outcome) {
    return outcome
  }
  // Closed inside the change, as in the mod: of two quick answers only one closes it.
  const after = store.change(status => {
    outcome = closeItem(status, target, now, options)

    return 'error' in outcome ? status : outcome.status
  })
  const done = outcome as ReturnType<typeof closeItem>
  if ('error' in done) {
    return done
  }
  if (pings(done.item)) {
    withdrawItemPing(effects, after.sessionId, done.item)
  }

  return { item: done.item }
}

/** Resets the session status (see `resetProgress`), saved at once; returns the reply. */
export function reset(store: StatusStore): string {
  let removed: ResetRemoved | undefined
  store.change(status => {
    const outcome = resetProgress(status)
    removed = outcome.removed

    return outcome.status
  })

  return resetText(removed ?? { items: 0, entries: 0, links: 0, tickets: 0, effort: null })
}

/** Withdraws the ping sent for a decision or blocker. */
function withdrawItemPing(effects: Pick<StatusEffects, 'ping'>, sessionId: string, item: StatusItem): void {
  effects.ping(withdrawPing(('pingId' in item ? item.pingId : undefined) ?? pingId(sessionId, item.id)))
}

/**
 * Sends or withdraws the ping of a decision or blocker that a change made
 * ping or stop pinging: recorded or opened again blocked, or closed,
 * deleted or no longer blocked.
 */
function pingChange(effects: Pick<StatusEffects, 'ping'>, sessionId: string, before: StatusItem | null, after: StatusItem | null): void {
  const wasPinging = before !== null && isOpen(before) && pings(before)
  const isPinging = after !== null && isOpen(after) && pings(after)
  if (!wasPinging && isPinging) {
    effects.ping(after.kind === 'blocker' ? blockerPing(sessionId, after) : blockedPing(sessionId, after))
  } else if (wasPinging && !isPinging && before !== null) {
    withdrawItemPing(effects, sessionId, before)
  }
}
