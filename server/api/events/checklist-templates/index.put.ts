import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import {
  loadEventChecklistTemplates,
  normalizeEventChecklistTemplates,
  replaceEventChecklistTemplates,
} from '~/server/utils/eventChecklists'
import type { EventChecklistTemplate } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface UpdateEventChecklistTemplatesSuccess {
  ok: true
  templates: EventChecklistTemplate[]
}

interface UpdateEventChecklistTemplatesError {
  ok: false
  error: string
}

export type UpdateEventChecklistTemplatesResponse = UpdateEventChecklistTemplatesSuccess | UpdateEventChecklistTemplatesError

export default defineEventHandler(async (event): Promise<UpdateEventChecklistTemplatesResponse> => {
  const current = await requirePermission(event, 'events.edit')
  if (!current.ok) return current

  const body = await readBody(event)
  const templates = normalizeEventChecklistTemplates(Array.isArray(body) ? body : body?.templates)
  if (!templates) return { ok: false, error: 'Invalid checklist template data' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const validationError = await replaceEventChecklistTemplates({
        templates,
        conn,
      })
      if (validationError) return { ok: false, error: validationError }

      return {
        ok: true,
        templates: await loadEventChecklistTemplates(conn),
      }
    })
  } catch (err: any) {
    return internalError('Failed to update event checklist templates', err)
  }
})
