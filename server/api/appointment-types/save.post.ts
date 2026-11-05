import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import type { SaveAppointmentTypeBody } from '~/types/appointment'
import { internalError } from '~/server/utils/api/errors'

interface SaveAppointmentTypeSuccess {
  ok: true
  id: number
}

interface SaveAppointmentTypeError {
  ok: false
  error: string
}

export type SaveAppointmentTypeResponse = SaveAppointmentTypeSuccess | SaveAppointmentTypeError

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const DEFAULT_COLOR = '#3b82f6'

export default defineEventHandler(async (event): Promise<SaveAppointmentTypeResponse> => {
  const current = await requirePermission(event, 'calendar.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SaveAppointmentTypeBody>(event)

  const name = String(body?.name ?? '').trim()
  if (!name) return { ok: false, error: 'Bitte gib einen Namen für die Terminart an.' }
  if (name.length > 127) return { ok: false, error: 'Der Name darf höchstens 127 Zeichen lang sein.' }

  const color = body.color ? String(body.color).trim() : DEFAULT_COLOR
  if (!HEX_COLOR.test(color)) return { ok: false, error: 'Die Farbe muss ein Hex-Wert der Form #rrggbb sein.' }

  const icon = body.icon ? String(body.icon).trim().slice(0, 127) : null

  const sortOrder = Number(body.sort_order ?? 0)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 65535) {
    return { ok: false, error: 'Die Sortierung muss eine Zahl zwischen 0 und 65535 sein.' }
  }

  const description = body.description ? String(body.description) : null

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      if (body.id && Number(body.id) > 0) {
        const existing = await query<Array<{ id: number }>>(
          `SELECT id FROM appointment_types WHERE id = ? LIMIT 1`,
          [body.id],
          conn,
        )
        if (!existing.length) return { ok: false as const, error: 'Die Terminart wurde nicht gefunden.' }

        await query(
          `UPDATE appointment_types
             SET name = ?, color = ?, icon = ?, sort_order = ?, description = ?
           WHERE id = ?`,
          [name, color, icon, sortOrder, description, body.id],
          conn,
        )

        return { ok: true as const, id: Number(body.id) }
      }

      const result = await query<{ insertId: number }>(
        `INSERT INTO appointment_types (name, color, icon, sort_order, is_active, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, color, icon, sortOrder, toDbBoolean(body.is_active ?? true), description],
        conn,
      )

      return { ok: true as const, id: normalizeBigInt(result.insertId) }
    })
  } catch (err: any) {
    return internalError('Die Terminart konnte nicht gespeichert werden', err)
  }
})
