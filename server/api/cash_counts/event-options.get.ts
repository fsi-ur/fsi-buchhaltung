import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import type { EventRow } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface GetCashCountEventOptionsSuccess {
  ok: true
  events: EventRow[]
}

interface GetCashCountEventOptionsError {
  ok: false
  error: string
}

type GetCashCountEventOptionsResponse = GetCashCountEventOptionsSuccess | GetCashCountEventOptionsError

export default defineEventHandler(async (event): Promise<GetCashCountEventOptionsResponse> => {
  const current = await requirePermission(event, 'cash_counts.view')
  if (!current.ok) return current

  try {
    const rows = await query<EventRow[]>(
      `SELECT id, name, starts_at, ends_at, location, expected_guests
       FROM events
       ORDER BY starts_at DESC, ends_at DESC, name ASC`,
    )

    return {
      ok: true,
      events: rows.map(row => ({
        id: Number(row.id),
        name: String(row.name),
        starts_at: String(row.starts_at),
        ends_at: String(row.ends_at),
        location: String(row.location),
        expected_guests: Number(row.expected_guests),
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load cash count event options', err)
  }
})
