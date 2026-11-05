import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getWikiAccess } from '~/server/utils/wiki/access'
import { searchArticles } from '~/server/utils/wiki/search'
import type { WikiSearchHit } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiSearchResponse =
  | { ok: true, hits: WikiSearchHit[] }
  | { ok: false, error: string }

function numericParam(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export default defineEventHandler(async (event): Promise<WikiSearchResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const params = getQuery(event)
  const term = String(params.q ?? '')

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)
    const hits = await searchArticles(index, subjects, term, {
      spaceId: numericParam(params.spaceId),
      tag: params.tag ? String(params.tag) : null,
      ownerPositionId: numericParam(params.ownerPositionId),
      ownerSubdivisionId: numericParam(params.ownerSubdivisionId),
    })
    return { ok: true, hits }
  } catch (err: any) {
    return internalError('Failed to search the wiki', err)
  }
})
