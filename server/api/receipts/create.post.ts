import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { validateCostCentreSelection } from '~/server/utils/costCentres'
import { receiptRequiresFile, validateReceiptPayload } from '~/server/utils/receipts'
import { storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import { validateSphereSelection } from '~/server/utils/spheres'
import { internalError } from '~/server/utils/api/errors'

interface CreateReceiptSuccess {
  ok: true
  receiptId: number
}

interface CreateReceiptError {
  ok: false
  error: string
}

type CreateReceiptResponse = CreateReceiptSuccess | CreateReceiptError

export default defineEventHandler(async (event): Promise<CreateReceiptResponse> => {
  const current = await requirePermission(event, 'receipts.edit')
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Invalid form data' }

  const receiptJson = multipart.getField('receipt')
  if (!receiptJson) return { ok: false, error: 'Missing receipt data' }

  const receipt = JSON.parse(receiptJson)
  const validationError = validateReceiptPayload(receipt)
  if (validationError) return { ok: false, error: validationError }

  const fileError = validateUploadedFile(
    multipart.file,
    receiptRequiresFile(receipt.status) ? 'A file is required for open or paid receipts' : undefined,
  )
  if (fileError && (multipart.file || receiptRequiresFile(receipt.status))) {
    return { ok: false, error: fileError }
  }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const sphereValidationError = await validateSphereSelection(
        receipt.positions.map((position: any) => ({
          sphereId: Number(position.sphere),
        })),
        [],
        conn,
      )
      if (sphereValidationError) return { ok: false, error: sphereValidationError }

      const costCentreValidationError = await validateCostCentreSelection(
        receipt.positions.map((position: any) => ({
          costCentreId: Number(position.cost_centre),
        })),
        [],
        conn,
      )
      if (costCentreValidationError) return { ok: false, error: costCentreValidationError }

      const receiptResult: any = await query(
        `INSERT INTO receipts
          (company_id, receipt_date, receipt_number, description, status)
        VALUES (?, ?, ?, ?, ?)`,
        [
          receipt.company_id || null,
          receipt.receipt_date,
          receipt.receipt_number || null,
          receipt.description || null,
          receipt.status,
        ],
        conn
      )

      const receiptId = Number(receiptResult.insertId)

      for (const position of receipt.positions) {
        await query(
          `INSERT INTO receipt_positions
            (receipt_id, sphere, cost_centre, amount, tax)
          VALUES (?, ?, ?, ?, ?)`,
          [
            receiptId,
            position.sphere,
            position.cost_centre,
            position.amount,
            position.tax ?? 19,
          ],
          conn
        )
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

      return { ok: true, receiptId }
    })
  } catch (err: any) {
    return internalError('Failed to create receipt', err)
  }
})
