import { defineEventHandler, readBody } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { itemBelongsToChecklist, loadChecklistContext } from '~/server/utils/wiki/checklists'
import { internalError } from '~/server/utils/api/errors'

interface PersonalStateBody {
  checklistId?: number
  itemId?: number
  done?: boolean
}

export type WikiChecklistPersonalResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Die Checkliste wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<WikiChecklistPersonalResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const body = await readBody<PersonalStateBody>(event)
  const checklistId = Number(body?.checklistId)
  const itemId = Number(body?.itemId)
  if (!Number.isInteger(checklistId) || checklistId <= 0) return { ok: false, error: NOT_FOUND }
  if (!Number.isInteger(itemId) || itemId <= 0) return { ok: false, error: NOT_FOUND }

  const context = await loadChecklistContext(checklistId)
  if (!context) return { ok: false, error: NOT_FOUND }
  if (context.mode !== 'personal') {
    return { ok: false, error: 'Diese Checkliste wird gemeinsam geführt – bitte einen Durchgang verwenden.' }
  }
  if (!await itemBelongsToChecklist(itemId, checklistId)) return { ok: false, error: NOT_FOUND }

  // Reading the article is enough to tick your own boxes — the state is private to the user.
  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!canReadArticle(index, subjects, context.articleId)) return { ok: false, error: NOT_FOUND }

  try {
    if (body?.done === false) {
      await query(
        'DELETE FROM wiki_checklist_personal_state WHERE user_id = ? AND item_id = ?',
        [current.user.id, itemId],
      )
    } else {
      await query(
        `INSERT INTO wiki_checklist_personal_state (user_id, item_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE completed_at = CURRENT_TIMESTAMP`,
        [current.user.id, itemId],
      )
    }

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to save wiki checklist state', err)
  }
})
