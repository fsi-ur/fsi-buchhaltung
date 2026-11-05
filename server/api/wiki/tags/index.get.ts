import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getWikiAccess } from '~/server/utils/wiki/access'
import { loadVisibleTagViews, type WikiTagView } from '~/server/utils/wiki/tags'
import { internalError } from '~/server/utils/api/errors'

export type WikiTagsResponse =
  | { ok: true, tags: WikiTagView[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiTagsResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)
    return { ok: true, tags: await loadVisibleTagViews(index, subjects) }
  } catch (err: any) {
    return internalError('Failed to load the wiki tags', err)
  }
})
