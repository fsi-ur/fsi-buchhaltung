import type { H3Event } from 'h3'
import { query } from '~/server/utils/db'
import type { User } from '~/types/user'
import { getEffectiveLevel, getSpaceEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { buildVisibleTree, isStale, loadSpaceRows, loadTreeArticleRows } from '~/server/utils/wiki/articles'
import { parseInstant } from '~/shared/time'
import type { WikiAccessLevel, WikiTreeSpace } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export interface WikiSpaceTodoArticle {
  id: number
  title: string
  /** In review: when it was last changed; due: when the check-up became due (instant). */
  since: string | null
}

export interface WikiSpaceDetail extends WikiTreeSpace {
  isArchived: boolean
  ownerPositionId: number | null
  ownerPositionName: string | null
  ownerSubdivisionId: number | null
  ownerSubdivisionName: string | null
  /** Upkeep among the articles the viewer may edit (empty for readers). */
  todo: {
    inReview: WikiSpaceTodoArticle[]
    due: WikiSpaceTodoArticle[]
  }
}

interface TodoRow {
  id: number
  title: string
  status: string
  review_interval_days: number | null
  reviewed_at: string | null
  published_at: string | null
  updated_at: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export type WikiSpaceDetailResult =
  | { ok: true, space: WikiSpaceDetail }
  | { ok: false, error: string }

export const WIKI_SPACE_NOT_FOUND = 'Der Bereich wurde nicht gefunden.'

/**
 * One space for its read view: its data, the viewer's level on it and every article in it the viewer
 * may see (drafts and archived ones only where the viewer may edit them, as in the tree).
 */
export async function loadSpaceDetail(
  event: H3Event,
  user: User,
  /** The space by id, or by its slug (as in shareable links). */
  target: { id: number } | { slug: string },
): Promise<WikiSpaceDetailResult> {
  const NOT_FOUND = WIKI_SPACE_NOT_FOUND
  try {
    const { index, subjects } = await getWikiAccess(event, user)
    const [spaces, articles] = await Promise.all([loadSpaceRows(), loadTreeArticleRows()])

    const row = spaces.find(space => 'id' in target ? Number(space.id) === target.id : space.slug === target.slug)
    if (!row) return { ok: false, error: NOT_FOUND }
    const spaceId = Number(row.id)

    // Archived spaces stay reachable for those who may edit them (e.g. to restore their content).
    const level = getSpaceEffectiveLevel(index, subjects, spaceId)
    const tree = buildVisibleTree([row], articles, index, subjects, { includeDrafts: true, includeArchivedSpaces: level !== 'read' })
    const space = tree[0]
    if (!space) return { ok: false, error: NOT_FOUND }

    const todoRows = await query<TodoRow[]>(
      `SELECT id, title, status, review_interval_days, reviewed_at, published_at, updated_at
       FROM wiki_articles
       WHERE space_id = ? AND status IN ('in_review', 'published')
       ORDER BY title`,
      [spaceId],
    )
    const editable = todoRows.filter(entry => levelAtLeast(getEffectiveLevel(index, subjects, Number(entry.id)), 'write'))
    const inReview = editable
      .filter(entry => entry.status === 'in_review')
      .map(entry => ({ id: Number(entry.id), title: entry.title, since: entry.updated_at ? String(entry.updated_at) : null }))
    const due = editable
      .filter(entry => entry.status === 'published' && isStale(entry))
      .map((entry) => {
        const reference = parseInstant(entry.reviewed_at ?? entry.published_at)
        const dueAt = reference ? new Date(reference.getTime() + Number(entry.review_interval_days) * DAY_MS).toISOString() : null
        return { id: Number(entry.id), title: entry.title, since: dueAt }
      })
      .sort((a, b) => String(a.since).localeCompare(String(b.since)))

    const [positionRows, subdivisionRows] = await Promise.all([
      row.owner_position_id
        ? query<Array<{ name: string }>>('SELECT name FROM positions WHERE id = ? LIMIT 1', [row.owner_position_id])
        : Promise.resolve([]),
      row.owner_subdivision_id
        ? query<Array<{ name: string }>>('SELECT name FROM subdivisions WHERE id = ? LIMIT 1', [row.owner_subdivision_id])
        : Promise.resolve([]),
    ])

    return {
      ok: true,
      space: {
        ...space,
        accessLevel: space.accessLevel as WikiAccessLevel,
        isArchived: Boolean(row.is_archived),
        ownerPositionId: row.owner_position_id === null ? null : Number(row.owner_position_id),
        ownerPositionName: positionRows[0]?.name ?? null,
        ownerSubdivisionId: row.owner_subdivision_id === null ? null : Number(row.owner_subdivision_id),
        ownerSubdivisionName: subdivisionRows[0]?.name ?? null,
        todo: { inReview, due },
      },
    }
  } catch (err: any) {
    return internalError('Failed to load wiki space', err)
  }
}
