import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { loadSpaceDetail, WIKI_SPACE_NOT_FOUND, type WikiSpaceDetailResult } from '~/server/utils/wiki/spaceDetail'

export type { WikiSpaceDetail, WikiSpaceTodoArticle } from '~/server/utils/wiki/spaceDetail'
export type WikiSpaceDetailResponse = WikiSpaceDetailResult

/** One space for its read view — see `loadSpaceDetail`. */
export default defineEventHandler(async (event): Promise<WikiSpaceDetailResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const spaceId = Number(event.context.params?.id)
  if (!Number.isInteger(spaceId) || spaceId <= 0) return { ok: false, error: WIKI_SPACE_NOT_FOUND }

  return loadSpaceDetail(event, current.user, { id: spaceId })
})
