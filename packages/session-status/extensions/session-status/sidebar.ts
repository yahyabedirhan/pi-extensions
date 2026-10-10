// Pane layout follows yahyabedirhan/claude-mods at ec4fd502ec244ad09ec49273e30a16b070189d05.
import type { Blocker, Decision, SessionStatus, Surprise } from './core/types'
import { HEADLINE_TEXT, headline } from './core/hooks/activity'
import type { Headline } from './core/hooks/activity'
import { effortProgress, effortTickets } from './core/hooks/effort-progress'
import { linkLabel } from './core/hooks/links'
import { listedItems } from './core/hooks/session-items'
import { sessionProgress } from './core/hooks/session-progress'
import { ticketShortName } from './core/hooks/ticket-reports'
import { isOpen, onEndList } from './core/hooks/status'
import { openEntries } from './replies'
import type { Paint, Tone } from './view'

export type SidebarMetadata = { branch?: string; cwd?: string; now?: { tool: string; text: string }; expandedLists?: boolean }
export type SidebarRow = { text: string; entryId?: string }

const tones: Record<Headline, Tone> = { blocked: 'warning', working: 'success', settling: 'success', waiting: 'accent', settled: 'dim' }
const bar = (done: number, total: number) => {
  const filled = total === 0 ? 0 : Math.max(0, Math.min(12, Math.round(done / total * 12)))
  return '█'.repeat(filled) + '░'.repeat(12 - filled)
}

/** Unwrapped rows: only the first row of an actionable entry owns its selection id. */
export function sidebarRows(status: SessionStatus, paint: Paint, metadata: SidebarMetadata = {}, now = Date.now()): SidebarRow[] {
  const blocks: SidebarRow[][] = []
  const entries = openEntries(status)
  const row = (text: string): SidebarRow => ({ text })
  const section = (title: string, rows: SidebarRow[]) => {
    if (rows.length) blocks.push([row(paint.bold(title)), ...rows])
  }
  const detail = (text: string) => row(paint.fg('dim', `  ${text}`))
  const more = (count: number) => !metadata.expandedLists && count > 0 ? [detail(`+${count} more`)] : []
  const decision = (d: Decision, tone: Tone): SidebarRow[] => [
    { text: `${paint.fg(tone, d.id)}${d.discussingAt === undefined ? '' : paint.fg('dim', ' (discussing)')} · ${d.question}`, entryId: d.id },
    ...(d.urgency === 'blocked' ? [detail(`Unblocks: ${d.unblocks}`)] : []),
    detail(`${d.urgency === 'blocked' ? 'Recommended' : 'Default'}: ${d.default}`),
  ]
  const surprise = (s: Surprise): SidebarRow[] => [
    { text: `${paint.fg('accent', s.id)}${s.discussingAt === undefined ? '' : paint.fg('dim', ' (discussing)')} · ${s.occurred}`, entryId: s.id },
    detail(`Changed: ${s.changed}`),
    ...(s.action === undefined ? [] : [detail(`Action: ${s.action}`)]),
  ]
  const state = headline(status)
  if (state !== null) blocks.push([row(paint.bold(paint.fg(tones[state], `● ${HEADLINE_TEXT[state]}`)))])
  const doing = metadata.now ?? status.doingNow
  section('Now', [row(doing ? (doing.text === '' ? doing.tool : `${doing.tool}: ${doing.text}`) : paint.fg('dim', 'Nothing yet.'))])
  const blocked = entries.filter((i): i is Decision => i.kind === 'decision' && i.urgency === 'blocked')
  section(`Blocked on you (${blocked.length})`, blocked.flatMap(d => decision(d, 'warning')))
  const blockers = entries.filter((i): i is Blocker => i.kind === 'blocker')
  section(`You should know (${blockers.length})`, blockers.flatMap(b => [
    { text: `${paint.fg('warning', b.id)} · ${b.failed}`, entryId: b.id }, detail(`To unblock: ${b.needs}`),
  ]))
  const label = (name: string, value: string) => row(`${paint.fg('dim', name.padEnd(9))}${value}`)
  const session = [label('ID', status.sessionId)]
  const branch = metadata.branch ?? status.place?.branch
  const cwd = metadata.cwd ?? status.place?.root
  if (branch) session.push(label('Branch', branch))
  if (cwd) session.push(label('Worktree', cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/')))
  const progress = sessionProgress(status)
  if (progress && progress.total > 0) {
    session.push(label('Progress', `${progress.done}/${progress.total} ${bar(progress.done, progress.total)}`))
    const items = listedItems(status)
    session.push(...items.slice(0, metadata.expandedLists ? undefined : 2).map(i => row(`${paint.fg('dim', i.state === 'done' ? '✓' : '○')} ${paint.fg('accent', i.id)} ${i.title}`)), ...more(items.length - 2))
  }
  if (progress && progress.building.length > 0) {
    session.push(row(`Building: ${paint.fg('accent', progress.building.slice(0, metadata.expandedLists ? undefined : 4).map(ticketShortName).join(', '))}`), ...more(progress.building.length - 4))
  }
  section('Session', session)
  if (status.effort) {
    const effort = effortProgress(status)
    const tickets = effortTickets(status)
    section(`Effort  ${status.effort.name}`, [
      ...(effort ? [label('Closed', `${effort.closed}/${effort.total} ${bar(effort.closed, effort.total)}`)] : []),
      ...tickets.slice(0, metadata.expandedLists ? undefined : 2).map(t => row(`${paint.fg('dim', t.isClosed ? '✓' : '○')} #${t.number} ${t.title}`)), ...more(tickets.length - 2),
    ])
  }
  const links = status.links.slice(metadata.expandedLists ? 0 : -5).reverse().map(link => {
      const state = link.state ?? 'open'
      const mark = link.kind === 'pr' ? paint.fg(state === 'open' ? 'success' : state === 'merged' ? 'accent' : 'error', '⇄')
        : paint.fg(state === 'open' ? 'success' : 'accent', state === 'open' ? '◎' : '⊙')
      return `${mark} ${paint.link(linkLabel(link), link.url)}`
    })
  section('Links', links.length === 0 ? [] : [row(links.join(paint.fg('dim', ' · '))), ...more(status.links.length - 5)])
  const asked = new Set(onEndList(status).map(d => d.id))
  const ordered = entries.filter((i): i is Decision => i.kind === 'decision' && i.urgency === 'before_settling')
  section(`Decide before settling (${ordered.length})`, ordered.flatMap(d => decision(d, asked.has(d.id) ? 'warning' : 'accent')))
  const follow = entries.filter((i): i is Decision => i.kind === 'decision' && i.urgency === 'after_settling')
  section(`Follow-up after settling (${follow.length})`, follow.flatMap(d => decision(d, 'accent')))
  const surprises = entries.filter((i): i is Surprise => i.kind === 'surprise')
  for (const observer of [false, true]) {
    const entries = surprises.filter(s => (s.source === 'observer') === observer)
    section(`${observer ? 'Observations' : 'Surprises'} (${entries.length})`, entries.flatMap(surprise))
  }
  const answered = status.items.filter(i => !isOpen(i)).length
  if (answered) blocks.push([row(paint.fg('dim', `Answered (${answered})`))])
  if (status.updatedAt === null) {
    blocks.push([row(paint.fg('dim', 'No update yet.'))])
  } else {
    const date = new Date(status.updatedAt)
    const clock = [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
    blocks.push([row(paint.fg('dim', `Last update ${clock} · ${age(now - status.updatedAt)}`))])
  }
  return blocks.flatMap((block, index) => index === 0 ? block : [row(''), ...block])
}

function age(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 10) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ''} ago`
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''} ago`
}
