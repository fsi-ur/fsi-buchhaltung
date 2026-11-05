import { defineEventHandler, readBody } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { itemBelongsToChecklist, loadRunContext } from '~/server/utils/wiki/checklists'
import { internalError } from '~/server/utils/api/errors'

interface RunStateBody {
  itemId?: number
  done?: boolean
}

export type WikiChecklistRunStateResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Durchgang wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<WikiChecklistRunStateResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const runId = Number(event.context.params?.id)
  if (!Number.isInteger(runId) || runId <= 0) return { ok: false, error: NOT_FOUND }

  const context = await loadRunContext(runId)
  if (!context) return { ok: false, error: NOT_FOUND }
  if (context.closed) return { ok: false, error: 'Dieser Durchgang ist abgeschlossen.' }

  const body = await readBody<RunStateBody>(event)
  const itemId = Number(body?.itemId)
  if (!Number.isInteger(itemId) || itemId <= 0) return { ok: false, error: NOT_FOUND }
  if (!await itemBelongsToChecklist(itemId, context.checklistId)) return { ok: false, error: NOT_FOUND }

  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!canReadArticle(index, subjects, context.articleId)) return { ok: false, error: NOT_FOUND }

  try {
    if (body?.done === false) {
      await query('DELETE FROM wiki_checklist_run_state WHERE run_id = ? AND item_id = ?', [runId, itemId])
    } else {
      await query(
        `INSERT INTO wiki_checklist_run_state (run_id, item_id, completed_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE completed_at = CURRENT_TIMESTAMP, completed_by = VALUES(completed_by)`,
        [runId, itemId, current.user.id],
      )
    }

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to save wiki checklist run state', err)
  }
})
