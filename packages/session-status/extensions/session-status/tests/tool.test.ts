import { expect, test } from 'vitest'

import { StatusStore } from '../state'
import { TOOL_DESCRIPTION, TOOL_NAME, runStatusCall } from '../tool'
import type { StatusEffects } from '../tool'

function setUp() {
  const pings: string[][] = []
  let linked = 0
  let tickets = 0
  const effects: StatusEffects = {
    ping: argv => pings.push(argv),
    linked: () => (linked += 1),
    ticketReported: () => (tickets += 1),
  }
  const store = new StatusStore('abcdef12-session', null, () => undefined)
  const call = (params: Record<string, unknown>) => runStatusCall(store, params, 1000, effects)

  return { store, call, pings, counts: () => ({ linked, tickets }) }
}

const blocked = {
  action: 'record_decision',
  question: 'Use SQLite or Postgres?',
  options: ['SQLite', 'Postgres'],
  default: 'SQLite',
  unblocks: 'Pick one database.',
  urgency: 'blocked',
}

test('the tool keeps the short name and speaks of Pi', () => {
  expect(TOOL_NAME).toBe('status')
  expect(TOOL_DESCRIPTION).toContain('restart Pi')
  expect(TOOL_DESCRIPTION).not.toContain('Claude Code')
})

test('a blocked decision gets D1, the same reply as the mod, and a ping', () => {
  const { call, pings } = setUp()

  expect(call(blocked)).toEqual({ text: 'Recorded decision D1 (blocked on the user).', isError: false })
  expect(pings[0]?.slice(0, 3)).toEqual(['shipyard', 'ping', 'Use SQLite or Postgres?'])
})

test('resolve closes the decision and withdraws its ping', () => {
  const { call, pings, store } = setUp()
  call(blocked)

  expect(call({ action: 'resolve', id: 'd1' }).text).toBe('Resolved decision D1. It is in the answered history now.')
  expect(pings[1]).toEqual(['shipyard', 'ping', 'withdraw', 'ss-abcdef12-d1'])
  expect(store.get().items[0]?.resolvedAt).toBe(1000)
})

test('a second resolve is refused with the reason', () => {
  const { call } = setUp()
  call(blocked)
  call({ action: 'resolve', id: 'D1' })

  expect(call({ action: 'resolve', id: 'D1' })).toEqual({ text: 'Decision D1 is already resolved.', isError: true })
})

test('items count toward the session progress', () => {
  const { call } = setUp()

  expect(call({ action: 'item', state: 'added', title: 'Write the tests' }).text).toBe('Added item I1 Write the tests. Session: 0/1 done.')
  expect(call({ action: 'item', state: 'done', id: 'I1' }).text).toBe('Item I1 Write the tests is done. Session: 1/1 done.')
})

test('an agentId from the model does not make the call a subagent call', () => {
  const { call } = setUp()

  expect(call({ action: 'item', state: 'added', title: 'x', agentId: 'sub' }).isError).toBe(false)
})

test('a surprise and a blocker get their own ids', () => {
  const { call } = setUp()

  expect(call({ action: 'record_surprise', occurred: 'CI runs Node 18', changed: 'CI fails', suggested_action: 'Pin Node 22' }).text).toBe('Recorded surprise S1.')
  expect(call({ action: 'record_blocker', failed: 'The tests cannot run', needs: 'Install Node 22' }).text).toBe('Recorded blocker B1. The user was pinged.')
})

test('link adds a pull request and asks for a state read', () => {
  const { call, store, counts } = setUp()

  expect(call({ action: 'link', url: 'https://github.com/octo/widgets/pull/12' }).isError).toBe(false)
  expect(store.get().links.map(link => link.url)).toEqual(['https://github.com/octo/widgets/pull/12'])
  expect(counts().linked).toBe(1)
})

test('a ticket report names the effort and asks for a count', () => {
  const { call, store, counts } = setUp()
  call({ action: 'ticket', number: 4, title: 'Effort progress', state: 'started', effort: 'effort:video-review' })

  expect(store.get().effort?.name).toBe('video-review')
  expect(counts().tickets).toBe(1)
})

test('list names the open ids', () => {
  const { call } = setUp()
  call(blocked)

  expect(call({ action: 'list' }).text).toContain('D1')
})

test('reset clears the record', () => {
  const { call, store } = setUp()
  call(blocked)
  call({ action: 'reset' })

  expect(store.get().items).toEqual([])
})

test('an unknown action is refused with the allowed ones', () => {
  const { call } = setUp()
  const reply = call({ action: 'nope' })

  expect(reply.isError).toBe(true)
  expect(reply.text).toContain('record_decision')
})
