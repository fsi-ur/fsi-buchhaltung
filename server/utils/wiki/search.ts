import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { filterVisibleArticles, type ViewerSubjects, type WikiAccessIndex } from '~/server/utils/wiki/access'
import type { WikiSearchHit } from '~/types/wiki'

interface SearchRow {
  id: number
  space_id: number
  space_slug: string
  space_title: string
  slug: string
  title: string
  summary: string
  content_text: string | null
}

export interface WikiSearchFilters {
  spaceId?: number | null
  tag?: string | null
  ownerPositionId?: number | null
  ownerSubdivisionId?: number | null
  limit?: number
}

let fulltextProbe: Promise<boolean> | null = null

export function hasWikiFulltextIndex(conn?: mariadb.PoolConnection) {
  if (!fulltextProbe) {
    fulltextProbe = query<Array<{ INDEX_NAME: string }>>(
      `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wiki_articles' AND INDEX_NAME = 'ft_wiki_article'
       LIMIT 1`,
      [],
      conn,
    )
      .then(rows => rows.length > 0)
      .catch(() => false)
  }
  return fulltextProbe
}

function toBooleanQuery(term: string) {
  const words = term
    .split(/\s+/)
    .map(word => word.replace(/[+\-><()~*"@]/g, '').trim())
    .filter(word => word.length >= 2)

  return words.map(word => `+${word}*`).join(' ')
}

function buildSnippet(text: string | null, term: string) {
  const source = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!source) return ''

  const position = term ? source.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (position < 0) return source.slice(0, 220) + (source.length > 220 ? ' …' : '')

  const start = Math.max(0, position - 90)
  const end = Math.min(source.length, position + term.length + 130)
  return `${start > 0 ? '… ' : ''}${source.slice(start, end)}${end < source.length ? ' …' : ''}`
}

export async function searchArticles(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  rawTerm: string,
  filters: WikiSearchFilters = {},
): Promise<WikiSearchHit[]> {
  const term = rawTerm.trim()
  const hasTerm = term.length >= 2
  if (!hasTerm && !filters.tag) return []

  const conditions: string[] = []
  const params: unknown[] = []

  if (hasTerm) {
    const booleanTerm = toBooleanQuery(term)

    if (booleanTerm && await hasWikiFulltextIndex()) {
      conditions.push('MATCH (a.title, a.summary, a.content_text) AGAINST (? IN BOOLEAN MODE)')
      params.push(booleanTerm)
    } else {
      conditions.push('(a.title LIKE ? OR a.summary LIKE ? OR a.content_text LIKE ?)')
      const like = `%${term}%`
      params.push(like, like, like)
    }
  }

  if (filters.spaceId) {
    conditions.push('a.space_id = ?')
    params.push(filters.spaceId)
  }

  if (filters.tag) {
    conditions.push('EXISTS (SELECT 1 FROM wiki_article_tags at JOIN wiki_tags t ON t.id = at.tag_id WHERE at.article_id = a.id AND t.slug = ?)')
    params.push(filters.tag)
  }

  if (filters.ownerPositionId) {
    conditions.push('a.owner_position_id = ?')
    params.push(filters.ownerPositionId)
  }

  if (filters.ownerSubdivisionId) {
    conditions.push('a.owner_subdivision_id = ?')
    params.push(filters.ownerSubdivisionId)
  }

  const limit = Math.min(Math.max(filters.limit ?? 40, 1), 100)

  const rows = await query<SearchRow[]>(
    `SELECT a.id, a.space_id, s.slug AS space_slug, s.title AS space_title,
            a.slug, a.title, a.summary, a.content_text
     FROM wiki_articles a
     JOIN wiki_spaces s ON s.id = a.space_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.updated_at DESC
     LIMIT 200`,
    params,
  )

  return filterVisibleArticles(index, subjects, rows)
    .slice(0, limit)
    .map(row => ({
      id: Number(row.id),
      slug: row.slug,
      spaceId: Number(row.space_id),
      spaceSlug: row.space_slug,
      spaceTitle: row.space_title,
      title: row.title,
      summary: row.summary,
      snippet: buildSnippet(row.content_text, hasTerm ? term : ''),
    }))
}
