import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getAttachedFile } from '~/server/utils/files'
import type { CashCount, CashCountPosition, CashCountRow } from '~/types/cashCount'
import type { FileRow } from '~/types/file'
import { internalError } from '~/server/utils/api/errors'

interface GetCashCountSuccess {
  ok: true
  cashCount: CashCount
  file: FileRow | null
}

interface GetCashCountError {
  ok: false
  error: string
}

export type GetCashCountResponse = GetCashCountSuccess | GetCashCountError

export default defineEventHandler(async (event): Promise<GetCashCountResponse> => {
  const current = await requirePermission(event, 'cash_counts.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid cash count id' }

  try {
    const cashCountRows: CashCountRow[] = await query(
      `
      SELECT
        cc.id,
        cc.event_id,
        e.name AS event_name,
        cc.counted_by_first,
        cc.counted_by_second,
        cc.checked_by,
        cc.counted_before_at,
        cc.counted_after_at
      FROM cash_counts cc
      LEFT JOIN events e ON e.id = cc.event_id
      WHERE cc.id = ?
      LIMIT 1
      `,
      [id]
    )

    if (!cashCountRows.length) return { ok: false, error: 'Cash count not found' }

    const cashCount = normalizeBigInt(cashCountRows[0])

    const positionsRaw: any[] = await query(
      `
      SELECT id, cash_count_id, register_number, amount_before, amount_after, notes
      FROM cash_count_positions
      WHERE cash_count_id = ?
      ORDER BY register_number ASC, id ASC
      `,
      [id]
    )

    const positions: CashCountPosition[] = positionsRaw.map(position => ({
      id: Number(position.id),
      cash_count_id: Number(position.cash_count_id),
      register_number: Number(position.register_number),
      amount_before: Number(position.amount_before),
      amount_after: Number(position.amount_after),
      notes: position.notes ? String(position.notes) : null,
      difference: Number(position.amount_after) - Number(position.amount_before),
    }))

    const file = await getAttachedFile('cash_count', id)

    return {
      ok: true,
      cashCount: {
        id: Number(cashCount.id),
        event_id: cashCount.event_id === null ? null : Number(cashCount.event_id),
        event_name: cashCount.event_name === null ? null : String(cashCount.event_name),
        counted_by_first: Number(cashCount.counted_by_first),
        counted_by_second: Number(cashCount.counted_by_second),
        checked_by: Number(cashCount.checked_by),
        counted_before_at: cashCount.counted_before_at === null ? null : String(cashCount.counted_before_at),
        counted_after_at: String(cashCount.counted_after_at),
        positions,
      },
      file: file ? normalizeBigInt(file) : null,
    }
  } catch (err: any) {
    return internalError('An error occurred while fetching a cash count', err)
  }
})
