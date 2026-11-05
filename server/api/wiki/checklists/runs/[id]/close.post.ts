import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { canReadArticle, getEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { loadRunContext } from '~/server/utils/wiki/checklists'
import { internalError } from '~/server/utils/api/errors'

interface CloseRunBody {
  closed?: boolean
}

export type CloseWikiChecklistRunResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Durchgang wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<CloseWikiChecklistRunResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const runId = Number(event.context.params?.id)
  if (!Number.isInteger(runId) || runId <= 0) return { ok: false, error: NOT_FOUND }

  const context = await loadRunContext(runId)
  if (!context) return { ok: false, error: NOT_FOUND }

  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!canReadArticle(index, subjects, context.articleId)) return { ok: false, error: NOT_FOUND }

  const canWrite = levelAtLeast(getEffectiveLevel(index, subjects, context.articleId), 'write')
  if (!canWrite && context.createdBy !== Number(current.user.id)) {
    return { ok: false, error: 'Nur wer den Durchgang gestartet hat, kann ihn abschließen.' }
  }

  const payload = await readBody<CloseRunBody>(event)
  const closed = payload?.closed !== false

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        'UPDATE wiki_checklist_runs SET closed_at = ? WHERE id = ?',
        [closed ? new Date() : null, runId],
        conn,
      )
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to close wiki checklist run', err)
  }
})
