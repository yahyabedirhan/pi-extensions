// Where the session works, as data: its repository, branch and worktree,
// and the GitHub pages the pane links to. register.tsx reads git for it;
// nothing here calls `$`. Links are external `https://github.com` pages
// only, never `file://`.

import type { GitHubRepo, SessionPlace, SessionStatus } from '../types'

/**
 * The GitHub repository a remote URL names: `git@github.com:o/r.git`,
 * `ssh://git@github.com/o/r`, `https://github.com/o/r.git`; null for any
 * other host or shape.
 */
export function githubRepo(remote: string): GitHubRepo | null {
  const match = /^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
    remote.trim(),
  )
  if (match === null) {
    return null
  }
  const [, owner, name] = match as unknown as [string, string, string]

  return repoOf(`${owner}/${name}`)
}

/** The repository `<owner>/<name>` names, with its GitHub page. */
export function repoOf(slug: string): GitHubRepo {
  return { slug, url: `https://github.com/${slug}` }
}

/** Whether two `<owner>/<name>` slugs name one repository: GitHub ignores case. */
export function isSameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * The worktree as the pane names it: the two folders above the repository
 * folder, `claude-mods-8ec7ac/1` for `/x/.treehouse/claude-mods-8ec7ac/1/claude-mods`.
 * A worktree kept in a `worktrees` folder is named by its own folder instead,
 * `worktrees/agent-x` for `/x/claude-mods/.claude/worktrees/agent-x`.
 * The full path stays in the status and is never shown.
 */
export function worktreeLabel(root: string): string {
  const folders = root.split(/[\\/]/).filter(folder => folder !== '')

  if (folders.at(-2) === 'worktrees') {
    return folders.slice(-2).join('/')
  }

  return folders.slice(-3, -1).join('/')
}

/** The effort's issues on GitHub: the issues list filtered by its `effort:<name>` label. */
export function effortUrl(repo: GitHubRepo, effort: string): string {
  return `${repo.url}/issues?q=${encodeURIComponent(`label:effort:${effort}`)}`
}

/** An issue's page on GitHub. */
export function issueUrl(repo: GitHubRepo, number: number): string {
  return `${repo.url}/issues/${number}`
}

/** A Bash command that likely moved the branch: `git checkout` or `git switch`. */
const BRANCH_CHANGE = /\bgit\s+(?:checkout|switch)\b/

/** Whether a tool call likely changed the session's branch. */
export function changesBranch(call: { tool: string }): boolean {
  const command = (call as unknown as Record<string, unknown>).command

  return call.tool === 'Bash' && typeof command === 'string' && BRANCH_CHANGE.test(command)
}

/** The status with where the session works now. */
export function withPlace(status: SessionStatus, place: SessionPlace): SessionStatus {
  const known = status.place
  const isSame =
    known !== null &&
    known.root === place.root &&
    known.branch === place.branch &&
    known.repo?.slug === place.repo?.slug

  return isSame ? status : { ...status, place }
}
