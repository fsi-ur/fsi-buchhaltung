import { defineEventHandler, getQuery } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { deleteArticleImage, unlinkStoredFile } from '~/server/utils/wiki/images'

export type DeleteWikiImageResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<DeleteWikiImageResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  const fileId = Number(getQuery(event).fileId)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }
  if (!Number.isInteger(fileId) || fileId <= 0) return { ok: false, error: 'Das Bild wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  try {
    const result = await withAuditTransaction(current.user, conn => deleteArticleImage(articleId, fileId, conn))
    if (!result.ok) return result

    await unlinkStoredFile(result.filePath)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: `Das Bild konnte nicht gelöscht werden: ${err}` }
  }
})
