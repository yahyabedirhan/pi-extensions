// The session's task list as data: the pure rules that mirror it from the
// Task events and the task tools' results, and the progress it gives.
// There is no task noun on `$`; register.tsx feeds these from the events.

import type { Progress, SessionStatus, Task } from '../types'
import { autoSet, isDeleted } from './set-by'
import type { AutoSource } from './set-by'

type Status = Task['status']

/** A task the task tools or the TaskCreated event made: added once, by id; never again once the agent deleted it. */
export function taskCreated(
  status: SessionStatus,
  task: { id: string; subject: string; activeForm?: string },
  at: number,
): SessionStatus {
  if (status.tasks.some(known => known.id === task.id) || isDeleted(status, 'task', task.id)) {
    return status
  }
  const created: Task = { id: task.id, subject: task.subject, status: 'pending', at }
  if (task.activeForm !== undefined && task.activeForm !== '') {
    created.activeForm = task.activeForm
  }

  return withTasks(status, [...status.tasks, created])
}

/**
 * A change to one task: a new status (`deleted` removes the task), subject
 * or active form. A task not known yet is added when the change names its
 * subject, since its creation may have come before the mod loaded. A task
 * event is a new change: it overwrites a subject or status the agent set
 * with `update`; a `read` (a TodoWrite list stated again) does not.
 */
export function taskUpdated(
  status: SessionStatus,
  change: {
    id: string
    status?: Status | 'deleted'
    subject?: string
    activeForm?: string
  },
  at: number,
  source: AutoSource = 'event',
): SessionStatus {
  if (change.status === 'deleted') {
    return withTasks(
      status,
      status.tasks.filter(task => task.id !== change.id),
    )
  }
  const known = status.tasks.find(task => task.id === change.id)
  if (known === undefined) {
    if (change.subject === undefined || isDeleted(status, 'task', change.id)) {
      return status
    }
    const created = taskCreated(status, { id: change.id, subject: change.subject }, at)

    return taskUpdated(created, change, at, source)
  }
  let updated: Task = { ...known, at }
  if (change.status !== undefined) {
    updated = autoSet(updated, 'status', change.status, source)
  }
  if (change.subject !== undefined && change.subject !== '') {
    updated = autoSet(updated, 'subject', change.subject, source)
  }
  if (change.activeForm !== undefined && change.activeForm !== '') {
    updated.activeForm = change.activeForm
  }

  return withTasks(
    status,
    status.tasks.map(task => (task.id === change.id ? updated : task)),
  )
}

/**
 * A TodoWrite list replaces the loop's earlier list whole. Each item is keyed
 * by its loop and place, since TodoWrite items carry no id. The list states
 * every item again, so a field the agent set stays until the list changes
 * it, and an item the agent deleted stays out.
 */
export function todosWritten(
  status: SessionStatus,
  todos: readonly { content: string; status: Status; activeForm?: string }[],
  agentId: string | undefined,
  at: number,
): SessionStatus {
  const prefix = `todo:${agentId ?? 'main'}:`
  const kept = status.tasks.filter(task => !task.id.startsWith(prefix))
  const written = todos.flatMap((todo, index): Task[] => {
    const id = `${prefix}${index}`
    if (isDeleted(status, 'task', todoKey(prefix, todo.content))) {
      return []
    }
    const known = status.tasks.find(task => task.id === id)
    let task: Task = known === undefined ? { id, subject: todo.content, status: todo.status, at } : { ...known, at }
    task = autoSet(autoSet(task, 'subject', todo.content, 'read'), 'status', todo.status, 'read')
    if (todo.activeForm !== undefined && todo.activeForm !== '') {
      task.activeForm = todo.activeForm
    } else {
      delete task.activeForm
    }

    return [task]
  })

  return withTasks(status, [...kept, ...written])
}

/**
 * Progress from a task list: tasks done, the total, and the name of the task
 * that runs now; null for an empty list.
 */
export function progressOf(tasks: readonly Task[]): Progress | null {
  if (tasks.length === 0) {
    return null
  }

  return {
    done: tasks.filter(task => task.status === 'completed').length,
    total: tasks.length,
    current: currentTask(tasks)?.subject ?? null,
  }
}

/** The task that runs now: of those in progress, the one that changed last. */
export function currentTask(tasks: readonly Task[]): Task | null {
  return tasks
    .filter(task => task.status === 'in_progress')
    .reduce<Task | null>((last, task) => (last === null || task.at >= last.at ? task : last), null)
}

/**
 * What a deleted TodoWrite item is known by: its loop and its content, so a
 * later item at the same place in the list is not hidden.
 */
export function todoKey(prefix: string, content: string): string {
  return `${prefix}${content}`
}

/** The task a `delete` remembers: a TodoWrite item by `todoKey`, any other task by its id. */
export function deletedTaskKey(task: Pick<Task, 'id' | 'subject'>): string {
  const prefix = /^todo:[^:]+:/.exec(task.id)?.[0]

  return prefix === undefined ? task.id : todoKey(prefix, task.subject)
}

/** The status with this task list, and the progress it gives. */
export function withTasks(status: SessionStatus, tasks: Task[]): SessionStatus {
  return { ...status, tasks, progress: progressOf(tasks) }
}

/**
 * The task list as the Task section lists it: the running tasks first, then
 * the pending ones, then the completed ones, each in the order it was made.
 */
export function listedTasks(status: SessionStatus | null): Task[] {
  const tasks = status?.tasks ?? []
  const of = (state: Status) => tasks.filter(task => task.status === state)

  return [...of('in_progress'), ...of('pending'), ...of('completed')]
}
