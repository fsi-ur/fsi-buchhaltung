import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getAttachedFile, getEntityIdsWithActiveFiles } from '~/server/utils/files'
import type { Receipt, ReceiptPosition, ReceiptRow } from '~/types/receipt'
import type { FileRow } from '~/types/file'
import { internalError } from '~/server/utils/api/errors'

interface GetReceiptSuccess {
  ok: true
  receipt: Receipt
  file: FileRow | null
  statusLocked: boolean
  reimbursementId: number | null
  bankStatementId: number | null
}

interface GetReceiptError {
  ok: false
  error: string
}

export type GetReceiptResponse = GetReceiptSuccess | GetReceiptError

export default defineEventHandler(async (event): Promise<GetReceiptResponse> => {
  const current = await requirePermission(event, 'receipts.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) {
    return { ok: false, error: 'Invalid receipt id' }
  }

  try {
    const receiptRows: ReceiptRow[] = await query(
      `
      SELECT
        r.id,
        c.id AS company_id,
        c.name AS company_name,
        r.receipt_date,
        r.receipt_number,
        r.description,
        r.status
      FROM receipts r
      LEFT JOIN companies c ON c.id = r.company_id
      WHERE r.id = ?
      LIMIT 1
      `,
      [id]
    )

    if (!receiptRows.length) {
      return { ok: false, error: 'Receipt not found' }
    }

    const receipt = normalizeBigInt(receiptRows[0])

    const positions: ReceiptPosition[] = await query(
      `
      SELECT id, sphere, cost_centre, amount, tax
      FROM receipt_positions
      WHERE receipt_id = ?
      `,
      [id]
    )

    const reimbursementLinks: Array<{ reimbursement_id: number }> = await query(
      `
      SELECT reimbursement_id
      FROM reimbursement_positions
      WHERE receipt_id = ?
      LIMIT 1
      `,
      [id]
    )

    const bankStatementLinks: Array<{ bank_statement_id: number }> = await query(
      `SELECT bank_statement_id FROM bank_statement_positions WHERE receipt_id = ? LIMIT 1`,
      [id]
    )

    const file = await getAttachedFile('receipt', id)
    const receiptIdsWithFiles = await getEntityIdsWithActiveFiles('receipt', [id])

    return {
      ok: true,
      receipt: normalizeBigInt({
        id: Number(receipt.id),
        receipt_date: receipt.receipt_date,
        receipt_number: receipt.receipt_number,
        company_id: Number(receipt.company_id),
        company_name: receipt.company_name,
        status: receipt.status,
        has_file: receiptIdsWithFiles.has(id),
        positions: normalizeBigInt(positions) as ReceiptPosition[],
      }),
      file: file ? normalizeBigInt(file) : null,
      statusLocked: reimbursementLinks.length > 0 || bankStatementLinks.length > 0,
      reimbursementId: reimbursementLinks[0] ? Number(reimbursementLinks[0].reimbursement_id) : null,
      bankStatementId: bankStatementLinks[0] ? Number(bankStatementLinks[0].bank_statement_id) : null,
    }
  } catch (err: any) {
    return internalError('An error occurred while fetching a receipt', err)
  }
})
