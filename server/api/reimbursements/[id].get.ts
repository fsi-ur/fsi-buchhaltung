import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getAttachedFile, getEntityIdsWithActiveFiles } from '~/server/utils/files'
import type { Reimbursement, ReimbursementPosition, ReimbursementRow } from '~/types/reimbursement'
import { ReceiptStatus } from '~/types/receipt'
import type { FileRow } from '~/types/file'
import { internalError } from '~/server/utils/api/errors'

interface GetReimbursementSuccess {
  ok: true
  reimbursement: Reimbursement
  file: FileRow | null
}

interface GetReimbursementError {
  ok: false
  error: string
}

export type GetReimbursementResponse = GetReimbursementSuccess | GetReimbursementError

export default defineEventHandler(async (event): Promise<GetReimbursementResponse> => {
  const current = await requirePermission(event, 'reimbursements.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid reimbursement id' }

  try {
    const reimbursementRows: ReimbursementRow[] = await query(
      `
      SELECT
        r.id,
        r.paid_by,
        r.submitted_at,
        r.bankname,
        r.account_holder,
        r.iban,
        r.bic,
        r.advance,
        r.cash,
        r.checked_by,
        r.checked_at,
        r.disbursed_by,
        r.disbursed_at
      FROM reimbursements r
      WHERE r.id = ?
      LIMIT 1
      `,
      [id]
    )

    if (!reimbursementRows.length) {
      return { ok: false, error: 'Reimbursement not found' }
    }

    const reimbursement = normalizeBigInt(reimbursementRows[0])

    const rows = await query<any[]>(
      `
      SELECT
        rp.id AS reimbursement_position_id,
        rp.receipt_id,
        rec.receipt_date,
        rec.receipt_number,
        rec.description,
        rec.status,
        rec.company_id,
        c.name AS company_name,
        rpos.id AS receipt_position_id,
        rpos.sphere,
        rpos.cost_centre,
        rpos.amount,
        rpos.tax
      FROM reimbursement_positions rp
      JOIN receipts rec ON rec.id = rp.receipt_id
      LEFT JOIN companies c ON c.id = rec.company_id
      LEFT JOIN receipt_positions rpos ON rpos.receipt_id = rec.id
      WHERE reimbursement_id = ?
      ORDER BY rec.receipt_date DESC, rpos.id
      `,
      [id]
    )

    const receiptIds = [...new Set(rows.map(row => Number(row.receipt_id)).filter(Boolean))]
    const receiptIdsWithFiles = await getEntityIdsWithActiveFiles('receipt', receiptIds)

    const map = new Map<number, ReimbursementPosition>()

    for (const row of rows) {
      if (!map.has(Number(row.receipt_id))) {
        map.set(Number(row.receipt_id), {
          id: Number(row.reimbursement_position_id),
          receipt: {
            id: Number(row.receipt_id),
            receipt_date: String(row.receipt_date),
            receipt_number: row.receipt_number ?? null,
            description: row.description ?? null,
            status: row.status as ReceiptStatus,
            has_file: receiptIdsWithFiles.has(Number(row.receipt_id)),
            company_id: row.company_id != null ? Number(row.company_id) : null,
            company_name: row.company_name ?? null,
            positions: []
          }
        })
      }

      if (row.receipt_position_id) {
        map.get(Number(row.receipt_id))!.receipt.positions.push({
          id: Number(row.receipt_position_id),
          sphere: Number(row.sphere),
          cost_centre: Number(row.cost_centre),
          amount: Number(row.amount),
          tax: Number(row.tax)
        })
      }
    }

    const file = await getAttachedFile('reimbursement', id)

    return {
      ok: true,
      reimbursement: {
        id: Number(reimbursement.id),
        paid_by: Number(reimbursement.paid_by),
        submitted_at: String(reimbursement.submitted_at),
        bankname: reimbursement.bankname ?? null,
        account_holder: reimbursement.account_holder ?? null,
        iban: reimbursement.iban ?? null,
        bic: reimbursement.bic ?? null,
        advance: Number(reimbursement.advance ?? 0),
        cash: Boolean(reimbursement.cash),
        checked_by: reimbursement.checked_by != null ? Number(reimbursement.checked_by) : null,
        checked_at: reimbursement.checked_at ?? null,
        disbursed_by: reimbursement.disbursed_by != null ? Number(reimbursement.disbursed_by) : null,
        disbursed_at: reimbursement.disbursed_at ?? null,
        positions: Array.from(map.values())
      },
      file: file ?? null
    }
  } catch (err: any) {
    return internalError('An error occurred while fetching a reimbursement', err)
  }
})
