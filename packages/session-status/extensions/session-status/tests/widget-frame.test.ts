import { expect, test } from 'vitest'
import { hyperlink, visibleWidth } from '@earendil-works/pi-tui'
import { plain, widgetFrame } from '../view'

test('compact widget has a labelled rounded border and one-cell padding', () => {
  const lines = widgetFrame(['● In progress', 'Session 1/3'], 32)
  expect(lines[0]).toContain('╭─ Session status ')
  expect(lines.at(-1)).toBe(`╰${'─'.repeat(30)}╯`)
  expect(lines).toHaveLength(6)
  expect(lines[1]).toBe(`│${' '.repeat(30)}│`)
  expect(lines.at(-2)).toBe(lines[1])
  expect(lines[2]).toContain('│ ● In progress')
  expect(lines.every(line => visibleWidth(line) === 32)).toBe(true)
})

test.each([0, 1, 2, 3, 4, 12, 19, 20, 64])('widget frame fits a terminal width of %s', width => {
  const lines = widgetFrame(['A long line with 界 characters and a long description'], width)
  expect(lines.every(line => visibleWidth(line) <= width)).toBe(true)
})

test('empty status produces no frame', () => {
  expect(widgetFrame([], 64)).toEqual([])
})

test('frame measures styled content and preserves terminal links', () => {
  const link = hyperlink('repo#6', 'https://github.com/example/repo/pull/6')
  const paint = { ...plain, fg: (_tone: unknown, text: string) => `\u001b[90m${text}\u001b[0m` }
  const lines = widgetFrame([`\u001b[32mIn progress\u001b[0m ${link}`], 64, paint)
  expect(lines[2]).toContain(link)
  expect(lines.every(line => visibleWidth(line) === 64)).toBe(true)
  expect(lines[0]).toContain('\u001b[90m')
})
