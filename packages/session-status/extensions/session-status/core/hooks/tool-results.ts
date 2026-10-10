// What a finished tool call changes in the status: the task tools' results
// change the task list, the Cron tools the cron jobs, and `gh pr create` /
// `gh issue create` add links, and `gh` merges, closes and reopens add the
// page too and change its state.
// A subagent's calls count as the main loop's do.

import type { ToolCallInput, ToolCallResult } from 'claude-code'

import type { SessionStatus } from '../types'
import { changedPages, findCreatedLinks, findStateChanges, linkStatesChanged, linksFound } from './links'
import { formatCron } from './cron-schedule'
import { cronCreated, cronDeleted, cronListed } from './crons'
import { taskCreated, taskUpdated, todosWritten } from './tasks'

type Fields = Record<string, unknown>

/**
 * The change a finished tool call makes to the status, or null when it makes
 * none: an error, a denied call or a tool this mod does not read.
 */
export function toolResultChange(
  call: ToolCallInput,
  answer: ToolCallResult,
  at: number,
): ((status: SessionStatus) => SessionStatus) | null {
  if (answer.deny !== undefined || answer.isError === true) {
    return null
  }
  const input = call as unknown as Fields
  const result = asFields(answer.result)

  switch (call.tool) {
    case 'TaskCreate': {
      const task = asFields(result?.task)
      const id = text(task?.id)
      if (id === undefined) {
        return null
      }
      const subject = text(task?.subject) ?? text(input.subject) ?? id

      return status => taskCreated(status, { id, subject, activeForm: text(input.activeForm) }, at)
    }
    case 'TaskUpdate': {
      const id = text(result?.taskId) ?? text(input.taskId)
      if (id === undefined || result?.success === false) {
        return null
      }
      const statusChange = asFields(result?.statusChange)
      const next = taskStatus(statusChange?.to) ?? taskStatus(input.status)

      return status =>
        taskUpdated(
          status,
          { id, status: next, subject: text(input.subject), activeForm: text(input.activeForm) },
          at,
        )
    }
    case 'CronCreate': {
      const id = text(result?.id)
      const prompt = text(input.prompt)
      if (id === undefined || prompt === undefined) {
        return null
      }
      const job = {
        id,
        schedule: scheduleText(text(input.cron), text(result?.humanSchedule)),
        prompt,
        recurring: result?.recurring === true,
      }

      return status => cronCreated(status, job, at)
    }
    case 'CronDelete': {
      const id = text(result?.id) ?? text(input.id)

      return id === undefined ? null : status => cronDeleted(status, id, at)
    }
    case 'CronList': {
      if (!Array.isArray(result?.jobs)) {
        return null
      }
      const listed = result.jobs.flatMap(job => text(asFields(job)?.id) ?? [])

      return status => cronListed(status, listed, at)
    }
    case 'TodoWrite': {
      const todos = Array.isArray(result?.newTodos) ? result.newTodos : input.todos
      if (!Array.isArray(todos)) {
        return null
      }

      return status => todosWritten(status, todos.flatMap(todoItem), call.agentId, at)
    }
    case 'Bash': {
      const command = text(input.command) ?? ''
      const output = [text(result?.stdout), text(answer.result), text(answer.text)]
        .filter(part => part !== undefined)
        .join('\n')
      const found = findCreatedLinks(command, output)
      const changes = findStateChanges(command, output)
      if (found.length === 0 && changes.length === 0) {
        return null
      }

      return status => {
        const linked = linksFound(status, found, { agentId: call.agentId, at })

        return linkStatesChanged(linksFound(linked, changedPages(linked, changes), { agentId: call.agentId, at }), changes)
      }
    }
    default:
      return null
  }
}

/**
 * A job's schedule as the pane shows it: the cron expression as short text;
 * else CronCreate's `humanSchedule` (live, it is the expression itself); else
 * the expression.
 */
function scheduleText(cron: string | undefined, human: string | undefined): string {
  return (cron === undefined ? undefined : formatCron(cron)) ?? human ?? cron ?? ''
}

function todoItem(value: unknown): { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }[] {
  const todo = asFields(value)
  const content = text(todo?.content)
  const status = taskStatus(todo?.status)
  if (content === undefined || status === undefined || status === 'deleted') {
    return []
  }

  return [{ content, status, activeForm: text(todo?.activeForm) }]
}

function taskStatus(value: unknown): 'pending' | 'in_progress' | 'completed' | 'deleted' | undefined {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted'
    ? value
    : undefined
}

function asFields(value: unknown): Fields | undefined {
  return typeof value === 'object' && value !== null ? (value as Fields) : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
