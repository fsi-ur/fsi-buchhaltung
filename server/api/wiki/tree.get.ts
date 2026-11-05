import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getWikiAccess } from '~/server/utils/wiki/access'
import { buildVisibleTree, loadSpaceRows, loadTreeArticleRows } from '~/server/utils/wiki/articles'
import type { WikiTreeSpace } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiTreeResponse =
  | { ok: true, spaces: WikiTreeSpace[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiTreeResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)
    const [spaces, articles] = await Promise.all([loadSpaceRows(), loadTreeArticleRows()])

    // Drafts are per scope: `buildVisibleTree` only lets them through where the viewer has `write`,
    // so a Referent sees their own unpublished work and nobody else's.
    const includeDrafts = String(getQuery(event).includeDrafts ?? '') === '1'

    return { ok: true, spaces: buildVisibleTree(spaces, articles, index, subjects, { includeDrafts }) }
  } catch (err: any) {
    return internalError('Failed to load wiki tree', err)
  }
})
