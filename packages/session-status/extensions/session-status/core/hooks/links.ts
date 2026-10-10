// The pull requests and issues a session creates, found in what `gh pr
// create` and `gh issue create` print: the new page's URL. The status tool's
// `link` action adds a page the session did not create, by its URL. The
// Links section shows them all alike. The `gh` commands that merge, close or
// reopen a page, or turn on its auto-merge, add it too and change its state.

import type { LinkState, SessionLink, SessionStatus } from '../types'
import { autoSet, isDeleted } from './set-by'
import { simpleCommands } from './shell'

/** The `gh` commands that create a page, and the URL path each one prints. */
const CREATES = [
  { kind: 'pr', command: /^gh\s+pr\s+create\b/, path: 'pull' },
  { kind: 'issue', command: /^gh\s+issue\s+create\b/, path: 'issues' },
] as const

const PAGE_URL = /https:\/\/[^\s/]+\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)(?![\w/])/g

/** The `gh` commands that change a page's state, and the state each one leaves. */
const STATE_COMMANDS = [
  { kind: 'pr', command: /^gh\s+pr\s+merge\b/, state: 'merged' },
  { kind: 'pr', command: /^gh\s+pr\s+close\b/, state: 'closed' },
  { kind: 'pr', command: /^gh\s+pr\s+reopen\b/, state: 'open' },
  { kind: 'issue', command: /^gh\s+issue\s+close\b/, state: 'closed' },
  { kind: 'issue', command: /^gh\s+issue\s+reopen\b/, state: 'open' },
] as const

/** What `gh` prints after a merge, close or reopen: `<owner>/<repo>#<n>`. */
const PRINTED_PAGE = /\b([\w.-]+\/[\w.-]+)#(\d+)\b/

/** One page's URL and nothing else, for the `link` action. */
const ONE_PAGE_URL = /^https:\/\/[^\s/]+\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)\/?$/

/** A page as the pane names it: `<repo>#<number>`. */
export type FoundLink = Pick<SessionLink, 'kind' | 'repo' | 'number' | 'url'>

/**
 * The pages a shell command created: each URL of its kind in the output of a
 * command that runs `gh pr create` or `gh issue create` as one of its simple
 * commands. Nothing for any other command, or for the text of a heredoc or
 * an argument, so a URL a command only printed is never taken.
 */
export function findCreatedLinks(command: string, output: string): FoundLink[] {
  const parts = simpleCommands(command)
  const found: FoundLink[] = []
  for (const create of CREATES) {
    if (!parts.some(part => create.command.test(part))) {
      continue
    }
    for (const match of output.matchAll(PAGE_URL)) {
      const [url, owner, repo, path, number] = match as unknown as [string, string, string, string, string]
      if (path === create.path) {
        found.push({ kind: create.kind, repo: `${owner}/${repo}`, number: Number(number), url })
      }
    }
  }

  return found
}

/** The page a `link` call names: a pull request's or issue's URL; null for any other text. */
export function readPageUrl(url: string): FoundLink | null {
  const page = url.trim().replace(/\/$/, '')
  const match = ONE_PAGE_URL.exec(page)
  if (match === null) {
    return null
  }
  const [, owner, repo, path, number] = match as unknown as [string, string, string, string, string]

  return { kind: path === 'pull' ? 'pr' : 'issue', repo: `${owner}/${repo}`, number: Number(number), url: page }
}

/** The `<repo>#<number>` a link shows: the repository's name without its owner. */
export function linkLabel(link: Pick<SessionLink, 'repo' | 'number'>): string {
  return `${link.repo.split('/').pop() ?? link.repo}#${link.number}`
}

/**
 * A page a command merged, closed or reopened; `repo` null when the command
 * named only its number, `url` set when it named the page by URL. `state`
 * null for an auto-merge: it links the page and merges it later.
 */
export type StateChange = {
  kind: SessionLink['kind']
  repo: string | null
  number: number
  state: LinkState | null
  url?: string
}

/**
 * The state changes in a shell command: each `gh pr merge`, `close` or
 * `reopen` and `gh issue close` or `reopen` in it, with the page it names by
 * number, `#<n>` or URL (and `--repo`). A command that names no page acts on
 * the current branch's pull request: its page is read from what `gh` printed,
 * when the command holds one change alone. `gh pr merge --auto` merges later:
 * its change has no state.
 */
export function findStateChanges(command: string, output: string): StateChange[] {
  const parts = simpleCommands(command).flatMap(part => {
    const known = STATE_COMMANDS.find(entry => entry.command.test(part))
    return known === undefined ? [] : [{ part, known }]
  })
  const changes: StateChange[] = []
  for (const { part, known } of parts) {
    const page = namedPage(part) ?? (parts.length === 1 ? printedPage(output) : null)
    if (page !== null) {
      const isAuto = known.state === 'merged' && /\s--auto\b/.test(part)
      changes.push({ kind: known.kind, state: isAuto ? null : known.state, ...page })
    }
  }

  return changes
}

/** The page a `gh` command's arguments name, or null when they name none. */
function namedPage(part: string): { repo: string | null; number: number; url?: string } | null {
  const words = part.split(/\s+/).slice(3)
  const repoAt = words.findIndex(word => word === '--repo' || word === '-R')
  const repoFlag = words.find(word => word.startsWith('--repo='))?.slice('--repo='.length)
  const repo = repoAt >= 0 ? (words[repoAt + 1] ?? null) : (repoFlag ?? null)
  for (const word of words) {
    const url = readPageUrl(word)
    if (url !== null) {
      return { repo: url.repo, number: url.number, url: url.url }
    }
    const number = /^#?(\d+)$/.exec(word)?.[1]
    if (number !== undefined) {
      return { repo, number: Number(number) }
    }
  }

  return null
}

/** The page `gh` printed after a merge, close or reopen, or null. */
function printedPage(output: string): { repo: string; number: number } | null {
  const match = PRINTED_PAGE.exec(output)

  return match === null ? null : { repo: match[1] ?? '', number: Number(match[2]) }
}

/**
 * The pages the changes act on that are not linked yet, to add as links: a
 * change in no known repository (only a number, outside a GitHub repository)
 * gives none. A page named by URL keeps it; any other is a github.com page.
 */
export function changedPages(status: SessionStatus, changes: readonly StateChange[]): FoundLink[] {
  return changes.flatMap(change => {
    const repo = change.repo ?? status.place?.repo?.slug ?? null
    if (repo === null || status.links.some(link => isChangedPage(link, change, repo))) {
      return []
    }
    const url = change.url ?? `https://github.com/${repo}/${change.kind === 'pr' ? 'pull' : 'issues'}/${change.number}`

    return [{ kind: change.kind, repo, number: change.number, url }]
  })
}

function isChangedPage(link: SessionLink, change: StateChange, repo: string | null): boolean {
  return link.kind === change.kind && link.number === change.number && (repo === null || link.repo === repo)
}

/**
 * The status with each changed page's state set. A change matches a link of
 * its kind and number, in its repository, or, when it names none, in the
 * session's own repository. A page that is not linked stays out: add it with
 * `changedPages` first. A command is a new change, so it overwrites a state
 * the agent set with `update`.
 */
export function linkStatesChanged(status: SessionStatus, changes: readonly StateChange[]): SessionStatus {
  let isChanged = false
  let links = status.links
  for (const change of changes) {
    const repo = change.repo ?? status.place?.repo?.slug ?? null
    const state = change.state
    if (state === null) {
      continue
    }
    links = links.map(link => {
      if (!isChangedPage(link, change, repo)) {
        return link
      }
      const changed = autoSet({ ...link, state: link.state ?? 'open' }, 'state', state, 'event')
      if ((link.state ?? 'open') === changed.state && changed.fieldsSetBy === link.fieldsSetBy) {
        return link
      }
      isChanged = true

      return changed
    })
  }

  return isChanged ? { ...status, links } : status
}

/** What the model reads after `link`: whether the page joined the links. */
export function linkedText(link: FoundLink, isAdded: boolean): string {
  const name = `${link.kind === 'pr' ? 'Pull request' : 'Issue'} ${linkLabel(link)}`

  return isAdded ? `${name} is now listed under Links.` : `${name} is listed under Links already. Nothing changed.`
}

/** The status with the found links added, each page once; a page the agent deleted is not added again. */
export function linksFound(
  status: SessionStatus,
  found: readonly FoundLink[],
  stamp: { agentId?: string; at: number },
): SessionStatus {
  const added: SessionLink[] = []
  for (const link of found) {
    if ([...status.links, ...added].some(known => known.url === link.url) || isDeleted(status, 'link', link.url)) {
      continue
    }
    const created: SessionLink = { ...link, at: stamp.at }
    if (stamp.agentId !== undefined) {
      created.agentId = stamp.agentId
    }
    added.push(created)
  }

  return added.length === 0 ? status : { ...status, links: [...status.links, ...added] }
}
