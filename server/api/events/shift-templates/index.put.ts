import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import {
  loadEventShiftTemplates,
  normalizeEventShiftTemplates,
  replaceEventShiftTemplates,
} from '~/server/utils/eventShifts'
import type { EventShiftTemplate } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface UpdateEventShiftTemplatesSuccess {
  ok: true
  templates: EventShiftTemplate[]
}

interface UpdateEventShiftTemplatesError {
  ok: false
  error: string
}

export type UpdateEventShiftTemplatesResponse = UpdateEventShiftTemplatesSuccess | UpdateEventShiftTemplatesError

export default defineEventHandler(async (event): Promise<UpdateEventShiftTemplatesResponse> => {
  const current = await requirePermission(event, 'events.edit')
  if (!current.ok) return current

  const body = await readBody(event)
  const templates = normalizeEventShiftTemplates(Array.isArray(body) ? body : body?.templates)
  if (!templates) return { ok: false, error: 'Invalid shift template data' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const validationError = await replaceEventShiftTemplates({
        templates,
        conn,
      })
      if (validationError) return { ok: false, error: validationError }

      return {
        ok: true,
        templates: await loadEventShiftTemplates(conn),
      }
    })
  } catch (err: any) {
    return internalError('Failed to update event shift templates', err)
  }
})
