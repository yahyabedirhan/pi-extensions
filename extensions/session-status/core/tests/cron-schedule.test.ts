// The cron formatter: a 5-field expression as short readable text, or
// undefined when it cannot say it cleanly.

import { expect, test } from 'claude-code/testing'

import { formatCron } from '../hooks/cron-schedule'

test('a step of minutes or hours reads as an interval', () => {
  expect(formatCron('*/5 * * * *')).toBe('every 5m')
  expect(formatCron('* * * * *')).toBe('every minute')
  expect(formatCron('0 */2 * * *')).toBe('every 2h')
  expect(formatCron('15 */3 * * *')).toBe('every 3h at :15')
})

test('a fixed minute of every hour reads as hourly', () => {
  expect(formatCron('0 * * * *')).toBe('hourly')
  expect(formatCron('30 * * * *')).toBe('hourly at :30')
})

test('a fixed time of day reads as daily, weekdays, weekends or named days', () => {
  expect(formatCron('0 9 * * *')).toBe('daily 09:00')
  expect(formatCron('0 9 * * 1-5')).toBe('weekdays 09:00')
  expect(formatCron('30 10 * * 0,6')).toBe('weekends 10:30')
  expect(formatCron('30 10 * * 6,0')).toBe('weekends 10:30')
  expect(formatCron('0 8 * * 1')).toBe('Mondays 08:00')
  expect(formatCron('0 8 * * 7')).toBe('Sundays 08:00')
  expect(formatCron('0 8 * * 1,3,5')).toBe('Mon, Wed, Fri 08:00')
})

test('a day of the month reads as monthly, a pinned date as the date', () => {
  expect(formatCron('0 9 1 * *')).toBe('monthly on the 1st 09:00')
  expect(formatCron('0 9 22 * *')).toBe('monthly on the 22nd 09:00')
  expect(formatCron('7 3 25 12 *')).toBe('Dec 25 03:07')
  expect(formatCron('53 1 5 10 *')).toBe('Oct 5 01:53')
})

test('anything it cannot say cleanly is undefined', () => {
  for (const cron of [
    '',
    '0 9 * *',
    '0 9 * * * *',
    '0 9-17 * * *',
    '*/7 9-17 * * 1-5',
    '0 9 1 * 1',
    '0 9 * 1 *',
    '0 9 * * MON',
    '60 9 * * *',
    '0 24 * * *',
    '0 9 31 2 *',
    '0 9 * * 8',
    '*/0 * * * *',
    '1-5 * * * *',
  ]) {
    expect(formatCron(cron)).toBeUndefined()
  }
})
