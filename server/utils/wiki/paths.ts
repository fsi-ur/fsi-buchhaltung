import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { SLUG_PATTERN } from '~/server/utils/wiki/articles'
import { canReadArticle, type ViewerSubjects, type WikiAccessIndex } from '~/server/utils/wiki/access'
import type {
  WikiPathAdminView,
  WikiPathAudienceView,
  WikiPathInput,
  WikiPathItemView,
  WikiPathView,
} from '~/types/wiki'

export const DEFAULT_PATH_ICON = 'material-symbols:hiking-rounded'

const MAX_ITEMS = 50
const MAX_AUDIENCES = 20
const ICON_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/

interface PathRow {
  id: number
  slug: string
  title: string
  description: string
  icon: string
  position: number
  is_published: number
}

interface ItemRow {
  id: number
  path_id: number
  article_id: number
  position: number
  note: string
  title: string | null
  summary: string | null
  space_title: string | null
  status: string | null
}

interface AudienceRow {
  path_id: number
  position_id: number | null
  subdivision_id: number | null
  position_name: string | null
  subdivision_name: string | null
}

export function validatePathFields(input: Partial<WikiPathInput>): string | null {
  const title = input.title?.trim() ?? ''
  if (!title) return 'Bitte einen Titel angeben.'
  if (title.length > 200) return 'Der Titel darf höchstens 200 Zeichen lang sein.'

  const slug = input.slug?.trim() ?? ''
  if (!slug) return 'Bitte einen Kurznamen (Slug) angeben.'
  if (slug.length > 100) return 'Der Kurzname darf höchstens 100 Zeichen lang sein.'
  if (!SLUG_PATTERN.test(slug)) {
    return 'Der Kurzname darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.'
  }

  if ((input.description ?? '').length > 1000) return 'Die Beschreibung darf höchstens 1000 Zeichen lang sein.'

  const icon = input.icon?.trim() ?? ''
  if (icon.length > 100) return 'Der Icon-Name darf höchstens 100 Zeichen lang sein.'
  // Icons are rendered by `@nuxt/icon` from a collection name — anything else silently renders nothing.
  if (icon && !ICON_PATTERN.test(icon)) {
    return 'Der Icon-Name muss die Form "sammlung:name" haben, zum Beispiel "material-symbols:hiking-rounded".'
  }

  const items = input.items ?? []
  if (items.length > MAX_ITEMS) return `Ein Lernpfad darf höchstens ${MAX_ITEMS} Schritte haben.`

  const seenArticles = new Set<number>()
  for (const item of items) {
    if (!Number.isInteger(item.articleId) || item.articleId <= 0) return 'Bitte für jeden Schritt einen Artikel wählen.'
    if (seenArticles.has(item.articleId)) return 'Ein Artikel darf in einem Lernpfad nur einmal vorkommen.'
    seenArticles.add(item.articleId)
    if ((item.note ?? '').length > 300) return 'Die Notiz eines Schritts darf höchstens 300 Zeichen lang sein.'
  }

  const audiences = input.audiences ?? []
  if (audiences.length > MAX_AUDIENCES) return `Ein Lernpfad darf höchstens ${MAX_AUDIENCES} Zielgruppen haben.`
  for (const audience of audiences) {
    if (audience.positionId === null && audience.subdivisionId === null) {
      return 'Bitte für jede Zielgruppe ein Amt oder eine Untergliederung wählen.'
    }
  }

  return null
}

export function normalizePathInput(raw: any): WikiPathInput {
  return {
    slug: String(raw?.slug ?? '').trim().toLowerCase().slice(0, 100),
    title: String(raw?.title ?? '').trim().slice(0, 200),
    description: String(raw?.description ?? '').trim().slice(0, 1000),
    icon: String(raw?.icon ?? '').trim().slice(0, 100) || DEFAULT_PATH_ICON,
    isPublished: raw?.isPublished === true,
    items: (Array.isArray(raw?.items) ? raw.items : []).map((item: any) => ({
      id: Number.isInteger(Number(item?.id)) && Number(item?.id) > 0 ? Number(item.id) : null,
      articleId: Number(item?.articleId),
      note: String(item?.note ?? '').trim().slice(0, 300),
    })),
    audiences: (Array.isArray(raw?.audiences) ? raw.audiences : []).map((audience: any) => ({
      positionId: audience?.positionId ? Number(audience.positionId) : null,
      subdivisionId: audience?.subdivisionId ? Number(audience.subdivisionId) : null,
    })),
  }
}

export async function isPathSlugTaken(slug: string, exceptPathId: number | null, conn?: mariadb.PoolConnection) {
  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_paths WHERE slug = ? AND id <> ? LIMIT 1',
    [slug, exceptPathId ?? 0],
    conn,
  )
  return rows.length > 0
}

export async function articlesExist(articleIds: number[], conn?: mariadb.PoolConnection) {
  if (!articleIds.length) return true
  const rows = await query<Array<{ id: number }>>(
    `SELECT id FROM wiki_articles WHERE id IN (${articleIds.map(() => '?').join(', ')})`,
    articleIds,
    conn,
  )
  return rows.length === articleIds.length
}

async function loadPathRows(pathId: number | null, conn?: mariadb.PoolConnection) {
  return await query<PathRow[]>(
    `SELECT id, slug, title, description, icon, position, is_published
     FROM wiki_paths
     ${pathId === null ? '' : 'WHERE id = ?'}
     ORDER BY position, title`,
    pathId === null ? [] : [pathId],
    conn,
  )
}

async function loadItemRows(pathIds: number[], conn?: mariadb.PoolConnection) {
  if (!pathIds.length) return []
  return await query<ItemRow[]>(
    `SELECT i.id, i.path_id, i.article_id, i.position, i.note,
            a.title, a.summary, a.status, s.title AS space_title
     FROM wiki_path_items i
     LEFT JOIN wiki_articles a ON a.id = i.article_id
     LEFT JOIN wiki_spaces s ON s.id = a.space_id
     WHERE i.path_id IN (${pathIds.map(() => '?').join(', ')})
     ORDER BY i.path_id, i.position, i.id`,
    pathIds,
    conn,
  )
}

async function loadAudienceRows(pathIds: number[], conn?: mariadb.PoolConnection) {
  if (!pathIds.length) return []
  return await query<AudienceRow[]>(
    `SELECT au.path_id, au.position_id, au.subdivision_id, p.name AS position_name, sd.name AS subdivision_name
     FROM wiki_path_audiences au
     LEFT JOIN positions p ON p.id = au.position_id
     LEFT JOIN subdivisions sd ON sd.id = au.subdivision_id
     WHERE au.path_id IN (${pathIds.map(() => '?').join(', ')})
     ORDER BY au.path_id, au.id`,
    pathIds,
    conn,
  )
}

function toAudienceView(row: AudienceRow): WikiPathAudienceView {
  return {
    positionId: row.position_id === null ? null : Number(row.position_id),
    positionName: row.position_name,
    subdivisionId: row.subdivision_id === null ? null : Number(row.subdivision_id),
    subdivisionName: row.subdivision_name,
  }
}

function isRecommended(audiences: AudienceRow[], subjects: ViewerSubjects) {
  if (!audiences.length) return true
  return audiences.some((audience) => {
    if (audience.position_id !== null && subjects.positionIds.includes(Number(audience.position_id))) return true
    if (audience.subdivision_id !== null && subjects.subdivisionIds.includes(Number(audience.subdivision_id))) return true
    return false
  })
}

export interface LoadPathViewOptions {
  includeUnpublished?: boolean
  pathId?: number
}

export async function loadPathViews(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  options: LoadPathViewOptions = {},
  conn?: mariadb.PoolConnection,
): Promise<WikiPathView[]> {
  const pathRows = (await loadPathRows(options.pathId ?? null, conn))
    .filter(row => options.includeUnpublished || Number(row.is_published) === 1)
  if (!pathRows.length) return []

  const pathIds = pathRows.map(row => Number(row.id))
  const [itemRows, audienceRows] = await Promise.all([
    loadItemRows(pathIds, conn),
    loadAudienceRows(pathIds, conn),
  ])

  const visibleItems = itemRows.filter(row => canReadArticle(index, subjects, Number(row.article_id)))
  const itemIds = visibleItems.map(row => Number(row.id))

  const progressRows = itemIds.length
    ? await query<Array<{ path_item_id: number, completed_at: string }>>(
      `SELECT path_item_id, completed_at
       FROM wiki_path_progress
       WHERE user_id = ? AND path_item_id IN (${itemIds.map(() => '?').join(', ')})`,
      [subjects.userId, ...itemIds],
      conn,
    )
    : []

  const completedAt = new Map(progressRows.map(row => [Number(row.path_item_id), String(row.completed_at)]))

  return pathRows.map((path) => {
    const pathId = Number(path.id)
    const audiences = audienceRows.filter(row => Number(row.path_id) === pathId)

    const items: WikiPathItemView[] = visibleItems
      .filter(row => Number(row.path_id) === pathId)
      .map((row, position) => ({
        id: Number(row.id),
        articleId: Number(row.article_id),
        title: row.title ?? '',
        summary: row.summary ?? '',
        note: row.note,
        spaceTitle: row.space_title ?? '',
        position,
        done: completedAt.has(Number(row.id)),
        completedAt: completedAt.get(Number(row.id)) ?? null,
      }))

    return {
      id: pathId,
      slug: path.slug,
      title: path.title,
      description: path.description,
      icon: path.icon,
      position: Number(path.position),
      isPublished: Number(path.is_published) === 1,
      recommended: isRecommended(audiences, subjects),
      items,
      audiences: audiences.map(toAudienceView),
      doneCount: items.filter(item => item.done).length,
      totalCount: items.length,
      nextItem: items.find(item => !item.done) ?? null,
    }
  })
}

export async function loadPathsForAdmin(conn?: mariadb.PoolConnection): Promise<WikiPathAdminView[]> {
  const pathRows = await loadPathRows(null, conn)
  if (!pathRows.length) return []

  const pathIds = pathRows.map(row => Number(row.id))
  const [itemRows, audienceRows] = await Promise.all([
    loadItemRows(pathIds, conn),
    loadAudienceRows(pathIds, conn),
  ])

  return pathRows.map((path) => {
    const pathId = Number(path.id)
    return {
      id: pathId,
      slug: path.slug,
      title: path.title,
      description: path.description,
      icon: path.icon,
      position: Number(path.position),
      isPublished: Number(path.is_published) === 1,
      items: itemRows
        .filter(row => Number(row.path_id) === pathId)
        .map(row => ({
          id: Number(row.id),
          articleId: Number(row.article_id),
          note: row.note,
          title: row.title ?? '',
          spaceTitle: row.space_title ?? '',
          missing: row.title === null,
        })),
      audiences: audienceRows
        .filter(row => Number(row.path_id) === pathId)
        .map(row => ({
          positionId: row.position_id === null ? null : Number(row.position_id),
          subdivisionId: row.subdivision_id === null ? null : Number(row.subdivision_id),
        })),
    }
  })
}

export async function savePathItems(pathId: number, input: WikiPathInput, conn: mariadb.PoolConnection) {
  const existing = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_path_items WHERE path_id = ?',
    [pathId],
    conn,
  )
  const existingIds = new Set(existing.map(row => Number(row.id)))
  const kept: number[] = []

  for (const [position, item] of input.items.entries()) {
    if (item.id && existingIds.has(Number(item.id))) {
      await query(
        'UPDATE wiki_path_items SET article_id = ?, position = ?, note = ? WHERE id = ? AND path_id = ?',
        [item.articleId, position, item.note, item.id, pathId],
        conn,
      )
      kept.push(Number(item.id))
      continue
    }

    const result = await query<{ insertId: number }>(
      'INSERT INTO wiki_path_items (path_id, article_id, position, note) VALUES (?, ?, ?, ?)',
      [pathId, item.articleId, position, item.note],
      conn,
    )
    kept.push(Number(result.insertId))
  }

  await query(
    kept.length
      ? `DELETE FROM wiki_path_items WHERE path_id = ? AND id NOT IN (${kept.map(() => '?').join(', ')})`
      : 'DELETE FROM wiki_path_items WHERE path_id = ?',
    [pathId, ...kept],
    conn,
  )
}

export async function savePathAudiences(pathId: number, input: WikiPathInput, conn: mariadb.PoolConnection) {
  await query('DELETE FROM wiki_path_audiences WHERE path_id = ?', [pathId], conn)

  for (const audience of input.audiences) {
    await query(
      'INSERT INTO wiki_path_audiences (path_id, position_id, subdivision_id) VALUES (?, ?, ?)',
      [pathId, audience.positionId, audience.subdivisionId],
      conn,
    )
  }
}

export function pickRecommendedPath(paths: WikiPathView[]): WikiPathView | null {
  const pending = paths.filter(path =>
    path.isPublished && path.recommended && path.totalCount > 0 && path.doneCount < path.totalCount)

  if (!pending.length) return null

  return pending.sort((a, b) => {
    const started = Number(b.doneCount > 0) - Number(a.doneCount > 0)
    return started !== 0 ? started : a.position - b.position
  })[0] ?? null
}
