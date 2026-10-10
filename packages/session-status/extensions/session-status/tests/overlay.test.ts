import { expect, test } from 'vitest'

import { StatusOverlayModel, overlayLines } from '../overlay'
import type { Choice } from '../replies'
import { StatusStore } from '../state'
import { runStatusCall } from '../tool'
import { plain } from '../view'

const effects = { ping: () => undefined, linked: () => undefined, ticketReported: () => undefined }

function setUp() {
  const store = new StatusStore('s1', null, () => undefined)
  runStatusCall(store, { action: 'record_decision', question: 'Ship it?', options: ['Yes', 'No'], default: 'Yes', unblocks: 'Say yes.', urgency: 'blocked' }, 1, effects)
  runStatusCall(store, { action: 'record_surprise', occurred: 'CI runs Node 18', changed: 'CI fails' }, 2, effects)
  const results: (Choice | undefined)[] = []
  const model = new StatusOverlayModel(() => store.get(), choice => results.push(choice))

  return { model, results }
}

test('Enter opens the entry, a digit picks its choice', () => {
  const { model, results } = setUp()
  model.press('enter')
  model.press('2')

  expect(results).toEqual([expect.objectContaining({ kind: 'option', option: 'No' })])
})

test('arrows move to the next entry and Enter picks the selected choice', () => {
  const { model, results } = setUp()
  model.press('down')
  model.press('enter')
  model.press('down')
  model.press('enter')

  expect(results[0]).toMatchObject({ kind: 'discuss' })
})

test('Esc goes back from the choices, then closes with nothing', () => {
  const { model, results } = setUp()
  model.press('enter')
  model.press('escape')

  expect(model.current()).toBeNull()
  model.press('escape')
  expect(results).toEqual([undefined])
})

test('the overlay draws the entries in a frame of the given width', () => {
  const { model } = setUp()
  const lines = overlayLines(model, plain, 60)

  expect(lines[0]).toMatch(/^╭─+╮$/)
  expect(lines.some(line => line.includes('▶ D1 · Ship it?'))).toBe(true)
  expect(lines.every(line => line.length === 60)).toBe(true)
})
