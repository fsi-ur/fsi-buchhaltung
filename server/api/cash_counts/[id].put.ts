import { parseJsonField } from '~/server/utils/api/request'
import { isCashCountLocked, isUnlockRequested, lockError } from '~/server/utils/recordLocks'
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
  normalizeCashCountBody,
  validateCashCountBody,
  validateCashCountRelations,
} from '~/server/utils/cashCounts'
import type { CashCountPositionRow, CashCountRow } from '~/types/cashCount'
import { internalError } from '~/server/utils/api/errors'

interface UpdateCashCountSuccess {
  ok: true
}

interface UpdateCashCountError {
  ok: false
  error: string
}

type UpdateCashCountResponse = UpdateCashCountSuccess | UpdateCashCountError

export default defineEventHandler(async (event): Promise<UpdateCashCountResponse> => {
  const current = await requirePermission(event, 'cash_counts.edit')
  if (!current.ok) return current

  const cashCountId = getNumericRouteParam(event)
  if (!cashCountId) return { ok: false, error: 'Invalid cash count id' }

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Missing form data' }

  const unlockRequested = isUnlockRequested(multipart.getField('unlock'))

  const cashCountJson = multipart.getField('cashCount')
  const removeExistingFile = multipart.getField('removeExistingFile') === 'true'

  if (!cashCountJson) return { ok: false, error: 'Missing cash count data' }

  const parsedJson = parseJsonField(cashCountJson)

  if (!parsedJson.ok) return parsedJson

  const updated = normalizeCashCountBody(parsedJson.value)
  const validationError = validateCashCountBody(updated)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows: CashCountRow[] = await query(
        `SELECT * FROM cash_counts WHERE id = ? LIMIT 1`,
        [cashCountId],
        conn
      )

      if (!existingRows.length) return { ok: false, error: 'Cash count not found' }
      const locked = lockError(await isCashCountLocked(cashCountId, conn), current.user.permissions, 'cash_counts.unlock', unlockRequested)
      if (locked) return { ok: false, error: locked }
      const relationError = await validateCashCountRelations(updated, conn)
      if (relationError) return { ok: false, error: relationError }

      await query(
        `UPDATE cash_counts SET
          event_id = ?,
          counted_by_first = ?,
          counted_by_second = ?,
          checked_by = ?,
          counted_before_at = ?,
          counted_after_at = ?
        WHERE id = ?`,
        [
          updated.event_id,
          updated.counted_by_first,
          updated.counted_by_second,
          updated.checked_by,
          updated.counted_before_at,
          updated.counted_after_at,
          cashCountId,
        ],
        conn
      )

      const existingPositions: CashCountPositionRow[] = await query(
        `SELECT * FROM cash_count_positions WHERE cash_count_id = ? ORDER BY register_number ASC, id ASC`,
        [cashCountId],
        conn
      )

      const existingMap = new Map(existingPositions.map(position => [Number(position.id), position]))
      const incomingMap = new Map(
        updated.positions
          .filter(position => position.id)
          .map(position => [Number(position.id), position])
      )

      for (const existingPosition of existingPositions) {
        if (incomingMap.has(Number(existingPosition.id))) continue

        await query(
          `DELETE FROM cash_count_positions WHERE id = ?`,
          [existingPosition.id],
          conn
        )
      }

      for (const position of updated.positions) {
        if (!position.id) continue
        const existingPosition = existingMap.get(Number(position.id))
        if (!existingPosition) continue

        await query(
          `UPDATE cash_count_positions
           SET register_number = ?, amount_before = ?, amount_after = ?, notes = ?
           WHERE id = ?`,
          [
            position.register_number,
            position.amount_before,
            position.amount_after,
            position.notes,
            position.id,
          ],
          conn
        )
      }

      for (const position of updated.positions) {
        if (position.id) continue

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

      const existingAttachment = await getActiveFileAttachment('cash_count', cashCountId, conn)
      const hasExistingFile = Boolean(existingAttachment)
      const hasFileAfterSave = Boolean(multipart.file) || (hasExistingFile && !removeExistingFile)
      if (!hasFileAfterSave) {
        return { ok: false, error: 'A file is required for cash counts' }
      }

      const fileError = validateUploadedFile(multipart.file)
      if (fileError && multipart.file) return { ok: false, error: fileError }

      if (removeExistingFile && existingAttachment) {
        await detachFileAttachment(existingAttachment.id, current.user.id, conn)
      }

      if (multipart.file) {
        await storeAndAttachUploadedFile(
          multipart.file,
          'cash_counts',
          'cash_count',
          cashCountId,
          current.user.id,
          conn,
        )
      }

      return { ok: true }
    })
  } catch (err: any) {
    return internalError('Failed to update cash count', err)
  }
})
