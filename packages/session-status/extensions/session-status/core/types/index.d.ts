// The session-status mod's state contract. The status is plain JSON with
// the session id, so a later cross-session export can read it from
// `$.store` as written.

/** What the session does now: taken from the last tool call. */
export type DoingNow = {
  /** The tool's name as the call named it (`Bash`, `Edit`, `mcp__x__y`). */
  tool: string
  /** One short line about the call: its description, file or command. */
  text: string
  /** The subagent's id when a subagent made the call; absent on the main loop. */
  agentId?: string
  /** When the call started, in `$.clock.now()` milliseconds. */
  at: number
}

/**
 * How a decision weighs on the work: `blocked` stops the agent until the
 * person answers; `before_settling` goes on with its default, and the person
 * decides before the session settles; `after_settling` goes on with its
 * default and can wait until after the session settles, as a follow-up.
 */
export type DecisionUrgency = 'blocked' | 'before_settling' | 'after_settling'

/** A decision the agent recorded with the status tool. */
export type Decision = {
  kind: 'decision'
  /** Stable for the session: `D1`, `D2`, ... Pings and resolves name it. */
  id: string
  urgency: DecisionUrgency
  question: string
  /** Two to four answers the person can give. */
  options: string[]
  /** The recommended answer: what the agent does unless told otherwise. */
  default: string
  /** What the person has to do or say to unblock the work. */
  unblocks: string
  /** When the agent recorded it, in `$.clock.now()` milliseconds. */
  recordedAt: number
  /** The subagent's id when a subagent recorded it; absent on the main loop. */
  agentId?: string
  /** When the agent marked it resolved; absent while the decision is open. */
  resolvedAt?: number
  /**
   * When the user pressed Discuss in the pane; absent until then. The
   * decision stays open, marked, until the agent or an option resolves it.
   */
  discussingAt?: number
  /**
   * The shipyard id of the ping sent for it, set when it is recorded blocked.
   * A `/clear` carries the decision to a new session id; the ping keeps this one.
   */
  pingId?: string
}

/** Something unexpected the agent recorded with the status tool. */
export type Surprise = {
  kind: 'surprise'
  /** Stable for the session: `S1`, `S2`, ... */
  id: string
  /** What occurred. */
  occurred: string
  /** What it changed in the work or the plan. */
  changed: string
  /** When the agent recorded it, in `$.clock.now()` milliseconds. */
  recordedAt: number
  /** The subagent's id when a subagent recorded it; absent on the main loop. */
  agentId?: string
  /** `observer` when the observer agent found it; absent when the agent recorded it. */
  source?: 'observer'
  /** The one clear next step, in a few words, when there is one: the pane shows it as a button. */
  action?: string
  /** When the user dismissed it; absent while the surprise is open. */
  resolvedAt?: number
  /**
   * When the user pressed Discuss in the pane; absent until then. The
   * surprise stays open, marked, until the agent or another button closes it.
   */
  discussingAt?: number
  /**
   * When the user acted on it from the pane (`File issue` or its action),
   * which closed it too; absent otherwise. The observer's back-off does not
   * count such a finding as dismissed.
   */
  actedAt?: number
}

/**
 * Something the agent tried that failed and that it cannot finish alone:
 * a denied action, a check that cannot run, a tool that refuses to start.
 * The person can unblock it, so it pings them and stays until resolved.
 */
export type Blocker = {
  kind: 'blocker'
  /** Stable for the session: `B1`, `B2`, ... */
  id: string
  /** What the agent tried that failed. */
  failed: string
  /** What the person can do to unblock it. */
  needs: string
  /** When the agent recorded it, in `$.clock.now()` milliseconds. */
  recordedAt: number
  /** The subagent's id when a subagent recorded it; absent on the main loop. */
  agentId?: string
  /** When the agent marked it resolved; absent while it is open. */
  resolvedAt?: number
  /** The shipyard id of the ping sent for it; a `/clear` keeps it. */
  pingId?: string
}

/**
 * Who set a value last: an automatic source (`auto`), such as a GitHub
 * read or a task event, or the agent with the status tool's `create` or
 * `update` (`manual`).
 */
export type SetBy = 'auto' | 'manual'

/**
 * A field the agent set with `update`, over the value its automatic source
 * gave. An automatic read that reports `lastAuto` again changes nothing; a
 * new change from that source overwrites the field and drops this mark.
 */
export type ManualField = {
  setBy: 'manual'
  /** What the automatic source last reported for the field; null when it reported nothing. */
  lastAuto: string | null
}

/** The fields of an entry that the agent set by hand; a field left out was set by its automatic source. */
export type FieldsSetBy<Field extends string> = Partial<Record<Field, ManualField>>

/** One item the agent recorded: a decision, a surprise or a blocker. */
export type StatusItem = Decision | Surprise | Blocker
/** One task of the session's task list, from the task tools and Task events. */
export type Task = {
  /**
   * The task's id: the task tools' own id, or `todo:<loop>:<index>` for an
   * item of a TodoWrite list (`<loop>` is the subagent's id, or `main`).
   */
  id: string
  /** The task's title. */
  subject: string
  /** What the task does while it runs ("Running tests"), when given. */
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
  /** When the task last changed, in `$.clock.now()` milliseconds. */
  at: number
  /** `manual` when the agent created it with `create`; absent when the task tools did. */
  setBy?: SetBy
  /** The subagent's id when a subagent created it with `create`. */
  agentId?: string
  /** The fields the agent set with `update`. */
  fieldsSetBy?: FieldsSetBy<'subject' | 'status'>
}

/**
 * How far the task list is: tasks done, the total and the task that runs
 * now. The Session section shows it on a line of its own, apart from the
 * session's items.
 */
export type Progress = {
  done: number
  total: number
  /** The name of the task that runs now; null when none runs. */
  current: string | null
}

/** Where a linked page stands: a pull request merges, either kind closes. */
export type LinkState = 'open' | 'merged' | 'closed'

/** A pull request or an issue attached to the session: created by it or one of its subagents, or linked with `link`. */
export type SessionLink = {
  kind: 'pr' | 'issue'
  /**
   * Where the page stands, as this session's `gh pr merge`, `close` or
   * `reopen` or `gh issue close` or `reopen` left it, or as the GitHub read
   * last found it; absent: open.
   */
  state?: LinkState
  /** The repository as `<owner>/<repo>`. */
  repo: string
  number: number
  /** The page on GitHub, as `gh` printed it or `link` gave it. */
  url: string
  /** The subagent's id when a subagent created or linked it; absent on the main loop. */
  agentId?: string
  /** When it was found, in `$.clock.now()` milliseconds. */
  at: number
  /** `manual` when the agent created it with `create` or `link`; absent when a `gh` command added it. */
  setBy?: SetBy
  /** The fields the agent set with `update`. */
  fieldsSetBy?: FieldsSetBy<'state'>
}

/** The session's subagents, by id: those that run now and those that finished. */
export type Subagents = {
  running: string[]
  finished: string[]
}

/**
 * The observer agent's record for the session: how many checks it made, and
 * a key for every finding it showed, so it never shows one twice.
 */
export type ObserverRecord = {
  /** Checks made this session; the observer stops at its cap. */
  checks: number
  /** The normalized key of every finding shown, oldest first. */
  seen: string[]
}

/** The effort the session runs, found from its tool calls. */
export type Effort = {
  /** The effort's name, as its `effort:<name>` label writes it. */
  name: string
  /**
   * Where the name came from: a ticket report's `effort`, an `effort:<name>`
   * label, or the session's git branch when an effort skill ran before any
   * label showed. A report's name always wins; a label's wins over a branch's.
   */
  from?: 'report' | 'label' | 'branch'
  /** `manual` when the agent created it with `create`; absent when it was found. */
  setBy?: SetBy
  /** The fields the agent set with `update`. */
  fieldsSetBy?: FieldsSetBy<'name'>
}

/**
 * Where the status pane stands for the session: never opened yet, open
 * (by the person or by an auto-open trigger), or closed by the person.
 */
export type PaneState = 'unopened' | 'open' | 'closed'

/**
 * What the pane shows: every section (`main`), or one list in full after
 * the person pressed its "+N more".
 */
export type PaneView = 'main' | 'surprises' | 'observations' | 'decide' | 'follow-up' | 'items' | 'tickets' | 'tasks' | 'links' | 'crons' | 'building'

/** One of the effort's tickets, as `gh issue list` last read it. */
export type TrackedTicket = {
  number: number
  title: string
  isClosed: boolean
}

/** The effort's tickets, as `gh issue list` last counted them. */
export type TicketCount = {
  /** The effort counted: a count for another effort is not shown. */
  effort: string
  /** Tickets closed. */
  done: number
  /** All tickets, open and closed; the spec issue is not one. */
  total: number
  /**
   * The tickets the orchestrator builds: all of them without the `QA:`
   * tickets, which the person closes by hand. Absent on a count from before 0.4.0.
   */
  builds?: number
  /** Each ticket, in the order `gh` listed it. Absent on a count from before 0.5.0. */
  list?: TrackedTicket[]
  /** When it was counted, in `$.clock.now()` milliseconds. */
  at: number
}

/**
 * A ticket the orchestrator reported with the status tool: `started` while a
 * delegate builds it, `landed` once its commit is on the effort branch,
 * whether or not its issue is closed.
 */
export type TicketReport = {
  /** The ticket's issue number; absent for a ticket that has none (a local tracker). */
  number?: number
  /** The ticket's title. */
  title: string
  state: 'started' | 'landed'
  /** The fields the agent set with `update`; the next report overwrites them. */
  fieldsSetBy?: FieldsSetBy<'title' | 'state'>
  /** When it reached this state, in `$.clock.now()` milliseconds. */
  at: number
  /**
   * The effort the ticket belongs to; absent on a report made before any
   * effort was named, which belongs to the effort that runs now.
   */
  effort?: string
  /**
   * When a started ticket first landed: it is rework, and a `stopped` takes
   * it back to landed at this time. Absent on a ticket that never landed.
   */
  landedAt?: number
}

/**
 * One piece of work the session is expected to do, reported by the main
 * session with the status tool: a request or sub-request from the person,
 * follow-up work the agent took on, or a step left before the session
 * settles. `dropped` takes it out of the total.
 */
export type SessionItem = {
  /** Stable for the session: `I1`, `I2`, ... */
  id: string
  title: string
  state: 'added' | 'done' | 'dropped'
  /** When it was added, in `$.clock.now()` milliseconds. */
  addedAt: number
  /** When it reached its state, in `$.clock.now()` milliseconds. */
  at: number
}

/** A repository on GitHub. */
export type GitHubRepo = {
  /** `<owner>/<name>`. */
  slug: string
  /** Its page: `https://github.com/<owner>/<name>`. */
  url: string
}

/** Where the session works: its repository, read from git in its directory. */
export type SessionPlace = {
  /** The repository's top folder, absolute: kept for the record, never shown. */
  root: string
  /** The branch checked out; null on a detached head. */
  branch: string | null
  /** The repository on GitHub, from its `origin` remote; null when it has none there. */
  repo: GitHubRepo | null
}

/**
 * A repository the session changed: its pull requests and issues are the
 * links of its GitHub repository; this counts the rest.
 */
export type Place = {
  /** The repository's top folder, absolute; `github:<owner>/<name>` for one only `gh` named. */
  key: string
  /** The repository folder's name, or the GitHub name for one only `gh` named. */
  name: string
  /** The repository on GitHub, when known. */
  repo: GitHubRepo | null
  /** The files edited or written there, absolute, each once, the last touched last. */
  files: string[]
  /** How many commands that change something ran there. */
  commands: number
  /** When it last changed, in `$.clock.now()` milliseconds. */
  at: number
}

/** One session's status, as held in `$.state` and saved to `$.store`. */
/**
 * What the session does: a turn runs (`working`), a turn that ran a settle
 * skill runs (`settling`), the last turn ended (`waiting`), or it ended after
 * a settle skill (`settled`).
 */
export type Activity = 'working' | 'settling' | 'waiting' | 'settled'

/**
 * A cron job the session scheduled with CronCreate: active until it fires
 * once (a one-shot job), expires 7 days after it was scheduled (a recurring
 * job) or is cancelled with CronDelete.
 */
export type CronJob = {
  /** CronCreate's id for it. */
  id: string
  /** When it runs, as short text: `every 5m`, `weekdays 09:00`, `Dec 25 03:07`, else the cron expression. */
  schedule: string
  /** The prompt it enqueues when it fires. */
  prompt: string
  recurring: boolean
  state: 'active' | 'fired' | 'expired' | 'cancelled'
  /** How many times it fired in this session. */
  fires: number
  /** When CronCreate scheduled it, in `$.clock.now()` milliseconds; a job held from before 0.3.1 lacks it. */
  createdAt?: number
  /** When it last changed, in `$.clock.now()` milliseconds. */
  at: number
  /** The fields the agent set with `update`. */
  fieldsSetBy?: FieldsSetBy<'state'>
}

/**
 * An entry the agent removed with `delete`, by its kind and its key: an
 * automatic source does not add it again, and an id is not given again.
 */
export type DeletedEntry = {
  kind: 'item' | 'decision' | 'surprise' | 'blocker' | 'ticket' | 'link' | 'effort' | 'task' | 'cron' | 'place'
  /**
   * What the entry is known by: an item's, decision's, surprise's or
   * blocker's id; a ticket's `#3` or title; a link's URL; the effort's name;
   * a task's or cron job's id; a place's `owner/repo`, or its key without one.
   */
  key: string
  /** When it was deleted, in `$.clock.now()` milliseconds. */
  at: number
}

export type SessionStatus = {
  /** The shape's version, raised when a saved status no longer reads as this one. */
  version: 1
  /** The session this status belongs to: also its key in `$.store`. */
  sessionId: string
  doingNow: DoingNow | null
  /** Decisions and surprises in the order they were recorded, oldest first. */
  items: StatusItem[]
  /** The task list, in the order the tasks were created. */
  tasks: Task[]
  /** How far the task list is; null before the first task. See `sessionProgress`. */
  progress: Progress | null
  /** The pull requests and issues created, oldest first. */
  links: SessionLink[]
  subagents: Subagents
  /**
   * When the agent last posted the decide list (the open decisions before settling, asked in the chat) of open before-settling
   * decisions; null before it posts one.
   */
  endListPostedAt: number | null
  /** The observer agent's checks and the findings it showed. */
  observer: ObserverRecord
  /** The effort the session runs; null when it runs none. */
  effort: Effort | null
  /** The effort's tickets last counted; null before the first count. The Effort section shows it. */
  tickets: TicketCount | null
  /**
   * The tickets the orchestrator reported, in the order it first named them.
   * The Session section counts the current effort's landed tickets, of all
   * its tickets the tracker counted or the orchestrator reported.
   */
  ticketReports: TicketReport[]
  /**
   * The session's items, in the order they were added. The Session section
   * counts them with the current effort's tickets: done of all not dropped.
   */
  sessionItems: SessionItem[]
  /** Where the session works; null before git answers, and outside a repository. */
  place: SessionPlace | null
  /** The repositories the session changed, the first changed first; the Places section shows the others. */
  places: Place[]
  /** The cron jobs the session scheduled, oldest first. */
  crons: CronJob[]
  /** What the session does: null before its first turn. */
  activity: Activity | null
  /** The entries the agent deleted, oldest first. */
  deleted: DeletedEntry[]
  /** When the status last changed, in `$.clock.now()` milliseconds. */
  updatedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-status': {
      /** The session's status; null until the first change. */
      status: SessionStatus | null
      /** The age timer's last reading: the pane reads it only to draw again. */
      tick: number
      /** Main-loop turns that ended with the pane open since the observer's last check. */
      observerTurns: number
      /** Where the pane stands: auto-open opens only an `unopened` pane. */
      pane: PaneState
      /** What the pane shows: every section, or one list in full. */
      view: PaneView
    }
  }
}
