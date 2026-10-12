import { query, withAuditTransaction } from '~/server/utils/db'
import { applyMemberLeftStatusActions } from '~/server/utils/members'
import { appTodayLocalDate } from '~/server/utils/time'

interface DueMemberRow {
  id: number
  account: number | null
  first_name: string
  last_name: string
  left_at: string
}

async function findDueMembers() {
  const today = await appTodayLocalDate()
  return query<DueMemberRow[]>(
    `SELECT m.id, m.account, m.first_name, m.last_name, m.left_at
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
    await withAuditTransaction(null, async (conn) => {
      await applyMemberLeftStatusActions({
        memberId: member.id,
        accountId: member.account,
        leftAt: member.left_at,
        memberLabel: `${member.first_name} ${member.last_name}`.trim(),
        userId: 0,
        conn,
      })
    })
  }

  return dueMembers.length
}
