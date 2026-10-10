// Each link's state as GitHub has it, read with one `gh api graphql` call for
// every link at once, so a pull request merged or an issue closed anywhere,
// by anyone, shows in the Links section. register.tsx runs the read; nothing
// here calls `$`.

import type { LinkState, SessionLink, SessionStatus } from '../types'
import { autoSet } from './set-by'

/** How often the links' states are read again while the session works. */
export const LINK_STATE_REFRESH_MS = 2 * 60_000

/** How long one read may take. */
export const LINK_STATE_TIMEOUT_MS = 15_000

/** A command that may change a page's state: a read follows it at once. */
const GH_PAGE_COMMAND = /(?:^|[\s;&|(])gh\s+(?:pr|issue)\s/

/** The `gh` call that reads every link's state; null when there is no link. */
export function linkStatesArgv(links: readonly SessionLink[]): string[] | null {
  const repos = [...new Set(links.map(link => link.repo))]
  if (repos.length === 0) {
    return null
  }
  const fields = repos.map((repo, index) => {
    const [owner = '', name = ''] = repo.split('/')
    const pages = [...new Set(links.filter(link => link.repo === repo).map(link => link.number))]
      .map(number => `n${number}: issueOrPullRequest(number: ${number}) { ... on PullRequest { state } ... on Issue { state } }`)
      .join(' ')

    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${pages} }`
  })

  return ['gh', 'api', 'graphql', '-f', `query=query { ${fields.join(' ')} }`]
}

/**
 * The states a read found, by page URL. A repository or page GitHub did not
 * answer for (gone, private, a typo) is left out, so its link keeps the state
 * it had; output that is no answer at all finds none.
 */
export function parseLinkStates(stdout: string, links: readonly SessionLink[]): Map<string, LinkState> {
  const states = new Map<string, LinkState>()
  let data: Record<string, Record<string, { state?: unknown } | null> | null>
  try {
    data = (JSON.parse(stdout) as { data?: typeof data }).data ?? {}
  } catch {
    return states
  }
  const repos = [...new Set(links.map(link => link.repo))]
  for (const link of links) {
    const state = data?.[`r${repos.indexOf(link.repo)}`]?.[`n${link.number}`]?.state
    const read = state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : state === 'OPEN' ? 'open' : null
    if (read !== null) {
      states.set(link.url, read)
    }
  }

  return states
}

/**
 * The status with each link's state set to what GitHub said; the same
 * status when nothing changed. A state the agent set with `update` stays
 * until GitHub reports another state than it did before.
 */
export function withLinkStates(status: SessionStatus, states: ReadonlyMap<string, LinkState>): SessionStatus {
  let isChanged = false
  const links = status.links.map(link => {
    const state = states.get(link.url)
    if (state === undefined) {
      return link
    }
    const read = autoSet({ ...link, state: link.state ?? 'open' }, 'state', state, 'read')
    if (read.state === (link.state ?? 'open') && read.fieldsSetBy === link.fieldsSetBy) {
      return link
    }
    isChanged = true

    return read
  })

  return isChanged ? { ...status, links } : status
}

/**
 * Whether a read of the links' states is due after a tool call: never
 * without a link; at once after a link joins or a `gh pr` or `gh issue`
 * command; else once LINK_STATE_REFRESH_MS passed since the last read.
 */
export function isLinkStateReadDue(
  status: SessionStatus | null,
  lastRead: { links: number; at: number } | null,
  call: { tool: string; command?: unknown },
  now: number,
): boolean {
  const links = status?.links.length ?? 0
  if (links === 0) {
    return false
  }
  const isGhPageCommand = call.tool === 'Bash' && typeof call.command === 'string' && GH_PAGE_COMMAND.test(call.command)

  return lastRead === null || lastRead.links !== links || isGhPageCommand || now - lastRead.at >= LINK_STATE_REFRESH_MS
}
