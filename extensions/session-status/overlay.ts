// The overlay that answers the status: pick an open entry, then one of its
// choices. It resolves with the choice; index.ts applies it and sends the
// prompt. Keys: ↑↓ (or j/k) move, Enter opens or picks, 1-9 pick a choice,
// Esc goes back, then closes.

import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import type { SessionStatus } from './core/types'
import { choicesFor, openEntries } from './replies'
import type { Choice, Entry, LabeledChoice } from './replies'
import type { Paint } from './view'

/** One line that names an entry: its id, its text and its kind's heading. */
export function entryLine(entry: Entry): string {
  switch (entry.kind) {
    case 'decision': {
      const group = entry.urgency === 'blocked' ? 'blocked' : entry.urgency === 'before_settling' ? 'decide' : 'follow-up'

      return `${entry.id} ${entry.question} (${group})`
    }
    case 'blocker':
      return `${entry.id} ${entry.failed} (blocker)`
    case 'surprise':
      return `${entry.id} ${entry.occurred} (surprise)`
  }
}

/** The lines under the selected entry that say more about it. */
function entryDetail(entry: Entry): string[] {
  switch (entry.kind) {
    case 'decision':
      return [`Default: ${entry.default}`, `Unblocks: ${entry.unblocks}`]
    case 'blocker':
      return [`Needs: ${entry.needs}`, 'The agent resolves it once it works.']
    case 'surprise':
      return [`Changed: ${entry.changed}`]
  }
}

/**
 * The overlay's state and keys, apart from drawing: index.ts and the tests
 * drive it with key names.
 */
export class StatusOverlayModel {
  private selected = 0
  private openEntry: Entry | null = null
  private choiceIndex = 0

  constructor(
    private readonly read: () => SessionStatus,
    private readonly done: (choice: Choice | undefined) => void,
  ) {}

  entries(): Entry[] {
    return openEntries(this.read())
  }

  /** The entry the choices belong to; null while the list shows. */
  current(): Entry | null {
    return this.openEntry
  }

  choices(): LabeledChoice[] {
    return this.openEntry === null ? [] : choicesFor(this.openEntry)
  }

  selection(): number {
    return this.openEntry === null ? Math.min(this.selected, Math.max(this.entries().length - 1, 0)) : this.choiceIndex
  }

  /** Handles one key by name: `up`, `down`, `enter`, `escape` or a digit. */
  press(key: string): void {
    const size = this.openEntry === null ? this.entries().length : this.choices().length
    const index = this.selection()
    if (key === 'escape') {
      if (this.openEntry === null) {
        this.done(undefined)
      } else {
        this.openEntry = null
      }

      return
    }
    if (key === 'up') {
      this.setSelection(Math.max(index - 1, 0))
    } else if (key === 'down') {
      this.setSelection(Math.min(index + 1, Math.max(size - 1, 0)))
    } else if (key === 'enter') {
      this.pick(index)
    } else if (/^[1-9]$/.test(key) && this.openEntry !== null) {
      this.pick(Number(key) - 1)
    }
  }

  private setSelection(index: number): void {
    if (this.openEntry === null) {
      this.selected = index
    } else {
      this.choiceIndex = index
    }
  }

  private pick(index: number): void {
    if (this.openEntry === null) {
      const entry = this.entries()[index]
      if (entry !== undefined && choicesFor(entry).length > 0) {
        this.openEntry = entry
        this.choiceIndex = 0
      }

      return
    }
    const choice = this.choices()[index]
    if (choice !== undefined) {
      this.done(choice.choice)
    }
  }
}

/** The key name a terminal input stands for, or null for a key the overlay leaves alone. */
export function keyName(data: string): string | null {
  if (matchesKey(data, 'up') || data === 'k') return 'up'
  if (matchesKey(data, 'down') || data === 'j') return 'down'
  if (matchesKey(data, 'return') || matchesKey(data, 'enter')) return 'enter'
  if (matchesKey(data, 'escape') || data === 'q') return 'escape'
  if (/^[1-9]$/.test(data)) return data

  return null
}

/** The overlay's lines for a width, framed. */
export function overlayLines(model: StatusOverlayModel, paint: Paint, width: number): string[] {
  const inner = Math.max(width - 4, 10)
  const body: string[] = []
  const entry = model.current()
  if (entry === null) {
    const entries = model.entries()
    body.push(paint.bold('Session status'), '')
    if (entries.length === 0) {
      body.push(paint.fg('dim', 'Nothing is open.'))
    }
    entries.forEach((candidate, index) => {
      const isSelected = index === model.selection()
      const line = `${isSelected ? '▶' : ' '} ${entryLine(candidate)}`
      body.push(isSelected ? paint.fg('accent', line) : line)
      if (isSelected) {
        body.push(...entryDetail(candidate).map(detail => paint.fg('dim', `    ${detail}`)))
      }
    })
    body.push('', paint.fg('dim', '↑↓ move · Enter answer · Esc close'))
  } else {
    body.push(paint.bold(entryLine(entry)), ...entryDetail(entry).map(detail => paint.fg('dim', detail)), '')
    model.choices().forEach((choice, index) => {
      const isSelected = index === model.selection()
      const line = `${isSelected ? '▶' : ' '} ${index + 1}. ${choice.label}`
      body.push(isSelected ? paint.fg('accent', line) : line)
    })
    body.push('', paint.fg('dim', '↑↓ move · Enter or 1-9 pick · Esc back'))
  }
  const row = (text: string) => {
    const cut = truncateToWidth(text, inner)

    return `${paint.fg('muted', '│')} ${cut}${' '.repeat(Math.max(inner - visibleWidth(cut), 0))} ${paint.fg('muted', '│')}`
  }

  return [
    paint.fg('muted', `╭${'─'.repeat(inner + 2)}╮`),
    ...body.map(row),
    paint.fg('muted', `╰${'─'.repeat(inner + 2)}╯`),
  ]
}
