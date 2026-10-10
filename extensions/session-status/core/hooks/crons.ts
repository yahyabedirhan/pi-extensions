// The cron jobs the session scheduled: what CronCreate made, CronDelete
// cancelled and CronList still lists, each fire, seen as a turn that starts
// with the job's prompt, and each recurring job's expiry. Nothing here calls
// `$`.

import type { CronJob, SessionStatus } from '../types'
import { autoSet, isDeleted } from './set-by'

/**
 * How long a recurring job lives: CronCreate's `recurring` input says a
 * recurring job fires "until deleted or auto-expired after 7 days".
 */
export const CRON_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

/** A new job from CronCreate's result: active, never fired; never again once the agent deleted it. */
export function cronCreated(
  status: SessionStatus,
  job: { id: string; schedule: string; prompt: string; recurring: boolean },
  at: number,
): SessionStatus {
  if (status.crons.some(known => known.id === job.id) || isDeleted(status, 'cron', job.id)) {
    return status
  }

  return { ...status, crons: [...status.crons, { ...job, state: 'active', fires: 0, createdAt: at, at }] }
}

/** A job CronDelete removed: cancelled, unless it already ended. A CronDelete is a new change, over a state the agent set too. */
export function cronDeleted(status: SessionStatus, id: string, at: number): SessionStatus {
  return withJob(cronsExpired(status, at), id, job =>
    job.state === 'active' || job.fieldsSetBy?.state !== undefined ? { ...autoSet(job, 'state', 'cancelled', 'event'), at } : job,
  )
}

/**
 * The jobs CronList still lists stay active; an active one-shot job it no
 * longer lists has fired (it deletes itself once it has). A list is a read:
 * a state the agent set stays.
 */
export function cronListed(status: SessionStatus, listed: readonly string[], at: number): SessionStatus {
  const current = cronsExpired(status, at)
  const crons = current.crons.map(job => {
    if (job.state !== 'active' || job.recurring || listed.includes(job.id)) {
      return job
    }
    const fired = autoSet(job, 'state', 'fired', 'read')

    return fired === job ? job : { ...fired, fires: Math.max(job.fires, 1), at }
  })

  return crons.some((job, index) => job !== current.crons[index]) ? { ...current, crons } : current
}

/**
 * A turn whose prompt is an active job's prompt is that job firing: a
 * one-shot job is then fired and done, a recurring one counts the fire. An
 * expired job no longer fires.
 */
export function cronFired(status: SessionStatus, prompt: string, at: number): SessionStatus {
  const current = cronsExpired(status, at)
  const job = current.crons.find(known => known.state === 'active' && known.prompt.trim() === prompt.trim())
  if (job === undefined) {
    return current
  }

  return withJob(current, job.id, known => ({
    ...known,
    state: known.recurring ? 'active' : 'fired',
    fires: known.fires + 1,
    at,
  }))
}

/**
 * The jobs as they stand at `now`: an active recurring job scheduled 7 days
 * or more before `now` is expired. The same array when none expired. An
 * expiry is a read: a job the agent set active after it expired stays active.
 */
export function expireCrons(crons: readonly CronJob[], now: number): readonly CronJob[] {
  const next = crons.map(job => {
    // A job held from before createdAt was kept counts from its last change.
    const expiresAt = (job.createdAt ?? job.at) + CRON_EXPIRY_MS

    if (job.state !== 'active' || !job.recurring || now < expiresAt) {
      return job
    }
    const expired = autoSet(job, 'state', 'expired', 'read')

    return expired === job ? job : { ...expired, at: expiresAt }
  })

  return next.some((job, index) => job !== crons[index]) ? next : crons
}

/** How many jobs are active, fired (done), expired and cancelled. */
export function cronCounts(crons: readonly CronJob[]): Record<CronJob['state'], number> {
  const counts = { active: 0, fired: 0, expired: 0, cancelled: 0 }
  for (const job of crons) {
    counts[job.state] += 1
  }

  return counts
}

/** The status with its jobs expired as of `at`. */
function cronsExpired(status: SessionStatus, at: number): SessionStatus {
  const crons = expireCrons(status.crons, at)

  return crons === status.crons ? status : { ...status, crons: [...crons] }
}

function withJob(status: SessionStatus, id: string, change: (job: CronJob) => CronJob): SessionStatus {
  const crons = status.crons.map(job => (job.id === id ? change(job) : job))

  return crons.some((job, index) => job !== status.crons[index]) ? { ...status, crons } : status
}
