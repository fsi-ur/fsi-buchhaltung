import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { normalizeBigInt } from '~/server/utils/normalize'
import type { FinanceMemberOption } from '~/types/member'
import { internalError } from '~/server/utils/api/errors'

interface MemberOptionRow {
  id: number
  full_name: string
}

interface GetFinanceMemberOptionsSuccess {
  ok: true
  members: FinanceMemberOption[]
}

interface GetFinanceMemberOptionsError {
  ok: false
  error: string
}

type GetFinanceMemberOptionsResponse = GetFinanceMemberOptionsSuccess | GetFinanceMemberOptionsError

// Names only: finance roles (e.g. auditors) must see who submitted/checked/counted a record
// without members.view, which would expose all member data.
export default defineEventHandler(async (event): Promise<GetFinanceMemberOptionsResponse> => {
  const current = await requirePermission(event, ['reimbursements.view', 'cash_counts.view', 'bank_statements.view'])
  if (!current.ok) return current

  try {
    const rows = normalizeBigInt(await query<MemberOptionRow[]>(`
      SELECT
        m.id,
        TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS full_name
      FROM members m
      ORDER BY m.last_name ASC, m.first_name ASC
    `)) as MemberOptionRow[]

    return {
      ok: true,
      members: rows.map(row => ({
        id: Number(row.id),
        full_name: String(row.full_name),
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load members', err)
  }
})
