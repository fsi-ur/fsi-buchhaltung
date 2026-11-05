import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getWikiAccess } from '~/server/utils/wiki/access'
import { loadPathViews } from '~/server/utils/wiki/paths'
import type { WikiPathView } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiPathDetailResponse =
  | { ok: true, path: WikiPathView }
  | { ok: false, error: string }

const NOT_FOUND = 'Der Lernpfad wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<WikiPathDetailResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const pathId = Number(event.context.params?.id)
  if (!Number.isInteger(pathId) || pathId <= 0) return { ok: false, error: NOT_FOUND }

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)
    const paths = await loadPathViews(index, subjects, { includeUnpublished: subjects.canManage, pathId })

    const path = paths[0]
    if (!path) return { ok: false, error: NOT_FOUND }

    return { ok: true, path }
  } catch (err: any) {
    return internalError('Failed to load the wiki learning path', err)
  }
})
