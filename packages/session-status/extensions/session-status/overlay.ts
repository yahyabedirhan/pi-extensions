// The persistent sidebar's list and choices. Answers reset the selection;
// index.ts applies them without removing the owned overlay.
// Esc goes back from details, then releases focus from the list.

import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

import type { SessionStatus } from './core/types'
import { choicesFor, openEntries } from './replies'
import type { Choice, Entry, LabeledChoice } from './replies'
import { sidebarRows } from './sidebar'
import type { SidebarMetadata } from './sidebar'
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

/** Sidebar sizing policy, independent of Pi's overlay lifecycle. */
export const MIN_SIDEBAR_WIDTH = 12
const DEFAULT_SIDEBAR_WIDTH = 64
const SIDEBAR_RESIZE_STEP = 4

export function sidebarWidth(width: number | undefined): number {
  return width ?? DEFAULT_SIDEBAR_WIDTH
}

export function resizeSidebarWidth(width: number | undefined, columns: number, direction: -1 | 1): number {
  const current = Math.min(columns, sidebarWidth(width))
  return Math.min(columns, Math.max(MIN_SIDEBAR_WIDTH, current + direction * SIDEBAR_RESIZE_STEP))
}

/** The sidebar's selection and viewport state, driven by named keys. */
export class StatusOverlayModel {
  private selected = 0
  private openEntry: Entry | null = null
  private choiceIndex = 0
  private scroll: number | null = null
  private viewportStart = 0
  private viewportSize = 1
  private followSelection = false

  viewport(total: number, capacity: number, selectedRow: number): number {
    this.viewportSize = Math.max(capacity, 1)
    const automatic = this.followSelection ? Math.max(selectedRow - 1, 0) : 0
    this.viewportStart = Math.max(0, Math.min(this.scroll ?? automatic, Math.max(total - capacity, 0)))
    return this.viewportStart
  }

  constructor(
    private readonly read: () => SessionStatus,
    private readonly done: (choice: Choice | undefined) => void,
    private readonly metadata: () => SidebarMetadata = () => ({}),
  ) {}

  summary(paint: Paint) {
    return sidebarRows(this.read(), paint, this.metadata())
  }

  entries(): Entry[] {
    return openEntries(this.read())
  }

  /** The entry the choices belong to; null while the list shows. */
  current(): Entry | null {
    if (this.openEntry !== null) {
      this.openEntry = this.entries().find(entry => entry.id === this.openEntry?.id) ?? null
    }
    return this.openEntry
  }

  choices(): LabeledChoice[] {
    return this.openEntry === null ? [] : choicesFor(this.openEntry)
  }

  selection(): number {
    this.current()
    this.choiceIndex = Math.min(this.choiceIndex, Math.max(this.choices().length - 1, 0))
    return this.openEntry === null ? Math.min(this.selected, Math.max(this.entries().length - 1, 0)) : this.choiceIndex
  }

  /** Handles one key by name: `up`, `down`, `enter`, `escape` or a digit. */
  press(key: string): void {
    this.current()
    if (key === 'pageup' || key === 'pagedown') {
      this.scroll = Math.max(0, this.viewportStart + (key === 'pageup' ? -1 : 1) * Math.max(this.viewportSize - 1, 1))
      return
    }
    this.scroll = null
    if (key === 'up' || key === 'down' || key === 'enter' || /^[1-9]$/.test(key)) this.followSelection = true
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
      this.openEntry = null
      this.selected = 0
      this.choiceIndex = 0
      this.followSelection = false
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
  if (matchesKey(data, 'pageUp')) return 'pageup'
  if (matchesKey(data, 'pageDown')) return 'pagedown'
  if (matchesKey(data, 'tab')) return 'tab'
  if (matchesKey(data, 'alt+s')) return 'focus'
  // Shifted arrows move the right sidebar's left edge; punctuation changes its width.
  if (matchesKey(data, 'shift+right') || data === '<') return '<'
  if (matchesKey(data, 'shift+left') || data === '>') return '>'
  if (/^[1-9]$/.test(data)) return data

  return null
}

/** The overlay's lines for a width, framed. */
export function overlayLines(model: StatusOverlayModel, paint: Paint, width: number, height?: number, focused = false): string[] {
  const inner = Math.max(width - 4, 1)
  const body: string[] = []
  let selectedLine = -1
  const entry = model.current()
  if (entry === null) {
    const entries = model.entries()
    const selectedId = entries[model.selection()]?.id
    for (const row of model.summary(paint)) {
      const selected = row.entryId !== undefined && row.entryId === selectedId
      if (selected) selectedLine = body.length
      body.push(selected ? paint.fg('accent', `▶ ${row.text.trimStart()}`) : row.text)
    }
    if (focused) body.push('', paint.fg('dim', '↑↓ move · Enter answer · Tab/Esc editor · Shift+←/→ resize'))
  } else {
    body.push(paint.bold(entryLine(entry)), ...entryDetail(entry).map(detail => paint.fg('dim', detail)), '')
    model.choices().forEach((choice, index) => {
      const isSelected = index === model.selection()
      const line = `${isSelected ? '▶' : ' '} ${index + 1}. ${choice.label}`
      if (isSelected) selectedLine = body.length
      body.push(isSelected ? paint.fg('accent', line) : line)
    })
    body.push('', paint.fg('dim', '↑↓ move · Enter or 1-9 pick · Esc back'))
  }
  const row = (text: string) => {
    const cut = truncateToWidth(text, inner)

    return `${paint.fg('muted', '│')} ${cut}${' '.repeat(Math.max(inner - visibleWidth(cut), 0))} ${paint.fg('muted', '│')}`
  }

  let selectedRow = -1
  const wrapped: string[] = []
  body.forEach((line, index) => {
    if (index === selectedLine) selectedRow = wrapped.length
    wrapped.push(...wrapTextWithAnsi(line, inner))
  })
  const capacity = height === undefined ? wrapped.length : Math.max(height - 2, 0)
  const start = model.viewport(wrapped.length, capacity, selectedRow)
  const visible = wrapped.slice(start, start + capacity)
  while (visible.length < capacity) visible.push('')
  return [
    paint.fg('muted', `╭${'─'.repeat(inner + 2)}╮`),
    ...visible.map(row),
    paint.fg('muted', `╰${'─'.repeat(inner + 2)}╯`),
  ].slice(0, height).map(line => truncateToWidth(line, width))
}
