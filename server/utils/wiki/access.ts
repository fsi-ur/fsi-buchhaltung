import type { H3Event } from 'h3'
import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import type { User } from '~/types/user'
import type {
  WikiAccessGrant,
  WikiAccessLevel,
  WikiEffectiveLevel,
  WikiScopeType,
} from '~/types/wiki'
import { appTodayLocalDate } from '~/server/utils/time'
import { getUserSubdivisionPermissions } from '~/server/utils/subdivisionLeadership'
import type { SubdivisionPermissionKey } from '~/config/subdivisionPermissions'

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
  /**
   * Subdivisions whose wiki the user edits (scoped `subdivision.wiki.edit`): write on every
   * space/article such a subdivision is responsible for, including everything below it.
   */
  wikiEditSubdivisionIds: number[]
  /**
   * Subdivisions whose wiki the user manages (scoped `subdivision.wiki.manage`, or every active
   * subdivision with `subdivisions.leadership.edit`): admin on the same content. Always also listed
   * in `wikiEditSubdivisionIds`.
   */
  wikiManageSubdivisionIds: number[]
}

export interface ArticleNode {
  id: number
  spaceId: number
  parentId: number | null
  status: string
  ownerSubdivisionId: number | null
}

export interface WikiAccessIndex {
  spaceIds: Set<number>
  /** Owner subdivision per space (only spaces that have one). */
  spaceOwnerSubdivisions: Map<number, number>
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
    ...await resolveSubdivisionWikiAccess(user, conn),
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

/** Subdivisions whose wiki this user edits / manages — see `ViewerSubjects`. */
export async function resolveSubdivisionWikiAccess(
  user: User,
  conn?: mariadb.PoolConnection,
): Promise<Pick<ViewerSubjects, 'wikiEditSubdivisionIds' | 'wikiManageSubdivisionIds'>> {
  if (user.permissions.includes('subdivisions.leadership.edit')) {
    const rows = await query<Array<{ id: number }>>('SELECT id FROM subdivisions WHERE is_active = 1', [], conn)
    const ids = rows.map(row => Number(row.id))
    return { wikiEditSubdivisionIds: ids, wikiManageSubdivisionIds: [...ids] }
  }

  // Implied keys are already expanded: subdivision.wiki.manage brings subdivision.wiki.edit along.
  const scoped = Object.entries(await getUserSubdivisionPermissions(Number(user.id), conn))
  const holding = (key: SubdivisionPermissionKey) => scoped.filter(([, keys]) => keys.includes(key)).map(([id]) => Number(id))
  return {
    wikiEditSubdivisionIds: holding('subdivision.wiki.edit'),
    wikiManageSubdivisionIds: holding('subdivision.wiki.manage'),
  }
}

export async function loadAccessIndex(conn?: mariadb.PoolConnection): Promise<WikiAccessIndex> {
  const spaceRows = await query<Array<{ id: number, owner_subdivision_id: number | null }>>(
    'SELECT id, owner_subdivision_id FROM wiki_spaces',
    [],
    conn,
  )
  const articleRows = await query<Array<{
    id: number
    space_id: number
    parent_id: number | null
    status: string
    owner_subdivision_id: number | null
  }>>(
    'SELECT id, space_id, parent_id, status, owner_subdivision_id FROM wiki_articles',
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
      ownerSubdivisionId: row.owner_subdivision_id === null ? null : Number(row.owner_subdivision_id),
    })
  }

  const spaceOwnerSubdivisions = new Map<number, number>()
  for (const row of spaceRows) {
    if (row.owner_subdivision_id !== null) spaceOwnerSubdivisions.set(Number(row.id), Number(row.owner_subdivision_id))
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
    spaceOwnerSubdivisions,
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

/**
 * Owner subdivisions that reach an article: its own, its ancestors' and its space's (nearest first,
 * without duplicates). Ownership works like a grant with `include_descendants`.
 */
export function collectOwnerSubdivisionIds(index: WikiAccessIndex, articleId: number): number[] {
  const article = index.articles.get(articleId)
  if (!article) return []

  const ids: number[] = []
  const add = (id: number | null | undefined) => {
    if (id !== null && id !== undefined && !ids.includes(id)) ids.push(id)
  }

  const seen = new Set<number>()
  let node: ArticleNode | undefined = article
  while (node && !seen.has(node.id)) {
    seen.add(node.id)
    add(node.ownerSubdivisionId)
    node = node.parentId === null ? undefined : index.articles.get(node.parentId)
  }
  add(index.spaceOwnerSubdivisions.get(article.spaceId))

  return ids
}

/** Level the owner subdivisions give: admin if the user manages one's wiki, write if they edit one's. */
function subdivisionLevel(subjects: ViewerSubjects, ownerSubdivisionIds: number[]): WikiEffectiveLevel {
  if (ownerSubdivisionIds.some(id => subjects.wikiManageSubdivisionIds.includes(id))) return 'admin'
  if (ownerSubdivisionIds.some(id => subjects.wikiEditSubdivisionIds.includes(id))) return 'write'
  return 'none'
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
  return maxLevel(
    resolveFromGrants(collectApplicableGrants(index, articleId), subjects),
    subdivisionLevel(subjects, collectOwnerSubdivisionIds(index, articleId)),
  )
}

export function getSpaceEffectiveLevel(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  spaceId: number,
): WikiEffectiveLevel {
  if (!index.spaceIds.has(spaceId)) return 'none'
  const owner = index.spaceOwnerSubdivisions.get(spaceId)
  const fromOwner = owner === undefined ? 'none' : subdivisionLevel(subjects, [owner])
  return maxLevel(fromOwner, resolveFromGrants(index.grantsBySpace.get(spaceId) ?? [], subjects))
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
