import { expect, test } from 'vitest'

import type { SessionStatus } from '../core/types'
import { recordDraft } from '../core/hooks/crud'
import { ENTRY_TYPE, StatusStore, restoreStatus } from '../state'

function storeWithSaves(sessionId = 's1', restored: SessionStatus | null = null) {
  const saves: SessionStatus[] = []
  const store = new StatusStore(sessionId, restored, status => saves.push(status), () => 1000)

  return { store, saves }
}

const surprise = { kind: 'surprise', occurred: 'CI runs Node 18', changed: 'The build fails on CI' } as const

test('a change is saved and the status keeps it', () => {
  const { store, saves } = storeWithSaves()
  store.change(status => recordDraft(status, surprise, 1).status)

  expect(store.get().items.map(item => item.id)).toEqual(['S1'])
  expect(saves).toHaveLength(1)
  expect(saves[0]?.sessionId).toBe('s1')
})

test('a change that changes nothing saves nothing', () => {
  const { store, saves } = storeWithSaves()
  store.change(status => status)

  expect(saves).toHaveLength(0)
  expect(store.hasStatus()).toBe(false)
})

test('save: false changes the status without an entry', () => {
  const { store, saves } = storeWithSaves()
  store.change(status => ({ ...status, activity: 'working' }), { save: false })

  expect(store.get().activity).toBe('working')
  expect(saves).toHaveLength(0)
})

test('the branch restores the last status it saved for the session', () => {
  const { store, saves } = storeWithSaves()
  store.change(status => recordDraft(status, surprise, 1).status)
  store.change(status => recordDraft(status, surprise, 2).status)
  const branch = [
    { type: 'message' },
    ...saves.map(data => ({ type: 'custom', customType: ENTRY_TYPE, data })),
    { type: 'custom', customType: 'other', data: {} },
  ]

  expect(restoreStatus(branch, 's1')?.items.map(item => item.id)).toEqual(['S1', 'S2'])
})

test('a fork starts empty: the saved status belongs to another session id', () => {
  const { store, saves } = storeWithSaves()
  store.change(status => recordDraft(status, surprise, 1).status)
  const branch = saves.map(data => ({ type: 'custom', customType: ENTRY_TYPE, data }))

  expect(restoreStatus(branch, 'fork-id')).toBeNull()
})

test('a branch with no saved status restores nothing', () => {
  expect(restoreStatus([{ type: 'message' }], 's1')).toBeNull()
})
