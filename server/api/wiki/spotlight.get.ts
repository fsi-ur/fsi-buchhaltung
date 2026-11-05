import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { filterVisibleArticles, getWikiAccess } from '~/server/utils/wiki/access'
import { loadPathViews, pickRecommendedPath } from '~/server/utils/wiki/paths'
import type { WikiHomeArticle } from '~/server/api/wiki/home.get'
import type { WikiPathView } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiSpotlightResponse =
  | { ok: true, recentlyPublished: WikiHomeArticle[], recommendedPath: WikiPathView | null }
  | { ok: false, error: string }

interface SpotlightRow {
  id: number
  title: string
  summary: string
  slug: string
  space_slug: string
  space_title: string
  changed_at: string | null
}

export default defineEventHandler(async (event): Promise<WikiSpotlightResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)

    // Over-fetch: the ACL filter runs in memory, so the visible three may sit anywhere in this window.
    const rows = await query<SpotlightRow[]>(
      `SELECT a.id, a.title, a.summary, a.slug, s.slug AS space_slug, s.title AS space_title,
              COALESCE(a.published_at, a.updated_at) AS changed_at
       FROM wiki_articles a
       JOIN wiki_spaces s ON s.id = a.space_id
       WHERE a.status = 'published' AND s.is_archived = 0
       ORDER BY changed_at DESC
       LIMIT 60`,
    )

    const paths = await loadPathViews(index, subjects)

    return {
      ok: true,
      recommendedPath: pickRecommendedPath(paths),
      recentlyPublished: filterVisibleArticles(index, subjects, rows).slice(0, 3).map(row => ({
        id: Number(row.id),
        title: row.title,
        summary: row.summary,
        slug: row.slug,
        spaceSlug: row.space_slug,
        spaceTitle: row.space_title,
        changedAt: row.changed_at ? String(row.changed_at) : null,
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load the wiki spotlight', err)
  }
})
