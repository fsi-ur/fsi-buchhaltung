import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { statusFromReimbursement, validateReimbursementBody } from '~/server/utils/reimbursements'
import { getEntityIdsWithActiveFiles, storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'

interface CreateReimbursementSuccess {
  ok: true
  reimbursementId: number
}

interface CreateReimbursementError {
  ok: false
  error: string
}

type CreateReimbursementResponse = CreateReimbursementSuccess | CreateReimbursementError

export default defineEventHandler(async (event): Promise<CreateReimbursementResponse> => {
  const current = await requirePermission(event, 'reimbursements.edit')
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Invalid form data' }

  const fileError = validateUploadedFile(multipart.file, 'A file is required for reimbursements')
  if (fileError) return { ok: false, error: fileError }

  const reimbursementJson = multipart.getField('reimbursement')
  if (!reimbursementJson) return { ok: false, error: 'Missing reimbursement data' }

  const reimbursement = JSON.parse(reimbursementJson)
  const validationError = validateReimbursementBody(reimbursement)
  if (validationError) return { ok: false, error: validationError }

  const submittedAt = reimbursement.submitted_at

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const receiptIds = reimbursement.positions
        .map((position: any) => Number(position.receipt_id))
        .filter((receiptId: number): receiptId is number => Boolean(receiptId))
      const uniqueReceiptIds = Array.from(new Set<number>(receiptIds))

      if (uniqueReceiptIds.length !== reimbursement.positions.length) {
        return { ok: false, error: 'A receipt can only be added once per reimbursement' }
      }

      if (!uniqueReceiptIds.length) {
        return { ok: false, error: 'At least one receipt is required' }
      }

      const conflicts: { receipt_id: number }[] = await query(
        `SELECT receipt_id
         FROM reimbursement_positions
         WHERE receipt_id IN (${uniqueReceiptIds.map(() => '?').join(',')})`,
        uniqueReceiptIds,
        conn
      )

      if (conflicts.length) {
        return { ok: false, error: 'At least one selected receipt is already part of another reimbursement' }
      }

      const bsConflicts: { receipt_id: number }[] = await query(
        `SELECT receipt_id
         FROM bank_statement_positions
         WHERE receipt_id IN (${uniqueReceiptIds.map(() => '?').join(',')})`,
        uniqueReceiptIds,
        conn
      )
      if (bsConflicts.length) {
        return { ok: false, error: 'At least one selected receipt is already part of a bank statement' }
      }

      const receiptIdsWithFiles = await getEntityIdsWithActiveFiles('receipt', uniqueReceiptIds, conn)
      if (receiptIdsWithFiles.size !== uniqueReceiptIds.length) {
        return { ok: false, error: 'Each receipt in a reimbursement must have a file attached' }
      }

      const reimbursementResult: any = await query(
        `INSERT INTO reimbursements
          (paid_by, bankname, account_holder, iban, bic, advance, cash, submitted_at, checked_at, checked_by, disbursed_at, disbursed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reimbursement.paid_by,
          reimbursement.bankname || null,
          reimbursement.account_holder || null,
          reimbursement.iban || null,
          reimbursement.bic || null,
          reimbursement.advance || 0,
          reimbursement.cash ? 1 : 0,
          submittedAt,
          reimbursement.checked_at || null,
          reimbursement.checked_by || null,
          reimbursement.disbursed_at || null,
          reimbursement.disbursed_by || null,
        ],
        conn
      )

      const reimbursementId = Number(reimbursementResult.insertId)

      for (const receiptId of uniqueReceiptIds) {
        await query(
          `INSERT INTO reimbursement_positions
            (reimbursement_id, receipt_id)
          VALUES (?, ?)`,
          [reimbursementId, receiptId],
          conn
        )
      }

      const targetStatus = statusFromReimbursement(reimbursement)
      await query(
        `UPDATE receipts
         SET status = ?
         WHERE id IN (${uniqueReceiptIds.map(() => '?').join(',')})`,
        [targetStatus, ...uniqueReceiptIds],
        conn
      )

      await storeAndAttachUploadedFile(
        multipart.file!,
        'reimbursements',
        'reimbursement',
        reimbursementId,
        current.user.id,
        conn,
      )

      return { ok: true, reimbursementId }
    })
  } catch (err: any) {
    return { ok: false, error: `Failed to create reimbursement: ${err}` }
  }
})
