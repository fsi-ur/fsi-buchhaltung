import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import { MemberStatus, type MemberBirthday, type MemberSpotlightStats } from '~/types/member'
import { parseMemberStatus } from '~/server/utils/members'
import { appTodayLocalDate } from '~/server/utils/time'
import { addDaysToLocalDate, diffLocalDates, isLocalDate, type LocalDate } from '~/shared/time'

const BIRTHDAY_HORIZON_DAYS = 60
const MAX_BIRTHDAYS = 4

interface GetMemberSpotlightSuccess {
  ok: true
  stats: MemberSpotlightStats
  birthdays: MemberBirthday[]
  horizonDays: number
  canViewUsers: boolean
}

interface GetMemberSpotlightError {
  ok: false
  error: string
}

export type GetMemberSpotlightResponse = GetMemberSpotlightSuccess | GetMemberSpotlightError

function nextBirthday(birthdate: string, today: LocalDate) {
  const birth = String(birthdate ?? '').slice(0, 10)
  if (!isLocalDate(birth)) return null

  const [birthYear, birthMonth, birthDay] = birth.split('-').map(Number) as [number, number, number]
  const todayYear = Number(today.slice(0, 4))
  const onYear = (year: number) => addDaysToLocalDate(`${year}-${String(birthMonth).padStart(2, '0')}-01`, birthDay - 1)

  let next = onYear(todayYear)
  if (next < today) next = onYear(todayYear + 1)

  return { daysUntil: diffLocalDates(today, next), turningAge: Number(next.slice(0, 4)) - birthYear }
}

export default defineEventHandler(async (event): Promise<GetMemberSpotlightResponse> => {
  const current = await requirePermission(event, 'members.view')
  if (!current.ok) return current

  const canViewUsers = hasPermission(current.user, ['users.view', 'users.manage'])

  try {
    const rows: any[] = await query(
      `
      SELECT
        m.id,
        m.first_name,
        m.last_name,
        m.birthdate,
        m.status,
        m.honorary,
        s.name AS subject_name,
        ${canViewUsers ? 'CASE WHEN m.account IS NULL THEN 0 ELSE 1 END' : '0'} AS has_account,
        ${canViewUsers ? 'u.is_active' : 'NULL'} AS account_is_active
      FROM members m
      LEFT JOIN subjects s ON s.id = m.subject
      LEFT JOIN users u ON u.id = m.account
      ORDER BY m.last_name ASC, m.first_name ASC
      `
    )

    const counts = { active: 0, passive: 0, hold: 0, left: 0, honorary: 0, activeAccounts: 0, inactiveAccounts: 0 }
    const today = await appTodayLocalDate()
    const birthdays: MemberBirthday[] = []

    for (const row of rows) {
      const status = parseMemberStatus(String(row.status))
      if (status === MemberStatus.Active) counts.active++
      else if (status === MemberStatus.Passive) counts.passive++
      else if (status === MemberStatus.Hold) counts.hold++
      else if (status === MemberStatus.Left) counts.left++

      if (Boolean(row.honorary)) counts.honorary++
      if (Boolean(row.has_account)) {
        if (Boolean(row.account_is_active)) counts.activeAccounts++
        else counts.inactiveAccounts++
      }

      // Birthdays are only relevant for members who are still part of the club.
      if (status === MemberStatus.Left) continue

      const birthday = nextBirthday(String(row.birthdate), today)
      if (!birthday || birthday.daysUntil > BIRTHDAY_HORIZON_DAYS) continue

      birthdays.push({
        id: Number(row.id),
        first_name: String(row.first_name),
        last_name: String(row.last_name),
        full_name: `${row.first_name} ${row.last_name}`,
        birthdate: String(row.birthdate),
        subject_name: row.subject_name ? String(row.subject_name) : null,
        status,
        days_until: birthday.daysUntil,
        turning_age: birthday.turningAge,
      })
    }

    birthdays.sort((left, right) => {
      return left.days_until - right.days_until
        || left.last_name.localeCompare(right.last_name, undefined, { sensitivity: 'base' })
    })

    const stats: MemberSpotlightStats = {
      total: rows.length,
      active: counts.active,
      passive: counts.passive,
      hold: counts.hold,
      left: counts.left,
      honorary: counts.honorary,
      active_accounts: canViewUsers ? counts.activeAccounts : null,
      inactive_accounts: canViewUsers ? counts.inactiveAccounts : null,
    }

    return {
      ok: true,
      stats,
      birthdays: birthdays.slice(0, MAX_BIRTHDAYS),
      horizonDays: BIRTHDAY_HORIZON_DAYS,
      canViewUsers,
    }
  } catch (err: any) {
    return { ok: false, error: `Failed to load member spotlight: ${err}` }
  }
})
