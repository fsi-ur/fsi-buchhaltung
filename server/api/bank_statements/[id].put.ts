import { lockError } from '~/server/utils/recordLocks'
import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam, readMultipart } from '~/server/utils/api/request'
import {
  detachFileAttachment,
  getActiveFileAttachment,
  storeAndAttachUploadedFile,
  validateUploadedFile,
} from '~/server/utils/files'
import {
  normalizeBankStatementBody,
  validateBankStatementBody,
  validateBankStatementRelations,
  restoreUnlinkedRecordStatuses,
} from '~/server/utils/bankStatements'
import { ReceiptStatus } from '~/types/receipt'
import { InvoiceStatus } from '~/types/invoice'
import type { BankStatementPositionRow } from '~/types/bankStatement'
import { internalError } from '~/server/utils/api/errors'

interface UpdateBankStatementSuccess {
  ok: true
}

interface UpdateBankStatementError {
  ok: false
  error: string
}

type UpdateBankStatementResponse = UpdateBankStatementSuccess | UpdateBankStatementError

export default defineEventHandler(async (event): Promise<UpdateBankStatementResponse> => {
  const current = await requirePermission(event, 'bank_statements.edit')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid bank statement id' }

  // Saved statements are locked (SEC-22); answer that before any payload validation.
  const earlyLock = lockError(true, current.user.permissions, 'bank_statements.unlock')
  if (earlyLock) return { ok: false, error: earlyLock }

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Missing form data' }

  const bankStatementJson = multipart.getField('bankStatement')
  const removeExistingFile = multipart.getField('removeExistingFile') === 'true'

  if (!bankStatementJson) return { ok: false, error: 'Missing bank statement data' }

  const body = normalizeBankStatementBody(JSON.parse(bankStatementJson))
  const validationError = validateBankStatementBody(body)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows = await query(
        `SELECT id FROM bank_statements WHERE id = ? LIMIT 1`,
        [id],
        conn,
      )
      if (!existingRows.length) return { ok: false, error: 'Bank statement not found' }
      const locked = lockError(true, current.user.permissions, 'bank_statements.unlock')
      if (locked) return { ok: false, error: locked }

      const relationError = await validateBankStatementRelations(body, conn, id)
      if (relationError) return { ok: false, error: relationError }

      await query(
        `UPDATE bank_statements SET statement_number = ?, checked_by = ?, statement_date = ? WHERE id = ?`,
        [body.statement_number, body.checked_by, body.statement_date, id],
        conn,
      )

      const existingPositions: BankStatementPositionRow[] = await query(
        `SELECT * FROM bank_statement_positions WHERE bank_statement_id = ? ORDER BY id ASC`,
        [id],
        conn,
      )

      const existingMap = new Map(existingPositions.map(p => [Number(p.id), p]))
      const incomingWithId = new Set(
        body.positions.filter(p => p.id).map(p => Number(p.id))
      )

      // Collect removed receipt/invoice ids to restore their status
      const removedReceiptIds: number[] = []
      const removedInvoiceIds: number[] = []
      for (const existing of existingPositions) {
        if (!incomingWithId.has(Number(existing.id))) {
          await query(`DELETE FROM bank_statement_positions WHERE id = ?`, [existing.id], conn)
          if (existing.receipt_id) removedReceiptIds.push(Number(existing.receipt_id))
          if (existing.invoice_id) removedInvoiceIds.push(Number(existing.invoice_id))
        }
      }

      for (const position of body.positions) {
        if (!position.id) continue
        if (!existingMap.has(Number(position.id))) continue

        await query(
          `UPDATE bank_statement_positions
           SET position_type = ?, position_date = ?, receipt_id = ?, invoice_id = ?, event_id = ?, amount = ?, notes = ?
           WHERE id = ?`,
          [
            position.position_type,
            position.position_date,
            position.receipt_id,
            position.invoice_id,
            position.event_id,
            position.amount,
            position.notes,
            position.id,
          ],
          conn,
        )
      }

      for (const position of body.positions) {
        if (position.id) continue

        await query(
          `INSERT INTO bank_statement_positions
            (bank_statement_id, position_type, position_date, receipt_id, invoice_id, event_id, amount, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
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

      // Removed receipts/invoices: back to 'open' unless another payment record still covers them.
      await restoreUnlinkedRecordStatuses(id, removedReceiptIds, removedInvoiceIds, conn)

      // Apply status to all current receipts
      const receiptIds = body.positions.filter(p => p.position_type === 'receipt' && p.receipt_id).map(p => p.receipt_id!)
      if (receiptIds.length) {
        await query(
          `UPDATE receipts SET status = ? WHERE id IN (${receiptIds.map(() => '?').join(',')})`,
          [ReceiptStatus.Paid, ...receiptIds],
          conn,
        )
      }

      // Apply status and paid_at to all current invoices
      const invoicePositions = body.positions.filter(p => p.position_type === 'invoice' && p.invoice_id)
      for (const p of invoicePositions) {
        await query(
          `UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?`,
          [InvoiceStatus.Paid, p.position_date, p.invoice_id],
          conn,
        )
      }

      const existingAttachment = await getActiveFileAttachment('bank_statement', id, conn)
      const hasExistingFile = Boolean(existingAttachment)
      const hasFileAfterSave = Boolean(multipart.file) || (hasExistingFile && !removeExistingFile)
      if (!hasFileAfterSave) {
        return { ok: false, error: 'A file is required for bank statements' }
      }

      const fileError = validateUploadedFile(multipart.file)
      if (fileError && multipart.file) return { ok: false, error: fileError }

      if (removeExistingFile && existingAttachment) {
        await detachFileAttachment(existingAttachment.id, current.user.id, conn)
      }

      if (multipart.file) {
        await storeAndAttachUploadedFile(
          multipart.file,
          'bank_statements',
          'bank_statement',
          id,
          current.user.id,
          conn,
        )
      }

      return { ok: true }
    })
  } catch (err: any) {
    return internalError('Failed to update bank statement', err)
  }
})
