import { parseJsonField } from '~/server/utils/api/request'
import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import {
  BANK_POSITION_COLUMNS,
  bankPositionValues,
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

  const parsedJson = parseJsonField(bankStatementJson)

  if (!parsedJson.ok) return parsedJson

  const body = normalizeBankStatementBody(parsedJson.value)
  const validationError = validateBankStatementBody(body)
  if (validationError) return { ok: false, error: validationError }

  const fileError = validateUploadedFile(multipart.file, 'A file is required for bank statements')
  if (fileError) return { ok: false, error: fileError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const relationError = await validateBankStatementRelations(body, conn)
      if (relationError) return { ok: false, error: relationError }

      const result: any = await query(
        `INSERT INTO bank_statements (account_id, statement_number, checked_by, statement_date) VALUES (?, ?, ?, ?)`,
        [body.account_id, body.statement_number, body.checked_by, body.statement_date],
        conn,
      )

      const bankStatementId = Number(result.insertId)

      for (const position of body.positions) {
        await query(
          `INSERT INTO bank_statement_positions
            (bank_statement_id, ${BANK_POSITION_COLUMNS.join(', ')})
           VALUES (?, ${BANK_POSITION_COLUMNS.map(() => '?').join(', ')})`,
          [bankStatementId, ...bankPositionValues(position)],
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
