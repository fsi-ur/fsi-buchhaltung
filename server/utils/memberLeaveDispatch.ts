import { query, withAuditTransaction } from '~/server/utils/db'
import { applyMemberLeftStatusActions } from '~/server/utils/members'
import { withLastAdminGuard } from '~/server/utils/permissions'
import { appTodayLocalDate } from '~/server/utils/time'

interface DueMemberRow {
  id: number
  account: number | null
  first_name: string
  last_name: string
  left_at: string
  account_deactivation_skipped: number
}

async function findDueMembers() {
  const today = await appTodayLocalDate()
  return query<DueMemberRow[]>(
    `SELECT m.id, m.account, m.first_name, m.last_name, m.left_at, m.account_deactivation_skipped
     FROM members m
     WHERE m.status = 'left'
       AND m.left_at < ?
       AND (
         (m.account IS NOT NULL AND EXISTS (
           SELECT 1 FROM users u WHERE u.id = m.account AND u.is_active = 1
         ))
         OR EXISTS (SELECT 1 FROM subdivision_members sm WHERE sm.member_id = m.id)
         OR EXISTS (
           SELECT 1 FROM member_positions mp
           WHERE mp.member_id = m.id
             AND mp.since <= m.left_at
             AND (mp.until IS NULL OR mp.until > m.left_at)
         )
         OR EXISTS (
           SELECT 1 FROM member_positions mp
           WHERE mp.member_id = m.id
             AND mp.since > m.left_at
         )
       )`,
    [today],
  )
}

export async function runMemberLeaveDispatch() {
  const dueMembers = await findDueMembers()

  for (const member of dueMembers) {
    const result = await withAuditTransaction(null, withLastAdminGuard(async (conn) => {
      await applyMemberLeftStatusActions({
        memberId: member.id,
        accountId: member.account,
        leftAt: member.left_at,
        memberLabel: `${member.first_name} ${member.last_name}`.trim(),
        userId: 0,
        // The editor who set "left" was not allowed to deactivate this account (SEC-19).
        deactivateAccount: !Number(member.account_deactivation_skipped),
        conn,
      })
      return { ok: true as const }
    }))
    if (!result.ok) console.warn(`member-leave: member ${member.id} skipped — ${result.error}`)
  }

  return dueMembers.length
}
