import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

interface ReceiptAssignment {
  receipt_id: number
  reimbursement_id: number
}

interface GetAssignmentsSuccess {
  ok: true
  assignments: ReceiptAssignment[]
}

interface GetAssignmentsError {
  ok: false
  error: string
}

type GetAssignmentsResponse = GetAssignmentsSuccess | GetAssignmentsError

export default defineEventHandler(async (event): Promise<GetAssignmentsResponse> => {
  const current = await requirePermission(event, 'reimbursements.view')
  if (!current.ok) return current

  try {
    const rows: any[] = await query(
      `
      SELECT receipt_id, reimbursement_id
      FROM reimbursement_positions
      `
    )

    return {
      ok: true,
      assignments: rows.map(row => ({
        receipt_id: Number(row.receipt_id),
        reimbursement_id: Number(row.reimbursement_id),
      }))
    }
  } catch (err: any) {
    return internalError('Failed to load reimbursement receipt assignments', err)
  }
})
