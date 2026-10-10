// What the widget and the footer show, as plain lines. A `Paint` adds the
// theme's colours and links; tests pass one that adds nothing. The sections
// follow the mod's pane, top to bottom, and an empty section is not drawn.

import type { Decision, SessionLink, SessionStatus, Surprise } from './core/types'
import { HEADLINE_TEXT, headline } from './core/hooks/activity'
import type { Headline } from './core/hooks/activity'
import { effortProgress, effortTickets } from './core/hooks/effort-progress'
import { linkLabel } from './core/hooks/links'
import { listedItems } from './core/hooks/session-items'
import { sessionProgress } from './core/hooks/session-progress'
import { isOpen, onEndList, openBlockers, openFollowUps, openToDecide } from './core/hooks/status'
import { ticketShortName } from './core/hooks/ticket-reports'

/** The theme colours the view uses: the names match Pi's theme tokens. */
export type Tone = 'accent' | 'warning' | 'success' | 'error' | 'muted' | 'dim'

/** How the view styles text; `plain` styles nothing. */
export type Paint = {
  fg(tone: Tone, text: string): string
  bold(text: string): string
  link(text: string, url: string): string
}

export const plain: Paint = { fg: (_tone, text) => text, bold: text => text, link: text => text }

/** How many entries each list shows before `+N more`. */
const LIMIT = { items: 2, tickets: 2, links: 5, decide: 5, followUp: 3, surprises: 2 } as const

/** The key that opens the overlay, as the widget names it. */
export const OVERLAY_HINT = 'alt+s'

const HEADLINE_TONE: Record<Headline, Tone> = {
  blocked: 'warning',
  working: 'success',
  settling: 'success',
  waiting: 'accent',
  settled: 'dim',
}

/** The widget's lines; empty when there is nothing to show. */
export function widgetLines(status: SessionStatus, paint: Paint = plain): string[] {
  const sections = [
    blockedSection(status, paint),
    blockersSection(status, paint),
    sessionSection(status, paint),
    effortSection(status, paint),
    linksSection(status, paint),
    decideSection(status, paint),
    followUpSection(status, paint),
    surprisesSection(status, paint),
  ].filter(lines => lines.length > 0)
  if (sections.length === 0) {
    return []
  }
  const state = headline(status)
  const top = [
    ...(state === null ? [] : [paint.fg(HEADLINE_TONE[state], `● ${HEADLINE_TEXT[state]}`)]),
    paint.fg('dim', `${OVERLAY_HINT} to answer`),
  ].join(paint.fg('dim', ' · '))

  return [top, ...sections.flat()]
}

/**
 * `<n> blocked · <n> decide · <n> follow-up · progress 7/10 · closed 1/13 · <n> surprise`,
 * as the mod's band shows it: follow-up only when there is one, progress
 * once the session has items, closed while the tracker counts the effort.
 * Tasks have no Pi source, so the band leaves them out.
 */
export function bandText(status: SessionStatus): string {
  const open = status.items.filter(isOpen)
  const decisions = open.filter((item): item is Decision => item.kind === 'decision')
  const blocked = decisions.filter(item => item.urgency === 'blocked').length + open.filter(item => item.kind === 'blocker').length
  const followUp = decisions.filter(item => item.urgency === 'after_settling').length
  const surprises = open.filter(item => item.kind === 'surprise' && item.source !== 'observer').length
  const session = sessionProgress(status)
  const effort = effortProgress(status)

  return [
    `${blocked} blocked`,
    `${decisions.filter(item => item.urgency === 'before_settling').length} decide`,
    ...(followUp === 0 ? [] : [`${followUp} follow-up`]),
    ...(session === null || session.total === 0 ? [] : [`progress ${session.done}/${session.total}`]),
    ...(effort === null ? [] : [`closed ${effort.closed}/${effort.total}`]),
    `${surprises} surprise`,
  ].join(' · ')
}

function heading(paint: Paint, text: string): string {
  return paint.bold(text)
}

function more(paint: Paint, count: number): string[] {
  return count > 0 ? [paint.fg('dim', `  +${count} more`)] : []
}

function decisionLine(paint: Paint, decision: Decision, tone: Tone): string {
  const mark = decision.discussingAt === undefined ? '' : paint.fg('dim', ' (discussing)')

  return `  ${paint.fg(tone, decision.id)} ${decision.question}${mark} ${paint.fg('dim', `· default: ${decision.default}`)}`
}

function blockedSection(status: SessionStatus, paint: Paint): string[] {
  const blocked = status.items.filter((item): item is Decision => item.kind === 'decision' && item.urgency === 'blocked' && isOpen(item))

  return blocked.length === 0 ? [] : [heading(paint, 'Blocked on you'), ...blocked.map(d => decisionLine(paint, d, 'warning'))]
}

function blockersSection(status: SessionStatus, paint: Paint): string[] {
  const blockers = openBlockers(status)

  return blockers.length === 0
    ? []
    : [
        heading(paint, 'You should know'),
        ...blockers.map(b => `  ${paint.fg('warning', b.id)} ${b.failed} ${paint.fg('dim', `· needs: ${b.needs}`)}`),
      ]
}

function bar(done: number, total: number, width = 12): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

function sessionSection(status: SessionStatus, paint: Paint): string[] {
  const progress = sessionProgress(status)
  if (progress === null) {
    return []
  }
  const items = listedItems(status)
  const shown = items.slice(0, LIMIT.items)
  const building = progress.building.map(ticketShortName)

  return [
    `${heading(paint, 'Session')}  Progress ${progress.done}/${progress.total} ${bar(progress.done, progress.total)}`,
    ...shown.map(item =>
      item.state === 'done'
        ? `  ${paint.fg('success', '✓')} ${paint.fg('accent', item.id)} ${paint.fg('dim', item.title)}`
        : `  ○ ${paint.fg('accent', item.id)} ${item.title}`,
    ),
    ...more(paint, items.length - shown.length),
    ...(building.length === 0 ? [] : [`  Building: ${paint.fg('accent', building.join(', '))}`]),
  ]
}

function effortSection(status: SessionStatus, paint: Paint): string[] {
  const effort = status.effort
  if (effort === null) {
    return []
  }
  const progress = effortProgress(status)
  const tickets = effortTickets(status)
  const shown = tickets.slice(0, LIMIT.tickets)

  return [
    `${heading(paint, 'Effort')}  ${effort.name}${progress === null ? '' : `  Closed ${progress.closed}/${progress.total} ${bar(progress.closed, progress.total)}`}`,
    ...shown.map(t => `  ${t.isClosed ? paint.fg('success', '✓') : '○'} #${t.number} ${t.title}`),
    ...more(paint, tickets.length - shown.length),
  ]
}

/** A link's mark: ⇄ for a pull request, ◎ or ⊙ for an issue, coloured by its state. */
function linkMark(paint: Paint, link: SessionLink): string {
  const state = link.state ?? 'open'
  if (link.kind === 'pr') {
    return paint.fg(state === 'open' ? 'success' : state === 'merged' ? 'accent' : 'error', '⇄')
  }

  return state === 'open' ? paint.fg('success', '◎') : paint.fg('accent', '⊙')
}

function linksSection(status: SessionStatus, paint: Paint): string[] {
  if (status.links.length === 0) {
    return []
  }
  const shown = status.links.slice(-LIMIT.links).reverse()
  const labels = shown.map(link => `${linkMark(paint, link)} ${paint.link(linkLabel(link), link.url)}`)
  const hidden = status.links.length - shown.length

  return [`${heading(paint, 'Links')}  ${labels.join(paint.fg('dim', ' · '))}${hidden > 0 ? paint.fg('dim', ` · +${hidden} more`) : ''}`]
}

function decideSection(status: SessionStatus, paint: Paint): string[] {
  const asked = new Set(onEndList(status).map(d => d.id))
  const open = openToDecide(status)
  // The asked ones first, then the newest of the rest, as the mod orders them.
  const ordered = [...open.filter(d => asked.has(d.id)), ...open.filter(d => !asked.has(d.id)).reverse()]
  const shown = ordered.slice(0, LIMIT.decide)

  return shown.length === 0
    ? []
    : [
        heading(paint, 'Decide before settling'),
        ...shown.map(d => decisionLine(paint, d, asked.has(d.id) ? 'warning' : 'accent')),
        ...more(paint, ordered.length - shown.length),
      ]
}

function followUpSection(status: SessionStatus, paint: Paint): string[] {
  const open = openFollowUps(status).reverse()
  const shown = open.slice(0, LIMIT.followUp)

  return shown.length === 0
    ? []
    : [heading(paint, 'Follow-up after settling'), ...shown.map(d => decisionLine(paint, d, 'accent')), ...more(paint, open.length - shown.length)]
}

function surpriseLine(paint: Paint, surprise: Surprise): string {
  const mark = surprise.discussingAt === undefined ? '' : paint.fg('dim', ' (discussing)')
  const action = surprise.action === undefined ? '' : paint.fg('dim', ` · → ${surprise.action}`)

  return `  ${paint.fg('accent', surprise.id)} ${surprise.occurred}${mark}${action}`
}

function surprisesSection(status: SessionStatus, paint: Paint): string[] {
  const open = status.items.filter((item): item is Surprise => item.kind === 'surprise' && isOpen(item)).reverse()
  const shown = open.slice(0, LIMIT.surprises)

  return shown.length === 0
    ? []
    : [heading(paint, 'Surprises'), ...shown.map(s => surpriseLine(paint, s)), ...more(paint, open.length - shown.length)]
}
