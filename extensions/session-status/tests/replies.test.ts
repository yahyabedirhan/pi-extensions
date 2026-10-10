import { expect, test } from 'vitest'

import type { Decision, Surprise } from '../core/types'
import { applyChoice, choicesFor, openEntries } from '../replies'
import { StatusStore } from '../state'
import { runStatusCall } from '../tool'

function setUp() {
  const pings: string[][] = []
  const effects = { ping: (argv: string[]) => pings.push(argv), linked: () => undefined, ticketReported: () => undefined }
  const store = new StatusStore('abcdef12', null, () => undefined)
  runStatusCall(store, { action: 'record_decision', question: 'Ship it?', options: ['Yes', 'No'], default: 'Yes', unblocks: 'Say yes or no.', urgency: 'blocked' }, 1, effects)
  runStatusCall(store, { action: 'record_surprise', occurred: 'CI runs Node 18', changed: 'CI fails', suggested_action: 'Pin Node 22' }, 2, effects)
  const decision = store.get().items[0] as Decision
  const surprise = store.get().items[1] as Surprise

  return { store, pings, effects, decision, surprise }
}

test('the overlay lists blocked decisions before surprises', () => {
  const { store } = setUp()

  expect(openEntries(store.get()).map(entry => entry.id)).toEqual(['D1', 'S1'])
})

test('a decision offers each option, the default marked, and Discuss', () => {
  const { decision } = setUp()

  expect(choicesFor(decision).map(choice => choice.label)).toEqual(['Yes ✓', 'No', 'Discuss'])
})

test('a surprise offers its action, File issue, Discuss and Dismiss', () => {
  const { surprise } = setUp()

  expect(choicesFor(surprise).map(choice => choice.label)).toEqual(['Pin Node 22', 'File issue', 'Discuss', 'Dismiss'])
})

test('an option resolves the decision, withdraws its ping and sends "D1: <option>"', () => {
  const { store, effects, pings, decision } = setUp()
  const prompt = applyChoice(store, { kind: 'option', decision, option: 'No' }, 5, effects)

  expect(prompt).toBe('D1: No')
  expect(store.get().items[0]?.resolvedAt).toBe(5)
  expect(pings.at(-1)).toEqual(['shipyard', 'ping', 'withdraw', 'ss-abcdef12-d1'])
})

test('a second answer sends nothing', () => {
  const { store, effects, decision } = setUp()
  applyChoice(store, { kind: 'option', decision, option: 'No' }, 5, effects)

  expect(applyChoice(store, { kind: 'option', decision, option: 'Yes' }, 6, effects)).toBeNull()
})

test('Discuss keeps the decision open, marked, and asks to discuss it', () => {
  const { store, effects, decision } = setUp()

  expect(applyChoice(store, { kind: 'discuss', item: decision }, 5, effects)).toBe("Let's discuss D1: Ship it?")
  expect(store.get().items[0]).toMatchObject({ discussingAt: 5 })
  expect(store.get().items[0]?.resolvedAt).toBeUndefined()
})

test('the surprise action dismisses it as acted on and sends "S1: <action>"', () => {
  const { store, effects, surprise } = setUp()

  expect(applyChoice(store, { kind: 'act', surprise, action: 'Pin Node 22' }, 5, effects)).toBe('S1: Pin Node 22')
  expect(store.get().items[1]).toMatchObject({ resolvedAt: 5, actedAt: 5 })
})

test('File issue sends the issue prompt', () => {
  const { store, effects, surprise } = setUp()

  expect(applyChoice(store, { kind: 'file-issue', surprise }, 5, effects)).toBe('File an issue for S1: CI runs Node 18')
})

test('Dismiss closes the surprise and sends nothing', () => {
  const { store, effects, surprise } = setUp()

  expect(applyChoice(store, { kind: 'dismiss', surprise }, 5, effects)).toBeNull()
  expect(store.get().items[1]).toMatchObject({ resolvedAt: 5 })
  expect(store.get().items[1]).not.toHaveProperty('actedAt')
})
