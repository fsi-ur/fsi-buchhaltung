import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getEntityIdsWithActiveFiles } from '~/server/utils/files'
import { ReceiptStatus, type ReceiptRow } from '~/types/receipt'
import { internalError } from '~/server/utils/api/errors'

interface GetReceiptsSuccess {
  ok: true
  receipts: ReceiptRow[]
}

interface GetReceiptsError {
  ok: false
  error: string
}

type GetReceiptsResponse = GetReceiptsSuccess | GetReceiptsError

export default defineEventHandler(async (event): Promise<GetReceiptsResponse> => {
  const current = await requirePermission(event, 'receipts.view')
  if (!current.ok) return current

  try {
    const receipts: any[] = await query(
      `
      SELECT
        r.id,
        r.receipt_date,
        r.receipt_number,
        r.status,
        c.name AS company_name,
        c.id AS company_id,
        r.description,
        IFNULL(SUM(rp.amount), 0) AS total_amount
      FROM receipts r
      LEFT JOIN companies c ON c.id = r.company_id
      LEFT JOIN receipt_positions rp ON rp.receipt_id = r.id
      GROUP BY r.id
      ORDER BY r.receipt_date DESC, r.id DESC
      `
    )

    const receiptIds = receipts.map(receipt => Number(receipt.id))
    const receiptIdsWithFiles = await getEntityIdsWithActiveFiles('receipt', receiptIds)

    return { ok: true, receipts: receipts.map(receipt => ({
      id: Number(receipt.id),
      receipt_date: String(receipt.receipt_date),
      receipt_number: receipt.receipt_number ? String(receipt.receipt_number) : null,
      company_name: receipt.company_name ? String(receipt.company_name) : null,
      company_id: Number(receipt.company_id),
      status: receipt.status as ReceiptStatus,
      description: receipt.description ? String(receipt.description) : null,
      has_file: receiptIdsWithFiles.has(Number(receipt.id)),
      total_amount: Number(receipt.total_amount),
    }))}
  } catch (err: any) {
    return internalError('Failed to load receipts', err)
  }
})
