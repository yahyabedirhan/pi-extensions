import { expect, test } from 'vitest'
import { StatusStore } from '../state'
import { sidebarRows } from '../sidebar'
import { openEntries } from '../replies'
import { plain } from '../view'
import type { Decision, Surprise } from '../core/types'

const empty = () => new StatusStore('session-1', null, () => undefined).get()
const decision = (id: string, urgency: Decision['urgency']): Decision => ({ kind: 'decision', id, urgency, question: `Question ${id}`, options: ['Yes', 'No'], default: 'Yes', unblocks: 'Answer', recordedAt: 1 })
const surprise = (id: string, source?: 'observer'): Surprise => ({ kind: 'surprise', id, source, occurred: `Finding ${id}`, changed: 'Plan changed', action: 'Check', recordedAt: 1 })

test('empty status still shows its Session id without a title or duplicate entries section', () => {
  expect(sidebarRows(empty(), plain)).toEqual([{ text: 'Now' }, { text: 'Nothing yet.' }, { text: '' }, { text: 'Session' }, { text: 'ID       session-1' }, { text: '' }, { text: 'No update yet.' }])
})

test('metadata lines align and shorten paths; Now overrides stored activity', () => {
  const status = empty()
  status.place = { branch: 'fallback', root: '/workspace/old/repo', repo: null }
  status.doingNow = { tool: 'read', text: 'old', at: 1 }
  status.sessionItems = [{ id: 'I1', title: 'Write', state: 'added', addedAt: 1, at: 1 }]
  const text = sidebarRows(status, plain, { branch: 'feature', cwd: '/workspace/worktrees/project', now: { tool: 'bash', text: 'tests' } }).map(r => r.text)
  expect(text).toEqual(['Now', 'bash: tests', '', 'Session', 'ID       session-1', 'Branch   feature', 'Worktree worktrees/project', 'Progress 0/1 ░░░░░░░░░░░░', '○ I1 Write', '', 'No update yet.'])
  expect(sidebarRows(status, plain).map(r => r.text)).toContain('Branch   fallback')
})

test('sections retain source order with blank gaps and every actionable entry exactly once', () => {
  const status = empty()
  status.items = [decision('D1', 'blocked'), { kind: 'blocker', id: 'B1', failed: 'Failed', needs: 'Help', recordedAt: 1 },
    ...Array.from({ length: 8 }, (_, i) => decision(`D${i + 2}`, 'before_settling')),
    decision('D10', 'after_settling'), ...Array.from({ length: 5 }, (_, i) => surprise(`S${i + 1}`)), surprise('S6', 'observer')]
  status.links = [{ kind: 'pr', repo: 'octo/project', number: 1, url: 'https://github.com/octo/project/pull/1', at: 1 }]
  const rows = sidebarRows(status, plain)
  const blocks = rows.map(r => r.text).join('\n').split('\n\n')
  expect(blocks.map(b => b.split('\n')[0])).toEqual(['● Blocked', 'Now', 'Blocked on you (1)', 'You should know (1)', 'Session', 'Links', 'Decide before settling (8)', 'Follow-up after settling (1)', 'Surprises (5)', 'Observations (1)', 'No update yet.'])
  const ids = rows.flatMap(r => r.entryId ? [r.entryId] : [])
  expect(ids).toHaveLength(status.items.length)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids).toEqual(openEntries(status).map(entry => entry.id))
  expect(blocks[8]).not.toContain('S6')
  expect(blocks[9]).toContain('S6 · Finding S6')
  expect(rows.some(r => /Session status|Open entries/.test(r.text))).toBe(false)
  expect(rows.find(r => r.text.includes('Default:'))?.entryId).toBeUndefined()
})

test('links have an independent heading, newest five marks, and their own more row', () => {
  const status = empty()
  status.links = Array.from({ length: 7 }, (_, i) => ({ kind: i === 6 ? 'pr' as const : 'issue' as const, state: i === 6 ? 'closed' as const : 'open' as const, repo: 'octo/project', number: i + 1, url: `https://github.com/octo/project/issues/${i + 1}`, at: i }))
  const text = sidebarRows(status, plain).map(r => r.text)
  expect(text.slice(6, -2)).toEqual(['Links', '⇄ project#7 · ◎ project#6 · ◎ project#5 · ◎ project#4 · ◎ project#3', '  +2 more'])
})

test('expanded lists reveal older links and remaining session items', () => {
  const status = empty()
  status.sessionItems = Array.from({ length: 5 }, (_, i) => ({ id: `I${i + 1}`, title: `Work ${i + 1}`, state: 'added' as const, addedAt: 1, at: 1 }))
  status.links = Array.from({ length: 7 }, (_, i) => ({ kind: 'issue' as const, repo: 'octo/project', number: i + 1, url: `https://github.com/octo/project/issues/${i + 1}`, at: i }))
  const compact = sidebarRows(status, plain).map(row => row.text).join('\n')
  const expanded = sidebarRows(status, plain, { expandedLists: true }).map(row => row.text).join('\n')
  expect(compact).not.toContain('I5 Work 5')
  expect(compact).not.toContain('project#1')
  expect(expanded).toContain('I5 Work 5')
  expect(expanded).toContain('project#1')
  expect(expanded).not.toContain(' more')
})

test('posted decisions and observations use the same visual and keyboard order', () => {
  const status = empty()
  status.items = [decision('D1', 'before_settling'), decision('D2', 'before_settling'), decision('D3', 'before_settling'), surprise('S1', 'observer'), surprise('S2')]
  status.endListPostedAt = 5
  status.items[0] = { ...status.items[0], recordedAt: 6 } as Decision
  const ids = sidebarRows(status, plain).flatMap(row => row.entryId ? [row.entryId] : [])
  expect(ids).toEqual(openEntries(status).map(entry => entry.id))
  expect(ids.slice(-2)).toEqual(['S2', 'S1'])
})

test('answered history and last update use an explicit clock without timers', () => {
  const status = empty()
  status.items = [{ ...decision('D1', 'blocked'), resolvedAt: 2 }, { ...surprise('S1'), resolvedAt: 2 }]
  const timestamp = new Date(2025, 0, 1, 12, 30, 15).getTime()
  status.updatedAt = timestamp
  expect(sidebarRows(status, plain, {}, timestamp + 90_000).map(r => r.text).slice(-3)).toEqual(['Answered (2)', '', 'Last update 12:30:15 · 1m 30s ago'])
})

test('wide text stays intact for the parent wrapper and progress lists are limited', () => {
  const status = empty()
  status.items = [{ ...decision('D1', 'before_settling'), question: '世界'.repeat(100) }]
  status.sessionItems = Array.from({ length: 4 }, (_, i) => ({ id: `I${i + 1}`, title: 'Work', state: 'added' as const, addedAt: 1, at: 1 }))
  const rows = sidebarRows(status, plain)
  expect(rows.find(r => r.entryId === 'D1')?.text).toContain('世界'.repeat(100))
  expect(rows.map(r => r.text)).toContain('  +2 more')
})
