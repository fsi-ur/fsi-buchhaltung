import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import {
  loadArticleChecklists,
  normalizeChecklistInput,
  saveArticleChecklists,
  validateChecklists,
} from '~/server/utils/wiki/checklists'
import type { WikiChecklistView } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

interface SaveChecklistsBody {
  checklists?: unknown[]
}

export type SaveWikiChecklistsResponse =
  | { ok: true, checklists: WikiChecklistView[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<SaveWikiChecklistsResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const body = await readBody<SaveChecklistsBody>(event)
  const lists = (Array.isArray(body?.checklists) ? body.checklists : []).map(normalizeChecklistInput)

  const error = validateChecklists(lists)
  if (error) return { ok: false, error }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await saveArticleChecklists(articleId, lists, conn)
    })

    return { ok: true, checklists: await loadArticleChecklists(articleId, Number(current.user.id), true) }
  } catch (err: any) {
    return internalError('Failed to save wiki checklists', err)
  }
})
