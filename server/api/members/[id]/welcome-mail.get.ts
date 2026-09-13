import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getMemberWelcomeStatus, welcomeTypeForStatus, type MemberWelcomeStatus } from '~/server/utils/memberWelcome'
import { getNotificationSettings, isTypeEnabled } from '~/server/utils/notifications/settings'
import { query } from '~/server/utils/db'

interface GetWelcomeMailSuccess {
  ok: true
  status: MemberWelcomeStatus
  canSend: boolean
  blockedReason: string | null
}

interface GetWelcomeMailError {
  ok: false
  error: string
}

export type GetMemberWelcomeMailResponse = GetWelcomeMailSuccess | GetWelcomeMailError

export default defineEventHandler(async (event): Promise<GetMemberWelcomeMailResponse> => {
  const current = await requirePermission(event, 'members.edit', { touch: false })
  if (!current.ok) return current

  const id = Number(event.context.params?.id)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Ungültige Mitglieds-ID.' }

  const [member] = await query<Array<{ status: string, email: string }>>(
    `SELECT status, email FROM members WHERE id = ? LIMIT 1`,
    [id],
  )
  if (!member) return { ok: false, error: 'Mitglied wurde nicht gefunden.' }

  const status = await getMemberWelcomeStatus(id)
  const settings = await getNotificationSettings()
  const type = welcomeTypeForStatus(member.status)

  let blockedReason: string | null = null
  if (status.alreadySent) blockedReason = 'Die Willkommensmail wurde bereits versendet.'
  else if (!type) blockedReason = 'Für diesen Status gibt es keine Willkommensmail.'
  else if (!member.email?.trim()) blockedReason = 'Das Mitglied hat keine E-Mail-Adresse hinterlegt.'
  else if (!settings.notifications_enabled) blockedReason = 'Benachrichtigungen sind vereinsweit deaktiviert.'
  else if (!isTypeEnabled(settings, type)) blockedReason = 'Diese Willkommensmail ist in den Einstellungen deaktiviert.'
  else if (!process.env.SMTP_HOST) blockedReason = 'Es ist kein SMTP-Server konfiguriert.'

  return { ok: true, status, canSend: blockedReason === null, blockedReason }
})
