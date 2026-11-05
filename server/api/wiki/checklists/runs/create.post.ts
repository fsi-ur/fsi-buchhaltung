import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { canReadArticle, getWikiAccess } from '~/server/utils/wiki/access'
import { MAX_RUNS_PER_CHECKLIST, countRuns, loadChecklistContext } from '~/server/utils/wiki/checklists'
import { internalError } from '~/server/utils/api/errors'

interface CreateRunBody {
  checklistId?: number
  title?: string
  dueDate?: string | null
}

export type CreateWikiChecklistRunResponse =
  | { ok: true, runId: number }
  | { ok: false, error: string }

const NOT_FOUND = 'Die Checkliste wurde nicht gefunden.'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event): Promise<CreateWikiChecklistRunResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const body = await readBody<CreateRunBody>(event)
  const checklistId = Number(body?.checklistId)
  if (!Number.isInteger(checklistId) || checklistId <= 0) return { ok: false, error: NOT_FOUND }

  const context = await loadChecklistContext(checklistId)
  if (!context) return { ok: false, error: NOT_FOUND }
  if (context.mode !== 'shared') {
    return { ok: false, error: 'Für persönliche Checklisten gibt es keine gemeinsamen Durchgänge.' }
  }

  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!canReadArticle(index, subjects, context.articleId)) return { ok: false, error: NOT_FOUND }

  const title = String(body?.title ?? '').trim().slice(0, 200)
  if (!title) return { ok: false, error: 'Bitte einen Titel für den Durchgang angeben.' }

  const rawDueDate = String(body?.dueDate ?? '').trim()
  if (rawDueDate && !ISO_DATE.test(rawDueDate)) return { ok: false, error: 'Das Fälligkeitsdatum ist ungültig.' }
  const dueDate = rawDueDate || null

  if (await countRuns(checklistId) >= MAX_RUNS_PER_CHECKLIST) {
    return { ok: false, error: 'Für diese Checkliste gibt es bereits zu viele Durchgänge.' }
  }

  try {
    const runId = await withAuditTransaction(current.user, async (conn) => {
      const result = await query<{ insertId: number }>(
        'INSERT INTO wiki_checklist_runs (checklist_id, title, due_date, created_by) VALUES (?, ?, ?, ?)',
        [checklistId, title, dueDate, current.user.id],
        conn,
      )
      return Number(result.insertId)
    })

    return { ok: true, runId }
  } catch (err: any) {
    return internalError('Failed to create wiki checklist run', err)
  }
})
