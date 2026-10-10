// The status store for one Pi session: the status in memory, each change
// saved as a custom session entry, and the status restored from the branch.
// Pure apart from the `save` callback that index.ts passes in.

import type { SessionStatus } from './core/types'
import { applyChange, emptyStatus, savedStatus, withDefaults } from './core/hooks/status'

/** The custom entry type each saved status is appended under. */
export const ENTRY_TYPE = 'session-status'

/** A session entry as the restore reads it: Pi's `CustomEntry` and every other entry. */
export type EntryLike = { type: string; customType?: string; data?: unknown }

/**
 * The status the branch saved last for `sessionId`, or null. A fork copies
 * the entries into a new session id, so the saved status is not its own and
 * the fork starts empty, as a `/clear` or a fork does in Claude Code.
 */
export function restoreStatus(branch: readonly EntryLike[], sessionId: string): SessionStatus | null {
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i]
    if (entry?.type === 'custom' && entry.customType === ENTRY_TYPE) {
      return savedStatus(entry.data, sessionId)
    }
  }

  return null
}

/** One session's status, changed through `change` and saved through `save`. */
export class StatusStore {
  private status: SessionStatus | null
  private readonly listeners = new Set<(status: SessionStatus) => void>()

  constructor(
    readonly sessionId: string,
    restored: SessionStatus | null,
    private readonly save: (status: SessionStatus) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.status = withDefaults(restored)
  }

  /** The status now; an empty one before the first change. */
  get(): SessionStatus {
    return this.status ?? emptyStatus(this.sessionId)
  }

  /** Whether anything was recorded yet. */
  hasStatus(): boolean {
    return this.status !== null
  }

  /**
   * Applies one change, kept within its bounds and stamped (see
   * `applyChange`), and saves it unless `save` is false. Returns the new
   * status; a change that returns its input changes and saves nothing.
   */
  change(change: (status: SessionStatus) => SessionStatus, options: { save?: boolean } = {}): SessionStatus {
    const before = this.status
    let isSame = false
    const after = applyChange(
      before,
      status => {
        const next = change(status)
        isSame = next === status

        return next
      },
      { sessionId: this.sessionId, now: this.now() },
    )
    // A change that changed nothing appends no entry: background reads often find nothing new.
    if (isSame) {
      return before ?? after
    }
    this.status = after
    if (options.save !== false) {
      this.save(after)
    }
    for (const listener of this.listeners) {
      listener(after)
    }

    return after
  }

  /** Calls `listener` after each change; returns the function that stops it. */
  onChange(listener: (status: SessionStatus) => void): () => void {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }
}
