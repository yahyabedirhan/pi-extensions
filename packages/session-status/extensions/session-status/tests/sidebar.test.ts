import { expect, test } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { StatusOverlayModel, overlayLines, keyName } from '../overlay'
import { StatusStore } from '../state'
import { runStatusCall } from '../tool'
import { plain } from '../view'

const effects = { ping: () => undefined, linked: () => undefined, ticketReported: () => undefined }

test.each([
  ['<', '<'], ['>', '>'],
  ['\u001b[1;2D', '>'], ['\u001b[1;2C', '<'], // xterm: arrows move the left edge
  ['\u001b[d', '>'], ['\u001b[c', '<'], // rxvt modified arrows
])('resize key %j maps to %s', (input, direction) => {
  expect(keyName(input)).toBe(direction)
})

test('unmodified left and right arrows are not resize keys', () => {
  expect(keyName('\u001b[D')).toBeNull()
  expect(keyName('\u001b[C')).toBeNull()
})

test('narrow sidebar wraps long entries and scrolls selection within terminal height', () => {
  const store = new StatusStore('s', null, () => undefined)
  for (let n = 0; n < 20; n++) runStatusCall(store, { action: 'record_decision', question: `Question ${n} with a long description and 界 characters`, options: ['Yes', 'No'], default: 'Yes', unblocks: 'Answer', urgency: 'blocked' }, n, effects)
  const model = new StatusOverlayModel(() => store.get(), () => undefined)
  for (let n = 0; n < 19; n++) model.press('down')
  for (const width of [12, 20, 40]) {
    const lines = overlayLines(model, plain, width, 8)
    expect(lines).toHaveLength(8)
    expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
    expect(lines.some(line => line.includes('▶ D20'))).toBe(true)
  }
})

test('choice returns to list without completing the panel', () => {
  const store = new StatusStore('s', null, () => undefined)
  runStatusCall(store, { action: 'record_surprise', occurred: 'Long text', changed: 'Something changed' }, 1, effects)
  const choices: unknown[] = []
  const model = new StatusOverlayModel(() => store.get(), choice => choices.push(choice))
  model.press('enter')
  model.press('1')
  expect(choices).toHaveLength(1)
  expect(model.current()).toBeNull()
  expect(model.selection()).toBe(0)
})

test('long final option starts near the viewport top and can be paged to its end', () => {
  const store = new StatusStore('s', null, () => undefined)
  runStatusCall(store, { action: 'record_decision', question: 'Ship?', options: ['Yes', `${'long option '.repeat(80)}END_OF_OPTION`], default: 'Yes', unblocks: 'Answer', urgency: 'blocked' }, 1, effects)
  const model = new StatusOverlayModel(() => store.get(), () => undefined)
  model.press('enter')
  model.press('down')
  const first = overlayLines(model, plain, 24, 8)
  expect(first.slice(1, 3).some(line => line.includes('▶ 2.'))).toBe(true)
  expect(first.slice(2, -1).some(line => line.includes('long option'))).toBe(true)
  const seen: string[] = []
  for (let n = 0; n < 30; n++) {
    model.press('pagedown')
    seen.push(...overlayLines(model, plain, 24, 8))
  }
  expect(seen.join('\n')).toContain('END_OF_OPTION')
  expect(model.selection()).toBe(1)
  expect(keyName('\u001b[5~')).toBe('pageup')
  expect(keyName('\u001b[6~')).toBe('pagedown')
})

test('passive summary with no actionable entries can page independently', () => {
  const store = new StatusStore('s', null, () => undefined)
  runStatusCall(store, { action: 'item', state: 'added', title: `${'passive summary '.repeat(80)}SUMMARY_END` }, 1, effects)
  const model = new StatusOverlayModel(() => store.get(), () => undefined)
  const initial = overlayLines(model, plain, 24, 8)
  const seen: string[] = []
  for (let n = 0; n < 40; n++) {
    model.press('pagedown')
    seen.push(...overlayLines(model, plain, 24, 8))
  }
  expect(seen.join('\n')).toContain('SUMMARY_END')
  for (let n = 0; n < 40; n++) { model.press('pageup'); overlayLines(model, plain, 24, 8) }
  expect(overlayLines(model, plain, 24, 8)).toEqual(initial)
})

test('live option shrink clamps selection to an existing choice', () => {
  const store = new StatusStore('s', null, () => undefined)
  runStatusCall(store, { action: 'record_decision', question: 'Ship?', options: ['A', 'B', 'C', 'D'], default: 'A', unblocks: 'Answer', urgency: 'blocked' }, 1, effects)
  const picked: unknown[] = []
  const model = new StatusOverlayModel(() => store.get(), choice => picked.push(choice))
  model.press('enter')
  for (let n = 0; n < 4; n++) model.press('down')
  runStatusCall(store, { action: 'update', kind: 'decision', id: 'D1', fields: { options: ['A'] } }, 2, effects)
  overlayLines(model, plain, 24, 8)
  expect(model.selection()).toBe(model.choices().length - 1)
  model.press('enter')
  expect(picked).toHaveLength(1)
})


test('selection scrolling ignores marker characters in status text', () => {
  const store = new StatusStore('s', null, () => undefined)
  for (let n = 0; n < 20; n++) runStatusCall(store, { action: 'record_decision', question: `▶ Question ${n}`, options: ['Yes', 'No'], default: 'Yes', unblocks: 'Answer', urgency: 'blocked' }, n, effects)
  const model = new StatusOverlayModel(() => store.get(), () => undefined)
  for (let n = 0; n < 19; n++) model.press('down')
  expect(overlayLines(model, plain, 24, 8).join('\n')).toContain('▶ D20')
})
