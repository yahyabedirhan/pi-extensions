// The overlay's answers: what each choice does to the status and the prompt
// it sends in the person's own words. The same rules as the mod's pane
// buttons (register.tsx answerDecision, discussItem, closeSurprise).

import type { Blocker, Decision, SessionStatus, StatusItem, Surprise } from './core/types'
import { isOpen, markDiscussing } from './core/hooks/status'
import type { StatusStore } from './state'
import { closeStatusItem } from './tool'
import type { StatusEffects } from './tool'

/** One choice the overlay offers for an entry. */
export type Choice =
  | { kind: 'option'; decision: Decision; option: string }
  | { kind: 'discuss'; item: Decision | Surprise }
  | { kind: 'act'; surprise: Surprise; action: string }
  | { kind: 'file-issue'; surprise: Surprise }
  | { kind: 'dismiss'; surprise: Surprise }

/** One choice with the label the overlay shows for it. */
export type LabeledChoice = { label: string; choice: Choice }

/** The entries the overlay lists, in the order the widget shows them. */
export type Entry = Decision | Blocker | Surprise

/** The longest suggested action the mod shows as a button. */
const ACTION_MAX = 30

/**
 * The open entries the overlay lists: blocked decisions, blockers,
 * decisions before settling, follow-ups after settling, then surprises.
 */
export function openEntries(status: SessionStatus): Entry[] {
  const open = status.items.filter(isOpen)
  const decisions = (urgency: Decision['urgency']) =>
    open.filter((item): item is Decision => item.kind === 'decision' && item.urgency === urgency)

  return [
    ...decisions('blocked'),
    ...open.filter((item): item is Blocker => item.kind === 'blocker'),
    ...decisions('before_settling'),
    ...decisions('after_settling'),
    ...open.filter((item): item is Surprise => item.kind === 'surprise'),
  ]
}

/**
 * The choices for one entry: each option of a decision (the default marked
 * ✓) and Discuss; a surprise's suggested action when it is short, File
 * issue, Discuss and Dismiss. A blocker has none: the agent resolves it
 * once it works.
 */
export function choicesFor(entry: Entry): LabeledChoice[] {
  if (entry.kind === 'decision') {
    return [
      ...entry.options.map(option => ({
        label: option === entry.default ? `${option} ✓` : option,
        choice: { kind: 'option' as const, decision: entry, option },
      })),
      { label: 'Discuss', choice: { kind: 'discuss', item: entry } },
    ]
  }
  if (entry.kind === 'surprise') {
    const action = entry.action?.trim()

    return [
      ...(action !== undefined && action !== '' && action.length <= ACTION_MAX
        ? [{ label: action, choice: { kind: 'act' as const, surprise: entry, action } }]
        : []),
      { label: 'File issue', choice: { kind: 'file-issue', surprise: entry } },
      { label: 'Discuss', choice: { kind: 'discuss', item: entry } },
      { label: 'Dismiss', choice: { kind: 'dismiss', surprise: entry } },
    ]
  }

  return []
}

/**
 * Applies one choice to the status and says what to send as the person's
 * prompt; null sends nothing. An entry closed meanwhile (a second answer)
 * sends nothing, as in the mod.
 */
export function applyChoice(store: StatusStore, choice: Choice, now: number, effects: Pick<StatusEffects, 'ping'>): string | null {
  switch (choice.kind) {
    case 'option': {
      const closed = closeStatusItem(store, { kind: 'decision', id: choice.decision.id }, now, effects)

      return 'error' in closed ? null : `${choice.decision.id}: ${choice.option}`
    }
    case 'discuss': {
      const { item } = choice
      const target = { kind: item.kind, id: item.id }
      if (!isOpenItem(store.get(), target)) {
        return null
      }
      store.change(status => markDiscussing(status, target, now))
      const subject = item.kind === 'decision' ? item.question : item.occurred

      return `Let's discuss ${item.id}: ${subject}`
    }
    case 'act':
      return closeSurprise(store, choice.surprise, now, effects, `${choice.surprise.id}: ${choice.action}`)
    case 'file-issue':
      return closeSurprise(store, choice.surprise, now, effects, `File an issue for ${choice.surprise.id}: ${choice.surprise.occurred}`)
    case 'dismiss':
      return closeSurprise(store, choice.surprise, now, effects)
  }
}

/** Closes a surprise; File issue and the action mark it acted on and send `prompt`, Dismiss sends nothing. */
function closeSurprise(
  store: StatusStore,
  surprise: Surprise,
  now: number,
  effects: Pick<StatusEffects, 'ping'>,
  prompt?: string,
): string | null {
  const closed = closeStatusItem(store, { kind: 'surprise', id: surprise.id }, now, effects, { acted: prompt !== undefined })

  return 'error' in closed || prompt === undefined ? null : prompt
}

function isOpenItem(status: SessionStatus, target: { kind: StatusItem['kind']; id: string }): boolean {
  return status.items.some(item => item.kind === target.kind && item.id === target.id && isOpen(item))
}
