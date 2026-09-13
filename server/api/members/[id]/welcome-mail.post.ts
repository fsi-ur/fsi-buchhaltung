import { defineEventHandler } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getMemberWelcomeStatus, sendMemberWelcomeNow, type MemberWelcomeStatus } from '~/server/utils/memberWelcome'

interface SendWelcomeMailSuccess {
  ok: true
  status: MemberWelcomeStatus
}

interface SendWelcomeMailError {
  ok: false
  error: string
}

export type SendMemberWelcomeMailResponse = SendWelcomeMailSuccess | SendWelcomeMailError

export default defineEventHandler(async (event): Promise<SendMemberWelcomeMailResponse> => {
  const current = await requirePermission(event, 'members.edit')
  if (!current.ok) return current

  const id = Number(event.context.params?.id)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Ungültige Mitglieds-ID.' }

  const result = await withAuditTransaction(current.user, async conn =>
    await sendMemberWelcomeNow({ memberId: id, createdByUserId: current.user.id }, conn))

  if (!result.ok) return result

  return { ok: true, status: await getMemberWelcomeStatus(id) }
})
