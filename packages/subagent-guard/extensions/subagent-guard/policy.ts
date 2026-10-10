// The guard's rules, kept free of I/O: which Agent calls it blocks, which
// paths it protects, and what in an agent file or settings file it flags.
// The names and values follow @tintinweb/pi-subagents 0.20.0.

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** This extension's own name: an agent file that drops it lets nested calls escape too. */
export const SELF_NAME = 'subagent-guard'

const PREFIX = 'subagent-guard:'

/** The reason an `Agent` call (top-level or nested) is blocked, or undefined to let it run. */
export function agentCallBlock(input: Record<string, unknown>): string | undefined {
  if (input.isolated === true || input.isolated === 'true') {
    return `${PREFIX} \`isolated: true\` starts the subagent without extensions, so its tools would run outside the tool_call guardrail. Call Agent again without \`isolated\` (or with \`isolated: false\`).`
  }
  if (input.isolation === 'worktree') {
    return `${PREFIX} \`isolation: "worktree"\` commits the subagent's changes with \`git commit --no-verify\`, outside the tool_call guardrail. Call Agent again without \`isolation\` (or with \`isolation: "off"\`).`
  }
  if (typeof input.schedule === 'string' ? input.schedule.trim() !== '' : input.schedule != null) {
    return `${PREFIX} \`schedule\` runs the subagent later, when no one reviews it. Run the agent now without \`schedule\`, or ask the user to schedule it themselves.`
  }

  return undefined
}

export const WORKFLOW_BLOCK = `${PREFIX} SubagentWorkflow runs workflow gate commands through a shell, outside the tool_call guardrail. Use the Agent tool for each step instead.`

/** The project-relative places pi-subagents reads agent files, workflows and settings from. */
const PROJECT_DIRS = ['.pi/agents/', '.agents/agents/', '.pi/workflows/', '.agents/workflows/']
const PROJECT_FILES = ['.pi/subagents.json']

/**
 * Whether `path` (as a tool got it, relative to `cwd`) is a file pi-subagents
 * reads its agents, workflows or settings from: in any project, or in the
 * global agent dir. Compared lowercased, since macOS and Windows file systems
 * ignore case.
 */
export function isProtectedPath(path: string, cwd: string, agentDir: string): boolean {
  const absolute = normalize(resolvePath(path, cwd))
  const segments = `/${absolute.replace(/^\/+/, '')}`
  if (PROJECT_DIRS.some(dir => segments.includes(`/${dir}`))) {
    return true
  }
  if (PROJECT_FILES.some(file => segments.endsWith(`/${file}`))) {
    return true
  }
  const global = normalize(agentDir).replace(/\/+$/, '')

  return (
    absolute.startsWith(`${global}/agents/`) ||
    absolute.startsWith(`${global}/workflows/`) ||
    absolute === `${global}/subagents.json`
  )
}

function resolvePath(path: string, cwd: string): string {
  // Pi's file tools drop a leading `@` and expand `~`.
  const bare = path.startsWith('@') ? path.slice(1) : path
  const expanded = bare === '~' ? homedir() : bare.startsWith('~/') ? join(homedir(), bare.slice(2)) : bare

  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded)
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/').toLowerCase()
}

/**
 * The extension names a subagent must keep, from a comma list (the
 * `PI_SUBAGENT_GUARD_PROTECT` variable). Empty means unknown: then any
 * narrowing of a subagent's extensions counts as a risk.
 */
export function protectedNames(value: string | undefined): string[] {
  const names = csv(value).map(name => name.toLowerCase())

  return names.length === 0 ? [] : [...new Set([...names, SELF_NAME])]
}

/** What in an agent file's frontmatter lets its subagent run outside the guardrail. */
export function agentFileRisks(frontmatter: Record<string, unknown>, names: string[]): string[] {
  if (frontmatter.enabled === false) {
    return []
  }
  const risks: string[] = []
  if (frontmatter.isolated === true) {
    risks.push('isolated: true')
  }
  const extensions = frontmatter.extensions ?? frontmatter.inherit_extensions
  if (extensions === false || extensions === 'none' || extensions === '') {
    risks.push(`extensions: ${extensions === '' ? 'empty' : String(extensions)}`)
  } else if (extensions != null && extensions !== true) {
    const list = csv(extensions)
    const keepsAll = list.includes('*')
    const lower = list.map(name => name.toLowerCase())
    const dropsProtected = names.length === 0 ? true : names.some(name => !lower.includes(name))
    if (list.length === 0) {
      risks.push('extensions: empty')
    } else if (!keepsAll && dropsProtected) {
      risks.push(`extensions: ${list.join(', ')}`)
    }
  }
  const excluded = csv(frontmatter.exclude_extensions)
  const excludesProtected = names.length === 0 ? excluded.length > 0 : excluded.some(name => names.includes(name.toLowerCase()))
  if (excludesProtected) {
    risks.push(`exclude_extensions: ${excluded.join(', ')}`)
  }
  if (frontmatter.isolation === 'worktree') {
    risks.push('isolation: worktree')
  }

  return risks
}

/** The pi-subagents settings that turn on a path outside the guardrail. */
const RISKY_SETTINGS = ['workflowsEnabled', 'worktreeIsolation', 'schedulingEnabled'] as const

/** Which of those features a `subagents.json` turns on. */
export function settingsRisks(settings: unknown): string[] {
  if (settings === null || typeof settings !== 'object') {
    return []
  }
  const record = settings as Record<string, unknown>

  return RISKY_SETTINGS.filter(key => record[key] === true).map(key => `${key}: true`)
}

function csv(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []

  return items.map(item => String(item).trim()).filter(item => item !== '')
}
