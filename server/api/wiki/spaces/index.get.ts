import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import type { WikiSpaceAdminView } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiSpaceListResponse =
  | { ok: true, spaces: WikiSpaceAdminView[] }
  | { ok: false, error: string }

interface SpaceRow {
  id: number
  slug: string
  title: string
  description: string
  icon: string
  position: number
  requires_review: number
  is_archived: number
  owner_position_id: number | null
  owner_position_name: string | null
  owner_subdivision_id: number | null
  owner_subdivision_name: string | null
  article_count: number
}

export default defineEventHandler(async (event): Promise<WikiSpaceListResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  try {
    const rows = await query<SpaceRow[]>(
      `SELECT s.id, s.slug, s.title, s.description, s.icon, s.position, s.requires_review, s.is_archived,
              s.owner_position_id, p.name AS owner_position_name,
              s.owner_subdivision_id, sd.name AS owner_subdivision_name,
              (SELECT COUNT(*) FROM wiki_articles a WHERE a.space_id = s.id) AS article_count
       FROM wiki_spaces s
       LEFT JOIN positions p ON p.id = s.owner_position_id
       LEFT JOIN subdivisions sd ON sd.id = s.owner_subdivision_id
       ORDER BY s.position, s.title`,
    )

    return {
      ok: true,
      spaces: rows.map(row => ({
        id: Number(row.id),
        slug: row.slug,
        title: row.title,
        description: row.description,
        icon: row.icon,
        position: Number(row.position),
        requiresReview: Number(row.requires_review) === 1,
        isArchived: Number(row.is_archived) === 1,
        ownerPositionId: row.owner_position_id === null ? null : Number(row.owner_position_id),
        ownerPositionName: row.owner_position_name,
        ownerSubdivisionId: row.owner_subdivision_id === null ? null : Number(row.owner_subdivision_id),
        ownerSubdivisionName: row.owner_subdivision_name,
        articleCount: Number(row.article_count),
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load the wiki spaces', err)
  }
})
