import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import {
  normalizeBankStatementBody,
  validateBankStatementBody,
  validateBankStatementRelations,
} from '~/server/utils/bankStatements'
import { ReceiptStatus } from '~/types/receipt'
import { InvoiceStatus } from '~/types/invoice'
import { internalError } from '~/server/utils/api/errors'

interface CreateBankStatementSuccess {
  ok: true
  bankStatementId: number
}

interface CreateBankStatementError {
  ok: false
  error: string
}

type CreateBankStatementResponse = CreateBankStatementSuccess | CreateBankStatementError

export default defineEventHandler(async (event): Promise<CreateBankStatementResponse> => {
  const current = await requirePermission(event, 'bank_statements.edit')
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Invalid form data' }

  const bankStatementJson = multipart.getField('bankStatement')
  if (!bankStatementJson) return { ok: false, error: 'Missing bank statement data' }

  const body = normalizeBankStatementBody(JSON.parse(bankStatementJson))
  const validationError = validateBankStatementBody(body)
  if (validationError) return { ok: false, error: validationError }

  const fileError = validateUploadedFile(multipart.file, 'A file is required for bank statements')
  if (fileError) return { ok: false, error: fileError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const relationError = await validateBankStatementRelations(body, conn)
      if (relationError) return { ok: false, error: relationError }

      const result: any = await query(
        `INSERT INTO bank_statements (statement_number, checked_by, statement_date) VALUES (?, ?, ?)`,
        [body.statement_number, body.checked_by, body.statement_date],
        conn,
      )

      const bankStatementId = Number(result.insertId)

      for (const position of body.positions) {
        await query(
          `INSERT INTO bank_statement_positions
            (bank_statement_id, position_type, position_date, receipt_id, invoice_id, event_id, amount, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bankStatementId,
            position.position_type,
            position.position_date,
            position.receipt_id,
            position.invoice_id,
            position.event_id,
            position.amount,
            position.notes,
          ],
          conn,
        )
      }

      // Set connected receipts to paid
      const receiptIds = body.positions.filter(p => p.position_type === 'receipt' && p.receipt_id).map(p => p.receipt_id!)
      if (receiptIds.length) {
        await query(
          `UPDATE receipts SET status = ? WHERE id IN (${receiptIds.map(() => '?').join(',')})`,
          [ReceiptStatus.Paid, ...receiptIds],
          conn,
        )
      }

      // Set connected invoices to paid with the position date
      const invoicePositions = body.positions.filter(p => p.position_type === 'invoice' && p.invoice_id)
      for (const p of invoicePositions) {
        await query(
          `UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?`,
          [InvoiceStatus.Paid, p.position_date, p.invoice_id],
          conn,
        )
      }

      await storeAndAttachUploadedFile(
        multipart.file!,
        'bank_statements',
        'bank_statement',
        bankStatementId,
        current.user.id,
        conn,
      )

      return { ok: true, bankStatementId }
    })
  } catch (err: any) {
    return internalError('Failed to create bank statement', err)
  }
})
