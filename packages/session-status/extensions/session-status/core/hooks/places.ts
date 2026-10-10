// The blast radius as data: the other repositories the session changed, and
// how. A repository counts the pull requests and issues created there, the
// files edited or written there, and the commands that changed something
// there. Reads never count. register.tsx asks git which repository holds a
// folder; nothing here calls `$`.

import type { GitHubRepo, Place, SessionStatus } from '../types'
import { isSameRepo } from './place'
import { isDeleted } from './set-by'

/**
 * The commands that change something, in one place: the git and gh
 * subcommands that commit, publish or edit, and the shell's file moves.
 * `gh pr create` and `gh issue create` are left out: what they make shows in
 * the Links section.
 */
export const CHANGING_COMMANDS = {
  git: ['commit', 'push', 'merge', 'rebase', 'tag'],
  gh: ['pr edit', 'pr merge', 'pr close', 'issue edit', 'issue close', 'issue comment'],
  files: ['mv', 'rm', 'cp'],
} as const

/** The tools that edit or write a file, and the field that names it. */
const FILE_TOOLS: Record<string, readonly string[]> = {
  Edit: ['file_path'],
  Write: ['file_path'],
  NotebookEdit: ['notebook_path', 'file_path'],
}

/** Where a change happened: a folder on this host, or a GitHub repository `gh` named. */
export type Target = { dir: string } | { slug: string }

/** The file a tool call edits or writes, absolute; null for any other call. */
export function editedFile(call: { tool: string }): string | null {
  const input = call as unknown as Record<string, unknown>
  for (const field of FILE_TOOLS[call.tool] ?? []) {
    const value = input[field]
    if (typeof value === 'string' && value.startsWith('/')) {
      return value
    }
  }

  return null
}

/** The folder that holds a file. */
export function folderOf(file: string): string {
  return file.slice(0, Math.max(file.lastIndexOf('/'), 1))
}

/**
 * Where each step of a shell command that changes something ran, best
 * effort: in `cwd`, or where a `cd <dir> &&` before it moved, `git -C <dir>`
 * points, `gh --repo <owner>/<name>` names, or the first path of a file
 * move lies. A step that changes nothing gives nothing.
 */
export function commandTargets(command: string, cwd: string): Target[] {
  const targets: Target[] = []
  let dir = cwd
  for (const step of command.split(/&&|\|\||[;|\n]/)) {
    const words = shellWords(step)
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) {
      words.shift()
    }
    const program = (words[0] ?? '').split('/').pop() ?? ''
    if (program === 'cd') {
      const to = words[1]
      dir = to === undefined || to.startsWith('~') ? dir : resolvePath(dir, to)
    } else if (program === 'git') {
      const target = gitTarget(words, dir)
      if (target !== null) {
        targets.push(target)
      }
    } else if (program === 'gh') {
      const target = ghTarget(words, dir)
      if (target !== null) {
        targets.push(target)
      }
    } else if ((CHANGING_COMMANDS.files as readonly string[]).includes(program)) {
      const path = words.slice(1).find(word => !word.startsWith('-'))
      if (path !== undefined && !path.startsWith('~')) {
        targets.push({ dir: folderOf(resolvePath(dir, path)) })
      }
    }
  }

  return targets
}

/** A git step's folder when its subcommand changes something; null otherwise. */
function gitTarget(words: readonly string[], cwd: string): Target | null {
  let dir = cwd
  let i = 1
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    const option = words[i]
    if (option === '-C' && words[i + 1] !== undefined) {
      dir = resolvePath(dir, words[i + 1] ?? '')
    }
    i += option === '-C' || option === '-c' ? 2 : 1
  }
  const subcommand = words[i] ?? ''

  return (CHANGING_COMMANDS.git as readonly string[]).includes(subcommand) ? { dir } : null
}

/** A gh step's repository (`--repo`, `-R`) or folder when it changes something; null otherwise. */
function ghTarget(words: readonly string[], dir: string): Target | null {
  const plain = words.filter((word, i) => !word.startsWith('-') && !['--repo', '-R'].includes(words[i - 1] ?? ''))
  const action = plain.slice(1, 3).join(' ')
  if (!(CHANGING_COMMANDS.gh as readonly string[]).includes(action)) {
    return null
  }
  const at = words.findIndex(word => word === '--repo' || word === '-R')
  const named = at >= 0 ? words[at + 1] : words.find(word => word.startsWith('--repo='))?.slice('--repo='.length)
  const slug = named?.replace(/^(?:https:\/\/)?github\.com\//, '').replace(/\.git$/, '')

  return slug !== undefined && /^[\w.-]+\/[\w.-]+$/.test(slug) ? { slug } : { dir }
}

/** A step's words, each surrounding quote dropped: enough to find programs and paths. */
function shellWords(step: string): string[] {
  return (step.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(word => word.replace(/^(["'])(.*)\1$/, '$2'))
}

/** `path` read from `base`: absolute as given, else joined, with `.` and `..` worked out. */
export function resolvePath(base: string, path: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${base}/${path}`).split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '' && part !== '.') {
      parts.push(part)
    }
  }

  return `/${parts.join('/')}`
}

/** A repository a change happened in: its top folder, or its GitHub name alone. */
export type ChangedRepo = { root: string; repo: GitHubRepo | null } | { root: null; repo: GitHubRepo }

/**
 * The status with one change counted in its repository: a file edited or
 * written (each file once), or a command run. A repository known by its
 * GitHub name alone joins a place of the same repository found before. A
 * repository the agent deleted is not counted again.
 */
export function withChange(
  status: SessionStatus,
  where: ChangedRepo,
  change: { file: string } | { command: true },
  at: number,
): SessionStatus {
  if ([where.repo?.slug, where.root].some(key => key != null && isDeleted(status, 'place', key))) {
    return status
  }
  const index = status.places.findIndex(place =>
    where.root === null
      ? place.repo !== null && isSameRepo(place.repo.slug, where.repo.slug)
      : place.key === where.root,
  )
  const known = status.places[index]
  const base: Place = known ?? {
    key: where.root ?? `github:${where.repo.slug}`,
    name: where.root === null ? repoName(where.repo.slug) : (where.root.split('/').pop() ?? where.root),
    repo: where.repo,
    files: [],
    commands: 0,
    at,
  }
  const place: Place =
    'file' in change
      ? { ...base, files: [...base.files.filter(file => file !== change.file), change.file], at }
      : { ...base, commands: base.commands + 1, at }

  return {
    ...status,
    places: known === undefined ? [...status.places, place] : status.places.map((p, i) => (i === index ? place : p)),
  }
}

/** A place's id, as the status tool names it: its `owner/repo`, or its key when it has no GitHub repository. */
export function placeId(place: Pick<Place, 'key' | 'repo'>): string {
  return place.repo?.slug ?? place.key
}

/** One other repository as the Places section shows it. */
export type ShownPlace = {
  name: string
  /** The repository's GitHub page; null when it has none known. */
  url: string | null
  files: number
  commands: number
}

/**
 * The other repositories the session changed, in the order it first changed
 * them: every place but the session's own repository, one per GitHub
 * repository, each with files or commands to count. The pages created
 * anywhere show in the Links section.
 */
export function shownPlaces(status: SessionStatus): ShownPlace[] {
  const own = status.place
  const isOwnRepo = (slug: string | undefined) =>
    own?.repo != null && slug !== undefined && isSameRepo(own.repo.slug, slug)
  const shown = new Map<string, ShownPlace>()
  const groupOf = (slug: string | undefined, key: string) => slug?.toLowerCase() ?? key
  for (const place of status.places) {
    if (place.key === own?.root || isOwnRepo(place.repo?.slug)) {
      continue
    }
    const group = groupOf(place.repo?.slug, place.key)
    const seen = shown.get(group)
    shown.set(group, {
      name: seen?.name ?? place.name,
      url: seen?.url ?? place.repo?.url ?? null,
      files: (seen?.files ?? 0) + place.files.length,
      commands: (seen?.commands ?? 0) + place.commands,
    })
  }
  return [...shown.values()].filter(place => place.files + place.commands > 0)
}

/** A repository's name without its owner. */
function repoName(slug: string): string {
  return slug.split('/').pop() ?? slug
}
