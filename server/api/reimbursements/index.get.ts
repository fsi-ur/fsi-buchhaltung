import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import type { ReimbursementOverview } from '~/types/reimbursement'
import { internalError } from '~/server/utils/api/errors'

interface GetReimbursementsSuccess {
  ok: true
  reimbursements: ReimbursementOverview[]
}

interface GetReimbursementsError {
  ok: false
  error: string
}

type GetReimbursementResponse = GetReimbursementsSuccess | GetReimbursementsError

export default defineEventHandler(async (event): Promise<GetReimbursementResponse> => {
  const current = await requirePermission(event, 'reimbursements.view')
  if (!current.ok) return current

  try {
    const rows: ReimbursementOverview[] = await query(
      `
      SELECT
        r.id,
        r.paid_by,
        CONCAT(m.first_name, ' ', m.last_name) AS member_name,
        r.submitted_at,
        r.checked_at,
        r.disbursed_at,
        COUNT(DISTINCT rp.receipt_id) AS receipt_count,
        IFNULL(SUM(pos.amount), 0) AS total_amount,
        r.cash,
        EXISTS (SELECT 1 FROM bank_statement_positions bsp WHERE bsp.reimbursement_id = r.id) AS bank_confirmed
      FROM reimbursements r
      LEFT JOIN members m ON m.id = r.paid_by
      LEFT JOIN reimbursement_positions rp ON rp.reimbursement_id = r.id
      LEFT JOIN receipts rec ON rec.id = rp.receipt_id
      LEFT JOIN receipt_positions pos ON pos.receipt_id = rec.id
      GROUP BY r.id
      ORDER BY r.submitted_at DESC, r.id DESC
      `
    )

    return { ok: true, reimbursements: rows.map(row => ({
      id: Number(row.id),
      paid_by: Number(row.paid_by),
      member_name: String(row.member_name),
      submitted_at: String(row.submitted_at),
      checked_at: row.checked_at ? String(row.checked_at) : null,
      disbursed_at: row.disbursed_at ? String(row.disbursed_at) : null,
      receipt_count: Number(row.receipt_count),
      total_amount: Number(row.total_amount),
      bank_confirmed: !Number((row as any).cash) && row.disbursed_at ? Boolean(Number((row as any).bank_confirmed)) : null,
    }))}
  } catch (err: any) {
    return internalError('Failed to load receipts', err)
  }
})
