import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { normalizeCashCountBody, validateCashCountBody, validateCashCountRelations } from '~/server/utils/cashCounts'
import { storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import { internalError } from '~/server/utils/api/errors'

interface CreateCashCountSuccess {
  ok: true
  cashCountId: number
}

interface CreateCashCountError {
  ok: false
  error: string
}

type CreateCashCountResponse = CreateCashCountSuccess | CreateCashCountError

export default defineEventHandler(async (event): Promise<CreateCashCountResponse> => {
  const current = await requirePermission(event, 'cash_counts.edit')
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Invalid form data' }

  const cashCountJson = multipart.getField('cashCount')
  if (!cashCountJson) return { ok: false, error: 'Missing cash count data' }

  const cashCount = normalizeCashCountBody(JSON.parse(cashCountJson))
  const validationError = validateCashCountBody(cashCount)
  if (validationError) return { ok: false, error: validationError }

  const fileError = validateUploadedFile(multipart.file, 'A file is required for cash counts')
  if (fileError) return { ok: false, error: fileError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const relationError = await validateCashCountRelations(cashCount, conn)
      if (relationError) return { ok: false, error: relationError }

      const result: any = await query(
        `INSERT INTO cash_counts
          (event_id, counted_by_first, counted_by_second, checked_by, counted_before_at, counted_after_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          cashCount.event_id,
          cashCount.counted_by_first,
          cashCount.counted_by_second,
          cashCount.checked_by,
          cashCount.counted_before_at,
          cashCount.counted_after_at,
        ],
        conn
      )

      const cashCountId = Number(result.insertId)

      for (const position of cashCount.positions) {
        await query(
          `INSERT INTO cash_count_positions
            (cash_count_id, register_number, amount_before, amount_after, notes)
           VALUES (?, ?, ?, ?, ?)`,
          [
            cashCountId,
            position.register_number,
            position.amount_before,
            position.amount_after,
            position.notes,
          ],
          conn
        )
      }

      await storeAndAttachUploadedFile(
        multipart.file!,
        'cash_counts',
        'cash_count',
        cashCountId,
        current.user.id,
        conn,
      )

      return { ok: true, cashCountId }
    })
  } catch (err: any) {
    return internalError('Failed to create cash count', err)
  }
})
