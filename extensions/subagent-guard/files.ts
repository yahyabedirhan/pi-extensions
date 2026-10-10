// Reads the agent files and project settings pi-subagents would load, and
// applies the rules in policy.ts to them. Load order and type names follow
// @tintinweb/pi-subagents 0.20.0 (src/custom-agents.ts, src/settings.ts).

import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

import { parseFrontmatter } from '@earendil-works/pi-coding-agent'

import { agentFileRisks, settingsRisks } from './policy'

interface AgentFile {
  path: string
  type: string
  frontmatter: Record<string, unknown>
}

/** The project's agent dirs, lowest priority first: a later file wins a name. */
const PROJECT_AGENT_DIRS = ['.agents/agents', '.pi/agents']
const PROJECT_SETTINGS = '.pi/subagents.json'

function readAgentDir(dir: string): AgentFile[] {
  let names: string[]
  try {
    names = readdirSync(dir).filter(name => name.endsWith('.md')).sort()
  } catch {
    return []
  }
  const files: AgentFile[] = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(readFileSync(path, 'utf8'))
      const declared = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : ''
      files.push({ path, type: declared || basename(name, '.md'), frontmatter })
    } catch {
      // pi-subagents skips a file it cannot read or parse, so it adds no agent.
    }
  }

  return files
}

/**
 * The risks of the agent file an `Agent` call with `type` would run, or
 * undefined when the type has none or comes from no file (a built-in agent).
 */
export function agentTypeRisks(
  cwd: string,
  agentDir: string,
  type: string,
  names: string[],
): { path: string; risks: string[] } | undefined {
  const dirs = [join(agentDir, 'agents'), ...PROJECT_AGENT_DIRS.map(dir => join(cwd, dir))]
  const wanted = type.toLowerCase()
  const file = dirs
    .flatMap(readAgentDir)
    .filter(candidate => candidate.type.toLowerCase() === wanted)
    .at(-1)
  const risks = file ? agentFileRisks(file.frontmatter, names) : []

  return file && risks.length > 0 ? { path: file.path, risks } : undefined
}

/** One line per project agent file or settings key that lets a subagent run outside the guardrail. */
export function projectWarnings(cwd: string, names: string[]): string[] {
  const warnings: string[] = []
  for (const dir of PROJECT_AGENT_DIRS) {
    for (const file of readAgentDir(join(cwd, dir))) {
      const risks = agentFileRisks(file.frontmatter, names)
      if (risks.length > 0) {
        warnings.push(`${relative(cwd, file.path)}: ${risks.join('; ')}`)
      }
    }
  }
  let settings: unknown = null
  try {
    settings = JSON.parse(readFileSync(join(cwd, PROJECT_SETTINGS), 'utf8'))
  } catch {
    // No file, or one pi-subagents cannot parse either.
  }
  const risks = settingsRisks(settings)
  if (risks.length > 0) {
    warnings.push(`${PROJECT_SETTINGS}: ${risks.join('; ')}`)
  }

  return warnings
}
