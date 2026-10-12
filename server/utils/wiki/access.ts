import type { H3Event } from 'h3'
import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import type { User } from '~/types/user'
import type {
  WikiAccessGrant,
  WikiAccessLevel,
  WikiEffectiveLevel,
  WikiScopeType,
} from '~/types/wiki'
import { appTodayLocalDate } from '~/server/utils/time'

const LEVEL_ORDER: Record<WikiEffectiveLevel, number> = { none: 0, read: 1, write: 2, admin: 3 }

export function levelAtLeast(level: WikiEffectiveLevel, required: WikiEffectiveLevel) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[required]
}

function maxLevel(a: WikiEffectiveLevel, b: WikiEffectiveLevel): WikiEffectiveLevel {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b
}

export interface ViewerSubjects {
  userId: number
  roleIds: number[]
  positionIds: number[]
  subdivisionIds: number[]
  permissionKeys: string[]
  memberId: number | null
  /** Level every scope gets from the global keys alone: `wiki.manage` → admin, `wiki.edit` → write. */
  globalLevel: WikiEffectiveLevel
  /** `wiki.review`: may publish in spaces that require review, anywhere. */
  canReview: boolean
  /** `wiki.manage`: bypasses the ACL and is the only key that may manage spaces, paths and glossary. */
  canManage: boolean
}

export interface ArticleNode {
  id: number
  spaceId: number
  parentId: number | null
  status: string
}

export interface WikiAccessIndex {
  spaceIds: Set<number>
  articles: Map<number, ArticleNode>
  grantsBySpace: Map<number, WikiAccessGrant[]>
  grantsByArticle: Map<number, WikiAccessGrant[]>
}

interface WikiAccessContext {
  subjects: ViewerSubjects
  index: WikiAccessIndex
}

export function resolveGlobalLevel(user: User): WikiEffectiveLevel {
  if (user.permissions.includes('wiki.manage')) return 'admin'
  if (user.permissions.includes('wiki.edit')) return 'write'
  return 'none'
}

export async function resolveViewerSubjects(user: User, conn?: mariadb.PoolConnection): Promise<ViewerSubjects> {
  const roleRows = await query<Array<{ role_id: number }>>(
    'SELECT role_id FROM user_roles WHERE user_id = ?',
    [user.id],
    conn,
  )

  const memberRows = await query<Array<{ id: number }>>(
    'SELECT id FROM members WHERE account = ? LIMIT 1',
    [user.id],
    conn,
  )
  const memberId = memberRows[0] ? Number(memberRows[0].id) : null

  let positionIds: number[] = []
  let subdivisionIds: number[] = []

  if (memberId) {
    const today = await appTodayLocalDate(conn)
    const positionRows = await query<Array<{ position_id: number }>>(
      `SELECT position_id
       FROM member_positions
       WHERE member_id = ? AND (until IS NULL OR until >= ?)`,
      [memberId, today],
      conn,
    )
    positionIds = positionRows.map(row => Number(row.position_id))

    const subdivisionRows = await query<Array<{ subdivision_id: number }>>(
      'SELECT subdivision_id FROM subdivision_members WHERE member_id = ?',
      [memberId],
      conn,
    )
    subdivisionIds = subdivisionRows.map(row => Number(row.subdivision_id))
  }

  return {
    userId: Number(user.id),
    roleIds: roleRows.map(row => Number(row.role_id)),
    positionIds,
    subdivisionIds,
    permissionKeys: [...user.permissions],
    memberId,
    globalLevel: resolveGlobalLevel(user),
    canReview: user.permissions.includes('wiki.review') || user.permissions.includes('wiki.manage'),
    canManage: user.permissions.includes('wiki.manage'),
  }
}

export async function loadAccessIndex(conn?: mariadb.PoolConnection): Promise<WikiAccessIndex> {
  const spaceRows = await query<Array<{ id: number }>>('SELECT id FROM wiki_spaces', [], conn)
  const articleRows = await query<Array<{ id: number, space_id: number, parent_id: number | null, status: string }>>(
    'SELECT id, space_id, parent_id, status FROM wiki_articles',
    [],
    conn,
  )
  const grantRows = await query<WikiAccessGrant[]>(
    `SELECT id, scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key,
            access_level, created_by, created_at
     FROM wiki_access_grants`,
    [],
    conn,
  )

  const articles = new Map<number, ArticleNode>()
  for (const row of articleRows) {
    articles.set(Number(row.id), {
      id: Number(row.id),
      spaceId: Number(row.space_id),
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      status: row.status,
    })
  }

  const grantsBySpace = new Map<number, WikiAccessGrant[]>()
  const grantsByArticle = new Map<number, WikiAccessGrant[]>()

  for (const grant of grantRows) {
    const target = grant.scope_type === 'space' ? grantsBySpace : grantsByArticle
    const scopeId = Number(grant.scope_id)
    const list = target.get(scopeId)
    if (list) list.push(grant)
    else target.set(scopeId, [grant])
  }

  return {
    spaceIds: new Set(spaceRows.map(row => Number(row.id))),
    articles,
    grantsBySpace,
    grantsByArticle,
  }
}

function subjectMatches(grant: WikiAccessGrant, subjects: ViewerSubjects) {
  const subjectId = Number(grant.subject_id)
  switch (grant.subject_type) {
    case 'user': return subjectId === subjects.userId
    case 'role': return subjects.roleIds.includes(subjectId)
    case 'position': return subjects.positionIds.includes(subjectId)
    case 'subdivision': return subjects.subdivisionIds.includes(subjectId)
    case 'permission': return subjects.permissionKeys.includes(grant.subject_key)
    default: return false
  }
}

export function collectApplicableGrants(index: WikiAccessIndex, articleId: number): WikiAccessGrant[] {
  const article = index.articles.get(articleId)
  if (!article) return []

  const grants: WikiAccessGrant[] = [...(index.grantsByArticle.get(articleId) ?? [])]

  const seen = new Set<number>([articleId])
  let parentId = article.parentId
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    for (const grant of index.grantsByArticle.get(parentId) ?? []) {
      if (grant.include_descendants) grants.push(grant)
    }
    parentId = index.articles.get(parentId)?.parentId ?? null
  }

  for (const grant of index.grantsBySpace.get(article.spaceId) ?? []) {
    if (grant.include_descendants) grants.push(grant)
  }

  return grants
}

function resolveFromGrants(grants: WikiAccessGrant[], subjects: ViewerSubjects): WikiEffectiveLevel {
  let level: WikiEffectiveLevel = 'none'
  let restricted = false

  for (const grant of grants) {
    restricted = true
    if (subjectMatches(grant, subjects)) level = maxLevel(level, grant.access_level)
  }

  level = maxLevel(level, subjects.globalLevel)

  if (!restricted) level = maxLevel(level, 'read')

  return level
}

export function getEffectiveLevel(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  articleId: number,
): WikiEffectiveLevel {
  if (!index.articles.has(articleId)) return 'none'
  return resolveFromGrants(collectApplicableGrants(index, articleId), subjects)
}

export function getSpaceEffectiveLevel(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  spaceId: number,
): WikiEffectiveLevel {
  if (!index.spaceIds.has(spaceId)) return 'none'
  return resolveFromGrants(index.grantsBySpace.get(spaceId) ?? [], subjects)
}

export function filterVisibleArticles<T extends { id: number } | { article_id: number }>(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  rows: T[],
  options: { includeUnpublished?: boolean } = {},
): T[] {
  return rows.filter((row) => {
    const articleId = Number('article_id' in row ? row.article_id : row.id)
    const level = getEffectiveLevel(index, subjects, articleId)
    if (level === 'none') return false
    if (options.includeUnpublished && levelAtLeast(level, 'write')) return true
    const status = index.articles.get(articleId)?.status
    if (status === 'published') return true
    return levelAtLeast(level, 'write')
  })
}

export function canReadArticle(index: WikiAccessIndex, subjects: ViewerSubjects, articleId: number) {
  const level = getEffectiveLevel(index, subjects, articleId)
  if (level === 'none') return false
  if (levelAtLeast(level, 'write')) return true
  return index.articles.get(articleId)?.status === 'published'
}

export async function getWikiAccess(
  event: H3Event,
  user: User,
  conn?: mariadb.PoolConnection,
): Promise<WikiAccessContext> {
  const cached = event.context.wikiAccess as WikiAccessContext | undefined
  if (cached) return cached

  const [subjects, index] = await Promise.all([
    resolveViewerSubjects(user, conn),
    loadAccessIndex(conn),
  ])

  const context: WikiAccessContext = { subjects, index }
  event.context.wikiAccess = context
  return context
}

export function invalidateWikiAccess(event: H3Event) {
  delete event.context.wikiAccess
}

type GuardResult<T> = { ok: true, level: WikiAccessLevel } & T | { ok: false, error: string }

const NOT_FOUND = 'Der Artikel wurde nicht gefunden.'
const NO_ACCESS = 'Du hast keine Berechtigung für diesen Bereich des Wikis.'

async function requireArticleLevel(
  event: H3Event,
  user: User,
  articleId: number,
  required: WikiAccessLevel,
  conn?: mariadb.PoolConnection,
): Promise<GuardResult<{ index: WikiAccessIndex, subjects: ViewerSubjects }>> {
  const { index, subjects } = await getWikiAccess(event, user, conn)
  if (!index.articles.has(articleId)) return { ok: false, error: NOT_FOUND }

  const level = getEffectiveLevel(index, subjects, articleId)
  if (level === 'none') return { ok: false, error: NOT_FOUND }
  if (!levelAtLeast(level, required)) return { ok: false, error: NO_ACCESS }

  return { ok: true, level: level as WikiAccessLevel, index, subjects }
}

export function requireArticleWrite(event: H3Event, user: User, articleId: number, conn?: mariadb.PoolConnection) {
  return requireArticleLevel(event, user, articleId, 'write', conn)
}

export function requireArticleAdmin(event: H3Event, user: User, articleId: number, conn?: mariadb.PoolConnection) {
  return requireArticleLevel(event, user, articleId, 'admin', conn)
}

async function requireSpaceLevel(
  event: H3Event,
  user: User,
  spaceId: number,
  required: WikiAccessLevel,
  conn?: mariadb.PoolConnection,
): Promise<GuardResult<{ index: WikiAccessIndex, subjects: ViewerSubjects }>> {
  const { index, subjects } = await getWikiAccess(event, user, conn)
  if (!index.spaceIds.has(spaceId)) return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }

  const level = getSpaceEffectiveLevel(index, subjects, spaceId)
  if (level === 'none') return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }
  if (!levelAtLeast(level, required)) return { ok: false, error: NO_ACCESS }

  return { ok: true, level: level as WikiAccessLevel, index, subjects }
}

export function requireSpaceWrite(event: H3Event, user: User, spaceId: number, conn?: mariadb.PoolConnection) {
  return requireSpaceLevel(event, user, spaceId, 'write', conn)
}

export function requireSpaceAdmin(event: H3Event, user: User, spaceId: number, conn?: mariadb.PoolConnection) {
  return requireSpaceLevel(event, user, spaceId, 'admin', conn)
}

export function requireScopeAdmin(
  event: H3Event,
  user: User,
  scopeType: WikiScopeType,
  scopeId: number,
  conn?: mariadb.PoolConnection,
) {
  return scopeType === 'space'
    ? requireSpaceAdmin(event, user, scopeId, conn)
    : requireArticleAdmin(event, user, scopeId, conn)
}
