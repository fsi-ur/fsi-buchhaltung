import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getWikiAccess } from '~/server/utils/wiki/access'
import { loadPathViews } from '~/server/utils/wiki/paths'
import type { WikiPathView } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiPathListResponse =
  | { ok: true, paths: WikiPathView[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiPathListResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)
    const paths = await loadPathViews(index, subjects, { includeUnpublished: subjects.canManage })
    return { ok: true, paths }
  } catch (err: any) {
    return internalError('Failed to load the wiki learning paths', err)
  }
})
