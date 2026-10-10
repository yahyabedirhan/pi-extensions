// Effort detection as data: whether a tool call shows that the session runs
// an effort, and the effort's name. register.tsx feeds it the tool calls and
// reads the branch name for it; nothing here calls `$`.

import type { Effort, SessionStatus } from '../types'
import { isDeleted } from './set-by'
import { simpleCommands } from './shell'

/** The skills that run an effort: a Skill call to one of them is an effort run. */
export const EFFORT_SKILLS: readonly string[] = ['orchestrate-effort', 'orchestrate-with-handoff']

/**
 * An `effort:<name>` label in a command: after a start, a space, a quote, `=`,
 * `,` or `:`, as `--label effort:x`, `--label "effort:x"` or `label:effort:x`
 * write it.
 */
const EFFORT_LABEL = /(?:^|[\s"'=,:])effort:([A-Za-z0-9][A-Za-z0-9._-]*)/

/**
 * What one tool call shows about an effort run: null when it shows none;
 * else the run, with the effort's name when the call names its label.
 */
export type EffortSighting = { name: string | null }

/**
 * The effort run a tool call shows: a Skill call to an effort skill (a
 * plugin's `<plugin>:<skill>` too), or a Bash command that runs a `gh`
 * command with an `effort:<name>` label. A label anywhere else, as in a
 * heredoc's script or an `echo`, is no effort run.
 */
export function effortSighting(call: { tool: string }): EffortSighting | null {
  const input = call as unknown as Record<string, unknown>
  if (call.tool === 'Skill' && typeof input.skill === 'string') {
    const skill = input.skill.slice(input.skill.lastIndexOf(':') + 1)
    if (!EFFORT_SKILLS.includes(skill)) {
      return null
    }

    return { name: typeof input.args === 'string' ? effortLabel(input.args) : null }
  }
  if (call.tool === 'Bash' && typeof input.command === 'string') {
    for (const part of simpleCommands(input.command)) {
      const name = /^gh\s/.test(part) ? effortLabel(part) : null
      if (name !== null) {
        return { name }
      }
    }

    return null
  }

  return null
}

/** The name in the first `effort:<name>` label of `text`; null when it has none. */
export function effortLabel(text: string): string | null {
  return EFFORT_LABEL.exec(text)?.[1] ?? null
}

/**
 * The effort's name from `git branch --show-current`'s output: the branch,
 * or null on a detached head or an empty answer.
 */
export function branchEffortName(stdout: string): string | null {
  const branch = stdout.trim()

  return branch === '' || branch === 'HEAD' ? null : branch
}

/**
 * The status with the effort it runs. A ticket report's name always wins: a
 * report for another effort switches the session to it. Otherwise the first
 * name found holds, except that a label's name replaces a branch's.
 *
 * No source brings back an effort the agent deleted; `create` does. A name
 * the agent set with `update` stays until a label or a branch names another
 * effort than the one found before (a branch never wins over a label's or a
 * report's effort); a report is a new change and always wins.
 */
export function withEffort(status: SessionStatus, found: Effort): SessionStatus {
  const known = status.effort
  if (isDeleted(status, 'effort', found.name)) {
    return status
  }
  const mark = known?.fieldsSetBy?.name
  if (found.from !== 'report' && known !== null && mark !== undefined) {
    const isWeaker = found.from === 'branch' && known.from !== undefined && known.from !== 'branch'
    if (found.name === mark.lastAuto || found.name === known.name || isWeaker) {
      return status
    }

    return { ...status, effort: found }
  }
  if (found.from === 'report') {
    return known?.name === found.name ? status : { ...status, effort: found }
  }
  if (known !== null && (known.from === 'label' || known.from === 'report' || found.from !== 'label')) {
    return status
  }

  return { ...status, effort: found }
}
