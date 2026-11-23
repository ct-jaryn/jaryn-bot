export interface CronSpec {
  minutes: number[]
  hours: number[]
  days: number[]
  months: number[]
  weekdays: number[]
}

/** Parse a 5-field cron expression (minute hour day-of-month month day-of-week). */
export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron must have 5 fields: ${expr}`)
  const [min, hour, dom, mon, dow] = [
    parseField(parts[0]!, 59),
    parseField(parts[1]!, 23),
    parseField(parts[2]!, 31),
    parseField(parts[3]!, 12),
    parseField(parts[4]!, 6),
  ]
  return { minutes: min, hours: hour, days: dom, months: mon, weekdays: dow }
}

function parseField(field: string, max: number): number[] {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw ? Number(stepRaw) : 1
    if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid cron step: ${part}`)
    let from: number
    let to: number
    if (range === '*') { from = 0; to = max }
    else if (range!.includes('-')) {
      const [a, b] = range!.split('-').map(Number)
      from = a!; to = b!
    } else { from = Number(range); to = from }
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`invalid cron field: ${part}`)
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function partsInTz(date: Date, tz: string): { minute: number; hour: number; day: number; month: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short',
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value
  return {
    minute: Number(p.minute), hour: Number(p.hour) % 24, day: Number(p.day), month: Number(p.month),
    weekday: WEEKDAYS[p.weekday ?? 'Sun'] ?? 0,
  }
}

export function nextCron(expr: string, tz: string, from = new Date()): Date {
  const spec = parseCron(expr)
  for (let i = 1; i <= 366 * 24 * 60; i++) {
    const candidate = new Date(from.getTime() + i * 60_000)
    candidate.setSeconds(0, 0)
    const p = partsInTz(candidate, tz)
    if (!spec.minutes.includes(p.minute)) continue
    if (!spec.hours.includes(p.hour)) continue
    if (!spec.days.includes(p.day)) continue
    if (!spec.months.includes(p.month)) continue
    if (!spec.weekdays.includes(p.weekday)) continue
    return candidate
  }
  throw new Error(`no cron occurrence within a year: ${expr}`)
}
