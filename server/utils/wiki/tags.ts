import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { slugifyTitle } from '~/server/utils/wiki/articles'
import { canReadArticle, type ViewerSubjects, type WikiAccessIndex } from '~/server/utils/wiki/access'
import type { WikiTag } from '~/types/wiki'

export const MAX_TAG_LABEL_LENGTH = 80
export const MAX_TAG_SLUG_LENGTH = 60
export const TAG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** A single article carrying dozens of tags is a mis-tagged article, not a use case. */
export const MAX_TAGS_PER_ARTICLE = 20

export interface WikiTagInput {
  slug: string
  label: string
}

export interface WikiTagView extends WikiTag {
  /** Only counts articles the viewer may actually read. */
  articleCount: number
}

export function parseTagInput(body: any): { ok: true, input: WikiTagInput } | { ok: false, error: string } {
  const label = String(body?.label ?? '').trim()
  if (!label) return { ok: false, error: 'Bitte eine Bezeichnung angeben.' }
  if (label.length > MAX_TAG_LABEL_LENGTH) {
    return { ok: false, error: `Die Bezeichnung darf höchstens ${MAX_TAG_LABEL_LENGTH} Zeichen lang sein.` }
  }

  // The slug is what the search filter and any future URL uses; derive it when the form leaves it empty.
  const slug = (String(body?.slug ?? '').trim() || slugifyTitle(label)).slice(0, MAX_TAG_SLUG_LENGTH)
  if (!slug) return { ok: false, error: 'Die Bezeichnung muss mindestens einen Buchstaben oder eine Ziffer enthalten.' }
  if (!TAG_SLUG_PATTERN.test(slug)) {
    return { ok: false, error: 'Der Kurzname darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.' }
  }

  return { ok: true, input: { slug, label } }
}

export async function loadTagRows(conn?: mariadb.PoolConnection) {
  return await query<WikiTag[]>('SELECT id, slug, label FROM wiki_tags ORDER BY label', [], conn)
}

async function loadTagArticlePairs(conn?: mariadb.PoolConnection) {
  return await query<Array<{ tag_id: number, article_id: number }>>(
    'SELECT tag_id, article_id FROM wiki_article_tags',
    [],
    conn,
  )
}

/**
 * Tags with their usage count, counting only articles the viewer may read — otherwise the count
 * would quietly report how much restricted content exists behind a tag.
 */
export async function loadVisibleTagViews(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  conn?: mariadb.PoolConnection,
): Promise<WikiTagView[]> {
  const [tags, pairs] = await Promise.all([loadTagRows(conn), loadTagArticlePairs(conn)])

  const counts = new Map<number, number>()
  for (const pair of pairs) {
    const articleId = Number(pair.article_id)
    if (!canReadArticle(index, subjects, articleId)) continue
    const tagId = Number(pair.tag_id)
    counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
  }

  return tags.map(tag => ({
    id: Number(tag.id),
    slug: tag.slug,
    label: tag.label,
    articleCount: counts.get(Number(tag.id)) ?? 0,
  }))
}

export async function isTagSlugTaken(
  slug: string,
  exceptTagId: number | null,
  conn?: mariadb.PoolConnection,
) {
  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_tags WHERE slug = ? AND id <> ? LIMIT 1',
    [slug, exceptTagId ?? 0],
    conn,
  )
  return rows.length > 0
}

export function parseTagIds(value: unknown): { ok: true, tagIds: number[] } | { ok: false, error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'Die Schlagwörter konnten nicht gelesen werden.' }

  const tagIds: number[] = []
  for (const entry of value) {
    const tagId = Number(entry)
    if (!Number.isInteger(tagId) || tagId <= 0) return { ok: false, error: 'Ein Schlagwort wurde nicht gefunden.' }
    if (!tagIds.includes(tagId)) tagIds.push(tagId)
  }

  if (tagIds.length > MAX_TAGS_PER_ARTICLE) {
    return { ok: false, error: `Ein Artikel darf höchstens ${MAX_TAGS_PER_ARTICLE} Schlagwörter haben.` }
  }

  return { ok: true, tagIds }
}

export async function validateTagIds(
  tagIds: number[],
  conn?: mariadb.PoolConnection,
): Promise<string | null> {
  if (!tagIds.length) return null

  const existing = await query<Array<{ id: number }>>(
    `SELECT id FROM wiki_tags WHERE id IN (${tagIds.map(() => '?').join(', ')})`,
    tagIds,
    conn,
  )
  if (existing.length !== tagIds.length) return 'Ein Schlagwort wurde nicht gefunden.'
  return null
}

export async function replaceArticleTags(
  articleId: number,
  tagIds: number[],
  conn: mariadb.PoolConnection,
): Promise<string | null> {
  const validationError = await validateTagIds(tagIds, conn)
  if (validationError) return validationError

  await query('DELETE FROM wiki_article_tags WHERE article_id = ?', [articleId], conn)
  for (const tagId of tagIds) {
    await query('INSERT INTO wiki_article_tags (article_id, tag_id) VALUES (?, ?)', [articleId, tagId], conn)
  }

  return null
}
