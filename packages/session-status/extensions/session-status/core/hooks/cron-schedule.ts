// A cron expression as short readable text for the narrow pane. CronCreate
// answers no readable form, so the mod writes its own. Nothing here calls `$`.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The most days each month has, February in a leap year. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

/**
 * A 5-field cron expression (`M H DoM Mon DoW`) as short text: `every 5m`,
 * `every 2h`, `hourly`, `daily 09:00`, `weekdays 09:00`, `Mondays 08:00`,
 * `monthly on the 1st 09:00`, `Dec 25 03:07`. Undefined for anything it
 * cannot say cleanly; the caller shows the expression itself.
 */
export function formatCron(cron: string): string | undefined {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) {
    return undefined
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  const anyDate = dom === '*' && month === '*' && dow === '*'

  // Intervals: every N minutes, every N hours.
  if (anyDate && hour === '*') {
    if (minute === '*') {
      return 'every minute'
    }
    const step = stepOf(minute, 59)
    if (step !== undefined) {
      return `every ${step}m`
    }
    const at = number(minute, 0, 59)
    if (at !== undefined) {
      return at === 0 ? 'hourly' : `hourly at :${pad(at)}`
    }

    return undefined
  }
  const m = number(minute, 0, 59)
  if (m === undefined) {
    return undefined
  }
  if (anyDate) {
    const step = stepOf(hour, 23)
    if (step !== undefined) {
      return m === 0 ? `every ${step}h` : `every ${step}h at :${pad(m)}`
    }
  }

  // A time of day, on some days.
  const h = number(hour, 0, 23)
  if (h === undefined) {
    return undefined
  }
  const time = `${pad(h)}:${pad(m)}`
  if (anyDate) {
    return `daily ${time}`
  }
  if (dom === '*' && month === '*') {
    const days = weekdays(dow)

    return days === undefined ? undefined : `${days} ${time}`
  }
  if (dow !== '*') {
    return undefined
  }
  const day = number(dom, 1, 31)
  if (day === undefined) {
    return undefined
  }
  if (month === '*') {
    return `monthly on the ${ordinal(day)} ${time}`
  }
  const mon = number(month, 1, 12)
  if (mon === undefined || day > (MONTH_DAYS[mon - 1] ?? 0)) {
    return undefined
  }

  return `${MONTHS[mon - 1]} ${day} ${time}`
}

/** The days of the week field as words: `weekdays`, `weekends`, `Mondays`, `Mon, Wed, Fri`. */
function weekdays(field: string): string | undefined {
  if (field === '1-5') {
    return 'weekdays'
  }
  const days = field.split(',').map(part => number(part, 0, 7))
  if (days.some(day => day === undefined)) {
    return undefined
  }
  const unique = [...new Set(days.map(day => (day as number) % 7))].sort((a, b) => a - b)
  if (unique.length === 2 && unique[0] === 0 && unique[1] === 6) {
    return 'weekends'
  }
  if (unique.length === 1) {
    return DAY_NAMES[unique[0] as number]
  }

  return unique.map(day => DAYS[day]).join(', ')
}

/** N from `*\/N`, when N is 1 to max. */
function stepOf(field: string, max: number): number | undefined {
  const match = /^\*\/(\d+)$/.exec(field)

  return match === null ? undefined : number(match[1] ?? '', 1, max)
}

/** A plain number field from min to max. */
function number(field: string, min: number, max: number): number | undefined {
  if (!/^\d+$/.test(field)) {
    return undefined
  }
  const value = Number(field)

  return value >= min && value <= max ? value : undefined
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th')

  return `${day}${suffix}`
}
