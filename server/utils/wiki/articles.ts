import { loadAttachmentItems, loadAttachmentSelection } from '~/server/utils/attachments'
import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import {
  canReadArticle,
  getEffectiveLevel,
  getSpaceEffectiveLevel,
  levelAtLeast,
  type ViewerSubjects,
  type WikiAccessIndex,
} from '~/server/utils/wiki/access'
import type {
  WikiAccessLevel,
  WikiArticle,
  WikiAttachment,
  WikiBreadcrumb,
  WikiOwner,
  WikiSpace,
  WikiTag,
  WikiTreeArticle,
  WikiTreeSpace,
} from '~/types/wiki'
import type { WikiHeading as WikiHeadingType } from '~/server/utils/wiki/render'

export const MAX_MARKDOWN_LENGTH = 200_000
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

export function slugifyTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[äöüß]/g, char => UMLAUTS[char] ?? char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

export interface ArticleRow extends WikiArticle {}

export async function loadSpaceRows(conn?: mariadb.PoolConnection) {
  return await query<WikiSpace[]>(
    `SELECT id, slug, title, description, icon, position, requires_review, is_archived,
            owner_position_id, owner_subdivision_id
     FROM wiki_spaces
     ORDER BY position, title`,
    [],
    conn,
  )
}

export interface TreeArticleRow {
  id: number
  space_id: number
  parent_id: number | null
  slug: string
  title: string
  summary: string
  icon: string | null
  position: number
  status: WikiTreeArticle['status']
}

export async function loadTreeArticleRows(conn?: mariadb.PoolConnection) {
  return await query<TreeArticleRow[]>(
    `SELECT id, space_id, parent_id, slug, title, summary, icon, position, status
     FROM wiki_articles
     ORDER BY position, title`,
    [],
    conn,
  )
}

export function buildVisibleTree(
  spaces: WikiSpace[],
  articles: TreeArticleRow[],
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  options: { includeDrafts?: boolean, includeArchivedSpaces?: boolean } = {},
): WikiTreeSpace[] {
  const nodesById = new Map<number, WikiTreeArticle>()
  const visible: TreeArticleRow[] = []

  for (const row of articles) {
    const articleId = Number(row.id)
    const level = getEffectiveLevel(index, subjects, articleId)
    if (level === 'none') continue

    const isPublished = row.status === 'published'
    const mayEdit = levelAtLeast(level, 'write')
    if (!isPublished && !(mayEdit && options.includeDrafts)) continue
    if (row.status === 'archived' && !(mayEdit && options.includeDrafts)) continue

    visible.push(row)
    nodesById.set(articleId, {
      id: articleId,
      space_id: Number(row.space_id),
      parent_id: row.parent_id === null ? null : Number(row.parent_id),
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      icon: row.icon,
      position: Number(row.position),
      status: row.status,
      accessLevel: level as WikiAccessLevel,
      children: [],
    })
  }

  const rootsBySpace = new Map<number, WikiTreeArticle[]>()

  for (const row of visible) {
    const node = nodesById.get(Number(row.id))!
    // An article whose parent is hidden is re-rooted rather than dropped: the parent may be a draft
    // the reader cannot see, but this article is published and readable in its own right.
    const parent = node.parent_id === null ? null : nodesById.get(node.parent_id) ?? null
    if (parent) {
      parent.children.push(node)
      continue
    }
    const roots = rootsBySpace.get(node.space_id)
    if (roots) roots.push(node)
    else rootsBySpace.set(node.space_id, [node])
  }

  const result: WikiTreeSpace[] = []

  for (const space of spaces) {
    if (space.is_archived && !options.includeArchivedSpaces) continue

    const spaceId = Number(space.id)
    const level = getSpaceEffectiveLevel(index, subjects, spaceId)
    const articlesOfSpace = rootsBySpace.get(spaceId) ?? []
    if (level === 'none' && !articlesOfSpace.length) continue

    result.push({
      id: spaceId,
      slug: space.slug,
      title: space.title,
      description: space.description,
      icon: space.icon,
      position: Number(space.position),
      requires_review: Number(space.requires_review),
      accessLevel: (level === 'none' ? 'read' : level) as WikiAccessLevel,
      articles: articlesOfSpace,
    })
  }

  return result
}

export function flattenTree(nodes: WikiTreeArticle[], into: WikiTreeArticle[] = []) {
  for (const node of nodes) {
    into.push(node)
    flattenTree(node.children, into)
  }
  return into
}

export function buildBreadcrumbs(
  article: { id: number, space_id: number, parent_id: number | null, slug: string, title: string },
  space: WikiSpace,
  byId: Map<number, TreeArticleRow>,
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
): WikiBreadcrumb[] {
  const chain: WikiBreadcrumb[] = []
  const seen = new Set<number>([Number(article.id)])

  let parentId = article.parent_id === null ? null : Number(article.parent_id)
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    // Never name an ancestor the viewer may not read
    if (canReadArticle(index, subjects, parentId)) {
      chain.unshift({ id: parentId, slug: `${space.slug}/${parent.slug}`, title: parent.title, type: 'article' })
    }
    parentId = parent.parent_id === null ? null : Number(parent.parent_id)
  }

  chain.unshift({ id: Number(space.id), slug: space.slug, title: space.title, type: 'space' })
  return chain
}

export async function loadOwner(
  positionId: number | null,
  subdivisionId: number | null,
  conn?: mariadb.PoolConnection,
): Promise<WikiOwner> {
  const owner: WikiOwner = {
    position_id: positionId,
    position_name: null,
    subdivision_id: subdivisionId,
    subdivision_name: null,
  }

  if (positionId) {
    const rows = await query<Array<{ name: string }>>('SELECT name FROM positions WHERE id = ? LIMIT 1', [positionId], conn)
    owner.position_name = rows[0]?.name ?? null
  }

  if (subdivisionId) {
    const rows = await query<Array<{ name: string }>>('SELECT name FROM subdivisions WHERE id = ? LIMIT 1', [subdivisionId], conn)
    owner.subdivision_name = rows[0]?.name ?? null
  }

  return owner
}

export async function loadTags(articleId: number, conn?: mariadb.PoolConnection) {
  return await query<WikiTag[]>(
    `SELECT t.id, t.slug, t.label
     FROM wiki_article_tags at
     JOIN wiki_tags t ON t.id = at.tag_id
     WHERE at.article_id = ?
     ORDER BY t.label`,
    [articleId],
    conn,
  )
}

export const WIKI_ARTICLE_ENTITY_TYPE = 'wiki_article'

export async function loadAttachmentSelectionForArticle(articleId: number, conn?: mariadb.PoolConnection) {
  return loadAttachmentSelection(WIKI_ARTICLE_ENTITY_TYPE, articleId, conn)
}

export async function loadAttachments(articleId: number, conn?: mariadb.PoolConnection): Promise<WikiAttachment[]> {
  return loadAttachmentItems(await loadAttachmentSelectionForArticle(articleId, conn), conn)
}

const HEADING_TAG = /<h([1-4])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g

export function extractHeadings(html: string | null): WikiHeadingType[] {
  if (!html) return []
  const headings: WikiHeadingType[] = []
  HEADING_TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HEADING_TAG.exec(html)) !== null) {
    const title = (match[3] ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    if (title) headings.push({ level: Number(match[1]), id: match[2] ?? '', title })
  }
  return headings
}

export function isStale(article: Pick<WikiArticle, 'review_interval_days' | 'reviewed_at' | 'published_at'>) {
  if (!article.review_interval_days) return false
  const reference = article.reviewed_at ?? article.published_at
  if (!reference) return false
  const due = new Date(reference).getTime() + article.review_interval_days * 24 * 60 * 60 * 1000
  return Number.isFinite(due) && due < Date.now()
}

export async function trackArticleView(userId: number, articleId: number) {
  try {
    await query(
      `INSERT INTO wiki_article_views (user_id, article_id, view_count)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE view_count = view_count + 1, last_viewed_at = CURRENT_TIMESTAMP`,
      [userId, articleId],
    )
  } catch {
    // Intentionally ignored
  }
}

export interface ArticleValidationInput {
  title: string
  slug: string
  summary?: string
  markdown?: string | null
}

export function validateArticleFields(input: ArticleValidationInput): string | null {
  const title = input.title?.trim() ?? ''
  if (!title) return 'Bitte einen Titel angeben.'
  if (title.length > 200) return 'Der Titel darf höchstens 200 Zeichen lang sein.'

  const slug = input.slug?.trim() ?? ''
  if (!slug) return 'Bitte einen Kurznamen (Slug) angeben.'
  if (slug.length > 120) return 'Der Kurzname darf höchstens 120 Zeichen lang sein.'
  if (!SLUG_PATTERN.test(slug)) {
    return 'Der Kurzname darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.'
  }

  if ((input.summary ?? '').length > 500) return 'Die Kurzbeschreibung darf höchstens 500 Zeichen lang sein.'
  if ((input.markdown ?? '').length > MAX_MARKDOWN_LENGTH) {
    return `Der Artikel darf höchstens ${MAX_MARKDOWN_LENGTH.toLocaleString('de-DE')} Zeichen lang sein.`
  }

  return null
}

export async function isSlugTaken(
  spaceId: number,
  slug: string,
  exceptArticleId: number | null,
  conn?: mariadb.PoolConnection,
) {
  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_articles WHERE space_id = ? AND slug = ? AND id <> ? LIMIT 1',
    [spaceId, slug, exceptArticleId ?? 0],
    conn,
  )
  return rows.length > 0
}

export async function validateParent(
  articleId: number | null,
  spaceId: number,
  parentId: number | null,
  conn?: mariadb.PoolConnection,
): Promise<string | null> {
  if (parentId === null) return null

  const rows = await query<Array<{ id: number, space_id: number, parent_id: number | null }>>(
    'SELECT id, space_id, parent_id FROM wiki_articles',
    [],
    conn,
  )
  const byId = new Map(rows.map(row => [Number(row.id), row]))

  const parent = byId.get(parentId)
  if (!parent) return 'Der übergeordnete Artikel wurde nicht gefunden.'
  if (Number(parent.space_id) !== spaceId) return 'Der übergeordnete Artikel muss im selben Bereich liegen.'
  if (articleId !== null && parentId === articleId) return 'Ein Artikel kann sich nicht selbst übergeordnet sein.'

  if (articleId !== null) {
    const seen = new Set<number>()
    let cursor: number | null = parentId
    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === articleId) {
        return 'Ein Artikel kann nicht unter einen seiner eigenen Unterartikel verschoben werden.'
      }
      seen.add(cursor)
      const node = byId.get(cursor)
      cursor = node?.parent_id === null || node?.parent_id === undefined ? null : Number(node.parent_id)
    }
  }

  return null
}
