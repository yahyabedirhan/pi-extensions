import { expect, test } from 'vitest'

import { StatusStore } from '../state'
import { runStatusCall } from '../tool'
import { bandText, widgetLines } from '../view'

const effects = { ping: () => undefined, linked: () => undefined, ticketReported: () => undefined }

function storeWith(...calls: Record<string, unknown>[]) {
  const store = new StatusStore('s1', null, () => undefined)
  calls.forEach((call, index) => runStatusCall(store, call, index + 1, effects))

  return store
}

test('an empty status shows no widget', () => {
  expect(widgetLines(storeWith().get())).toEqual([])
})

test('the widget shows each section the status has, in the pane order', () => {
  const store = storeWith(
    { action: 'record_decision', question: 'Ship it?', options: ['Yes', 'No'], default: 'Yes', unblocks: 'Say yes.', urgency: 'blocked' },
    { action: 'record_blocker', failed: 'Tests cannot run', needs: 'Install Node 22' },
    { action: 'item', state: 'added', title: 'Write the tests' },
    { action: 'link', url: 'https://github.com/octo/widgets/pull/12' },
    { action: 'record_decision', question: 'Rename it?', options: ['Yes', 'No'], default: 'No', unblocks: 'Say yes.', urgency: 'before_settling' },
    { action: 'record_surprise', occurred: 'CI runs Node 18', changed: 'CI fails', suggested_action: 'Pin Node 22' },
  )

  expect(widgetLines(store.get())).toEqual([
    '● Blocked · alt+s to answer',
    'Blocked on you',
    '  D1 Ship it? · default: Yes',
    'You should know',
    '  B1 Tests cannot run · needs: Install Node 22',
    'Session  Progress 0/1 ░░░░░░░░░░░░',
    '  ○ I1 Write the tests',
    'Links  ⇄ widgets#12',
    'Decide before settling',
    '  D2 Rename it? · default: No',
    'Surprises',
    '  S1 CI runs Node 18 · → Pin Node 22',
  ])
})

test('the band counts what the widget shows', () => {
  const store = storeWith(
    { action: 'record_decision', question: 'Ship it?', options: ['Yes', 'No'], default: 'Yes', unblocks: 'Say yes.', urgency: 'blocked' },
    { action: 'item', state: 'added', title: 'a' },
    { action: 'item', state: 'done', id: 'I1' },
    { action: 'record_surprise', occurred: 'x', changed: 'y' },
  )

  expect(bandText(store.get())).toBe('1 blocked · 0 decide · progress 1/1 · 1 surprise')
})

test('a long list ends in +N more', () => {
  const store = storeWith(...['a', 'b', 'c', 'd'].map(title => ({ action: 'item', state: 'added', title })))

  expect(widgetLines(store.get()).at(-1)).toBe('  +2 more')
})
