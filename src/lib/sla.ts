export const TIER_DAYS = { simple: 3, complex: 7, technical: 20 } as const
export type Tier = keyof typeof TIER_DAYS

const MANILA_OFFSET_MS = 8 * 3600 * 1000

export function manilaDate(sqlUtc?: string | null) {
  const d = sqlUtc ? new Date(sqlUtc.replace(' ', 'T') + 'Z') : new Date()
  return new Date(d.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10)
}

const next = (day: string) => {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export const isWorkingDay = (day: string, holidays: Set<string>) => {
  const w = new Date(day + 'T00:00:00Z').getUTCDay()
  return w !== 0 && w !== 6 && !holidays.has(day)
}

export function workingDaysBetween(start: string, end: string, holidays: Set<string>) {
  let n = 0
  for (let d = next(start); d <= end; d = next(d)) if (isWorkingDay(d, holidays)) n++
  return n
}

export function addWorkingDays(start: string, days: number, holidays: Set<string>) {
  let d = start
  let n = 0
  while (n < days) {
    d = next(d)
    if (isWorkingDay(d, holidays)) n++
  }
  return d
}

export function slaState(createdUtc: string, tier: Tier, holidays: Set<string>, endUtc?: string | null) {
  const today = endUtc ? manilaDate(endUtc) : manilaDate()
  const elapsed = workingDaysBetween(manilaDate(createdUtc), today, holidays)
  const ceiling = TIER_DAYS[tier]
  return { elapsed, ceiling, remaining: ceiling - elapsed, overdue: elapsed > ceiling, due: addWorkingDays(manilaDate(createdUtc), ceiling, holidays) }
}
