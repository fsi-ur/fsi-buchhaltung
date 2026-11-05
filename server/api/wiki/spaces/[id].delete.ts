import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getWikiAccess, invalidateWikiAccess } from '~/server/utils/wiki/access'
import { deleteScopeGrants } from '~/server/utils/wiki/grants'
import { internalError } from '~/server/utils/api/errors'

export type DeleteWikiSpaceResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<DeleteWikiSpaceResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const spaceId = Number(event.context.params?.id)
  if (!Number.isInteger(spaceId) || spaceId <= 0) return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }

  const { index } = await getWikiAccess(event, current.user)
  if (!index.spaceIds.has(spaceId)) return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }

  const articleCount = [...index.articles.values()].filter(article => article.spaceId === spaceId).length

  if (articleCount) {
    return {
      ok: false,
      error: 'Dieser Bereich enthält noch Artikel. Bitte archiviere ihn, statt ihn zu löschen.',
    }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await deleteScopeGrants('space', [spaceId], conn)
      await query('DELETE FROM wiki_spaces WHERE id = ?', [spaceId], conn)
    })

    invalidateWikiAccess(event)
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to delete wiki space', err)
  }
})
