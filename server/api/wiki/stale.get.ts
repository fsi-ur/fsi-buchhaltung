import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { filterVisibleArticles, getEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { isStale } from '~/server/utils/wiki/articles'
import { parseInstant } from '~/shared/time'

export interface WikiStaleArticle {
  id: number
  title: string
  spaceTitle: string
  reviewIntervalDays: number
  reviewedAt: string | null
  publishedAt: string | null
  dueAt: string
  ownerLabel: string
}

export type WikiStaleResponse =
  | { ok: true, articles: WikiStaleArticle[] }
  | { ok: false, error: string }

interface StaleRow {
  id: number
  title: string
  space_title: string
  review_interval_days: number | null
  reviewed_at: string | null
  published_at: string | null
  position_name: string | null
  subdivision_name: string | null
}

export default defineEventHandler(async (event): Promise<WikiStaleResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  try {
    const { index, subjects } = await getWikiAccess(event, current.user)

    const rows = await query<StaleRow[]>(
      `SELECT a.id, a.title, s.title AS space_title, a.review_interval_days, a.reviewed_at, a.published_at,
              p.name AS position_name, d.name AS subdivision_name
       FROM wiki_articles a
       JOIN wiki_spaces s ON s.id = a.space_id
       LEFT JOIN positions p ON p.id = a.owner_position_id
       LEFT JOIN subdivisions d ON d.id = a.owner_subdivision_id
       WHERE a.status = 'published' AND a.review_interval_days IS NOT NULL
       ORDER BY s.position, s.title, a.title`,
    )

    const articles = filterVisibleArticles(index, subjects, rows)
      .filter(row => levelAtLeast(getEffectiveLevel(index, subjects, Number(row.id)), 'write'))
      .filter(row => isStale(row as any))
      .map((row) => {
        const reference = row.reviewed_at ?? row.published_at
        const dueAt = new Date(parseInstant(reference)!.getTime() + Number(row.review_interval_days) * 24 * 60 * 60 * 1000)

        return {
          id: Number(row.id),
          title: row.title,
          spaceTitle: row.space_title,
          reviewIntervalDays: Number(row.review_interval_days),
          reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
          publishedAt: row.published_at ? String(row.published_at) : null,
          dueAt: dueAt.toISOString(),
          ownerLabel: [row.position_name, row.subdivision_name].filter(Boolean).join(' · '),
        }
      })
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))

    return { ok: true, articles }
  } catch (err: any) {
    return { ok: false, error: `Failed to load the wiki review report: ${err}` }
  }
})
