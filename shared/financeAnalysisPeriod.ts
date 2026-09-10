export type QuickSemester = '' | 'summer' | 'winter'

export interface PeriodShortcut {
  quickYear: string
  quickSemester: QuickSemester
  quickMonth: string
}

export function detectPeriodShortcut(startDate: string, endDate: string, allowedYears: number[]): PeriodShortcut {
  const none: PeriodShortcut = { quickYear: '', quickSemester: '', quickMonth: '' }
  if (!startDate || !endDate || startDate > endDate) return none

  const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
  if (!startYear || !startMonth || !endYear || !endMonth) return none

  if (startDay !== 1 || endDay !== new Date(endYear, endMonth, 0).getDate()) return none

  const isWinterSemester = startYear + 1 === endYear && startMonth === 10 && endMonth === 3
  if (!isWinterSemester && startYear !== endYear) return none

  if (!allowedYears.includes(startYear)) return none

  const quickYear = String(startYear)
  if (isWinterSemester) return { ...none, quickYear, quickSemester: 'winter' }
  if (startMonth === 4 && endMonth === 9) return { ...none, quickYear, quickSemester: 'summer' }
  if (startMonth === 1 && endMonth === 12) return { ...none, quickYear }
  if (startMonth === endMonth) return { ...none, quickYear, quickMonth: String(startMonth) }

  return none
}

export function currentSemesterPeriod(today = new Date()): { year: number, semester: Exclude<QuickSemester, ''> } {
  const year = today.getFullYear()
  const month = today.getMonth() + 1

  if (month >= 4 && month <= 9) return { year, semester: 'summer' }
  return { year: month >= 10 ? year : year - 1, semester: 'winter' }
}
