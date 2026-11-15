import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { loadSpaceDetail, WIKI_SPACE_NOT_FOUND } from '~/server/utils/wiki/spaceDetail'
import type { WikiSpaceDetailResponse } from '~/server/api/wiki/spaces/[id].get'

/** A space by its slug, for shareable links such as `#WikiSpace?slug=finanzen`. */
export default defineEventHandler(async (event): Promise<WikiSpaceDetailResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const slug = String(getQuery(event).slug ?? '').trim().toLowerCase()
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, error: WIKI_SPACE_NOT_FOUND }

  return loadSpaceDetail(event, current.user, { slug })
})
