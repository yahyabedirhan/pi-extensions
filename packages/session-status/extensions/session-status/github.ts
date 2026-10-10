// The reads that run beside the session: each link's state and the
// effort's ticket count from GitHub, and the effort's name from the git
// branch. Each runs in the background, one at a time, and a failed read
// keeps the last good value. The same rules as register.tsx, with `$`
// replaced by an `exec` function.

import { branchEffortName, withEffort } from './core/hooks/effort'
import { TICKET_TIMEOUT_MS, isTicketReadDue, parseTicketList, ticketListArgv, withTickets } from './core/hooks/effort-progress'
import { LINK_STATE_TIMEOUT_MS, isLinkStateReadDue, linkStatesArgv, parseLinkStates, withLinkStates } from './core/hooks/link-states'
import type { StatusStore } from './state'

/** Runs a program and resolves to its output; Pi's `pi.exec` in the extension. */
export type Exec = (argv: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>

/** A tool call as the read rules see it: the mod's `Bash` name and the command. */
export type CallSeen = { tool: string; command?: string }

export class GitHubReads {
  private lastLinkRead: { links: number; at: number } | null = null
  private isReadingLinks = false
  private lastTicketRead: { effort: string; at: number } | null = null
  private isCountingTickets = false
  private waitingTicketRead: string | null = null

  constructor(
    private readonly store: () => StatusStore | null,
    private readonly exec: Exec,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts the reads a finished tool call made due. */
  afterCall(call: CallSeen): void {
    this.countTicketsIfDue(call)
    this.readLinkStatesIfDue(call)
  }

  /**
   * Records an effort run a tool call shows. A run that names no label
   * takes the branch's name while the effort has none.
   */
  effortSeen(name: string | null): void {
    const store = this.store()
    if (store === null) {
      return
    }
    if (name !== null) {
      store.change(status => withEffort(status, { name, from: 'label' }))
    } else if (store.get().effort === null) {
      void this.background(async () => {
        const { code, stdout } = await this.exec(['git', 'branch', '--show-current'], 5_000)
        const branch = code === 0 ? branchEffortName(stdout) : null
        if (branch !== null) {
          this.store()?.change(status => withEffort(status, { name: branch, from: 'branch' }))
        }
      })
    }
  }

  readLinkStatesIfDue(call: CallSeen): void {
    const store = this.store()
    const now = this.now()
    if (store === null || this.isReadingLinks) {
      return
    }
    const status = store.get()
    if (!isLinkStateReadDue(status, this.lastLinkRead, call, now)) {
      return
    }
    const argv = linkStatesArgv(status.links)
    if (argv === null) {
      return
    }
    this.lastLinkRead = { links: status.links.length, at: now }
    this.isReadingLinks = true
    void this.background(async () => {
      try {
        // A repository GitHub cannot find fails the call but still answers for the others.
        const { stdout } = await this.exec(argv, LINK_STATE_TIMEOUT_MS)
        const states = parseLinkStates(stdout, status.links)
        if (states.size > 0) {
          this.store()?.change(current => withLinkStates(current, states))
        }
      } finally {
        this.isReadingLinks = false
      }
    })
  }

  countTicketsIfDue(call: CallSeen): void {
    const store = this.store()
    const now = this.now()
    const status = store?.get() ?? null
    const effort = status?.effort?.name
    if (effort === undefined || !isTicketReadDue(status, this.lastTicketRead, call, now)) {
      return
    }
    this.lastTicketRead = { effort, at: now }
    if (this.isCountingTickets) {
      this.waitingTicketRead = effort

      return
    }
    this.isCountingTickets = true
    void this.background(async () => {
      try {
        await this.countTickets(effort)
        const waiting = this.waitingTicketRead
        if (waiting !== null) {
          this.waitingTicketRead = null
          await this.countTickets(waiting)
        }
      } finally {
        this.isCountingTickets = false
      }
    })
  }

  private async countTickets(effort: string): Promise<void> {
    const { code, stdout } = await this.exec(ticketListArgv(effort), TICKET_TIMEOUT_MS)
    const count = code === 0 ? parseTicketList(stdout) : null
    if (count !== null) {
      const at = this.now()
      this.store()?.change(status => withTickets(status, { effort, ...count, at }))
    }
  }

  /** Runs `work` without holding the caller; every failure (no `gh`, no network) is swallowed. */
  private async background(work: () => Promise<void>): Promise<void> {
    await Promise.resolve()
    try {
      await work()
    } catch {
      // The last good value holds until the next read.
    }
  }
}
