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
import { validateCostCentreSelection } from '~/server/utils/costCentres'
import { receiptRequiresFile, validateReceiptPayload } from '~/server/utils/receipts'
import { validateSphereSelection } from '~/server/utils/spheres'
import type { ReceiptPosition, ReceiptRow } from '~/types/receipt'
import { internalError } from '~/server/utils/api/errors'

interface UpdateReceiptSuccess {
  ok: true
}

interface UpdateReceiptError {
  ok: false
  error: string
}

type UpdateReceiptResponse = UpdateReceiptSuccess | UpdateReceiptError

export default defineEventHandler(async (event): Promise<UpdateReceiptResponse> => {
  const current = await requirePermission(event, 'receipts.edit')
  if (!current.ok) return current

  const receiptId = getNumericRouteParam(event)
  if (!receiptId) return { ok: false, error: 'Invalid receipt id' }

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Missing form data' }

  const receiptJson = multipart.getField('receipt')
  const removeExistingFile = multipart.getField('removeExistingFile') === 'true'

  if (!receiptJson) return { ok: false, error: 'Missing receipt' }

  const updated = JSON.parse(receiptJson)
  const validationError = validateReceiptPayload(updated)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows: ReceiptRow[] = await query(
        `SELECT * FROM receipts WHERE id = ? LIMIT 1`,
        [receiptId],
        conn
      )

      if (!existingRows.length) return { ok: false, error: 'No matching receipts in database' }
      const existingReceipt = existingRows[0]!
      const reimbursementLinks: Array<{ reimbursement_id: number }> = await query(
        `SELECT reimbursement_id FROM reimbursement_positions WHERE receipt_id = ? LIMIT 1`,
        [receiptId],
        conn,
      )
      const bankStatementLinks: Array<{ bank_statement_id: number }> = await query(
        `SELECT bank_statement_id FROM bank_statement_positions WHERE receipt_id = ? LIMIT 1`,
        [receiptId],
        conn,
      )
      const statusLocked = reimbursementLinks.length > 0 || bankStatementLinks.length > 0
      const existingAttachment = await getActiveFileAttachment('receipt', receiptId, conn)
      const hasExistingFile = Boolean(existingAttachment)
      const hasFileAfterSave = Boolean(multipart.file) || (hasExistingFile && !removeExistingFile)
      const targetStatus = statusLocked ? existingReceipt.status : updated.status

      if (statusLocked && !hasFileAfterSave) {
        return { ok: false, error: 'Receipts that are part of a reimbursement or bank statement must always have a file attached' }
      }
      if (receiptRequiresFile(targetStatus) && !hasFileAfterSave) {
        return { ok: false, error: 'A file is required for open or paid receipts' }
      }

      const fileError = validateUploadedFile(multipart.file)
      if (fileError && multipart.file) return { ok: false, error: fileError }

      await query(
        `UPDATE receipts SET
          company_id = ?,
          receipt_date = ?,
          receipt_number = ?,
          description = ?,
          status = ?
        WHERE id = ?`,
        [
          updated.company_id || null,
          updated.receipt_date,
          updated.receipt_number || null,
          updated.description || null,
          targetStatus,
          receiptId,
        ],
        conn
      )

      const existingPositions: ReceiptPosition[] = await query(
        `SELECT * FROM receipt_positions WHERE receipt_id = ?`,
        [receiptId],
        conn
      )

      const sphereValidationError = await validateSphereSelection(
        updated.positions.map((position: any) => ({
          itemId: position.id ? Number(position.id) : null,
          sphereId: Number(position.sphere),
        })),
        existingPositions.map(position => ({
          itemId: Number(position.id),
          sphereId: Number(position.sphere),
        })),
        conn,
      )
      if (sphereValidationError) return { ok: false, error: sphereValidationError }

      const costCentreValidationError = await validateCostCentreSelection(
        updated.positions.map((position: any) => ({
          itemId: position.id ? Number(position.id) : null,
          costCentreId: Number(position.cost_centre),
        })),
        existingPositions.map(position => ({
          itemId: Number(position.id),
          costCentreId: Number(position.cost_centre),
        })),
        conn,
      )
      if (costCentreValidationError) return { ok: false, error: costCentreValidationError }

      const existingMap = new Map(existingPositions.map(position => [position.id, position]))
      const incomingMap = new Map(
        updated.positions
          .filter((position: any) => position.id)
          .map((position: any) => [position.id, position])
      )

      for (const existingPosition of existingPositions) {
        if (!incomingMap.has(existingPosition.id)) {
          await query(`DELETE FROM receipt_positions WHERE id = ?`, [existingPosition.id], conn)
        }
      }

      for (const incoming of updated.positions) {
        if (!incoming.id) continue

        const existingPosition = existingMap.get(incoming.id)
        if (!existingPosition) continue

        await query(
          `UPDATE receipt_positions
          SET sphere = ?, cost_centre = ?, amount = ?, tax = ?
          WHERE id = ?`,
          [
            incoming.sphere,
            incoming.cost_centre,
            incoming.amount,
            incoming.tax ?? 19,
            incoming.id,
          ],
          conn
        )
      }

      for (const incoming of updated.positions) {
        if (incoming.id) continue

        await query(
          `INSERT INTO receipt_positions
          (receipt_id, sphere, cost_centre, amount, tax)
          VALUES (?, ?, ?, ?, ?)`,
          [
            receiptId,
            incoming.sphere,
            incoming.cost_centre,
            incoming.amount,
            incoming.tax ?? 19,
          ],
          conn
        )

      }

      if (removeExistingFile && existingAttachment) {
        await detachFileAttachment(existingAttachment.id, current.user.id, conn)
      }

      if (multipart.file) {
        await storeAndAttachUploadedFile(
          multipart.file,
          'receipts',
          'receipt',
          receiptId,
          current.user.id,
          conn,
        )
      }

      return { ok: true }
    })
  } catch (err) {
    return internalError('An error occured during the update of the receipt', err)
  }
})
