import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { PERMISSIONS } from '~/config/permissions'
import {
  collectApplicableGrants,
  getEffectiveLevel,
  getSpaceEffectiveLevel,
  levelAtLeast,
  type ViewerSubjects,
  type WikiAccessIndex,
} from '~/server/utils/wiki/access'
import type {
  WikiAccessGrant,
  WikiAccessLevel,
  WikiGrantSubjectType,
  WikiScopeType,
} from '~/types/wiki'

const PERMISSION_KEYS = new Set(PERMISSIONS.map(permission => permission.key as string))
const SUBJECT_TYPES: WikiGrantSubjectType[] = ['user', 'role', 'position', 'subdivision', 'permission']
const LEVELS: WikiAccessLevel[] = ['read', 'write', 'admin']

export interface GrantView extends WikiAccessGrant {
  subject_label: string
  inherited: boolean
  origin_label: string
  owner_derived: boolean
}

export interface GrantInput {
  scopeType: WikiScopeType
  scopeId: number
  subjectType: WikiGrantSubjectType
  subjectId: number
  subjectKey: string
  accessLevel: WikiAccessLevel
  includeDescendants: boolean
}

export function parseGrantInput(body: any): GrantInput | string {
  const scopeType = body?.scopeType
  if (scopeType !== 'space' && scopeType !== 'article') return 'Ungültiger Geltungsbereich.'

  const scopeId = Number(body?.scopeId)
  if (!Number.isInteger(scopeId) || scopeId <= 0) return 'Ungültiger Geltungsbereich.'

  const subjectType = body?.subjectType
  if (!SUBJECT_TYPES.includes(subjectType)) return 'Bitte eine gültige Art von Berechtigten wählen.'

  const accessLevel = body?.accessLevel
  if (!LEVELS.includes(accessLevel)) return 'Bitte eine gültige Zugriffsstufe wählen.'

  let subjectId = 0
  let subjectKey = ''

  if (subjectType === 'permission') {
    subjectKey = String(body?.subjectKey ?? '')
    if (!PERMISSION_KEYS.has(subjectKey)) return 'Diese Berechtigung gibt es nicht.'
  } else {
    subjectId = Number(body?.subjectId)
    if (!Number.isInteger(subjectId) || subjectId <= 0) return 'Bitte auswählen, wer die Berechtigung bekommt.'
  }

  return {
    scopeType,
    scopeId,
    subjectType,
    subjectId,
    subjectKey,
    accessLevel,
    includeDescendants: body?.includeDescendants !== false,
  }
}

export async function subjectExists(input: GrantInput, conn?: mariadb.PoolConnection) {
  if (input.subjectType === 'permission') return PERMISSION_KEYS.has(input.subjectKey)

  const table = input.subjectType === 'user'
    ? 'users'
    : input.subjectType === 'role'
      ? 'roles'
      : input.subjectType === 'position'
        ? 'positions'
        : 'subdivisions'

  const rows = await query<Array<{ id: number }>>(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`, [input.subjectId], conn)
  return rows.length > 0
}

async function loadSubjectLabels(grants: WikiAccessGrant[], conn?: mariadb.PoolConnection) {
  const labels = new Map<string, string>()

  const byType: Record<string, number[]> = { user: [], role: [], position: [], subdivision: [] }
  for (const grant of grants) {
    if (grant.subject_type === 'permission') continue
    byType[grant.subject_type]?.push(Number(grant.subject_id))
  }

  const sources: Array<[string, string, string]> = [
    ['user', 'users', 'username'],
    ['role', 'roles', 'name'],
    ['position', 'positions', 'name'],
    ['subdivision', 'subdivisions', 'name'],
  ]

  for (const [type, table, column] of sources) {
    const ids = [...new Set(byType[type])]
    if (!ids.length) continue
    const rows = await query<Array<{ id: number, label: string }>>(
      `SELECT id, ${column} AS label FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
      conn,
    )
    for (const row of rows) labels.set(`${type}:${Number(row.id)}`, row.label)
  }

  return labels
}

export interface ScopeOwner {
  ownerPositionId: number | null
  ownerSubdivisionId: number | null
}

export async function loadScopeOwner(
  scopeType: WikiScopeType,
  scopeId: number,
  conn?: mariadb.PoolConnection,
): Promise<ScopeOwner> {
  const table = scopeType === 'space' ? 'wiki_spaces' : 'wiki_articles'
  const rows = await query<Array<{ owner_position_id: number | null, owner_subdivision_id: number | null }>>(
    `SELECT owner_position_id, owner_subdivision_id FROM ${table} WHERE id = ? LIMIT 1`,
    [scopeId],
    conn,
  )
  const row = rows[0]
  return {
    ownerPositionId: row?.owner_position_id === null || row?.owner_position_id === undefined ? null : Number(row.owner_position_id),
    ownerSubdivisionId: row?.owner_subdivision_id === null || row?.owner_subdivision_id === undefined ? null : Number(row.owner_subdivision_id),
  }
}

export async function applyOwnerGrants(
  scopeType: WikiScopeType,
  scopeId: number,
  owner: ScopeOwner,
  createdBy: number,
  conn: mariadb.PoolConnection,
) {
  const subjects = [
    ['position', owner.ownerPositionId],
    ['subdivision', owner.ownerSubdivisionId],
  ] as const

  for (const [subjectType, subjectId] of subjects) {
    if (!subjectId) continue
    await query(
      `INSERT IGNORE INTO wiki_access_grants
         (scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key, access_level, created_by)
       VALUES (?, ?, 1, ?, ?, '', 'write', ?)`,
      [scopeType, scopeId, subjectType, subjectId, createdBy],
      conn,
    )
  }
}

export function isOwnerDerivedGrant(grant: WikiAccessGrant, owner: ScopeOwner): boolean {
  if (grant.access_level !== 'write' || !grant.include_descendants) return false
  if (grant.subject_type === 'position') return owner.ownerPositionId !== null && Number(grant.subject_id) === owner.ownerPositionId
  if (grant.subject_type === 'subdivision') return owner.ownerSubdivisionId !== null && Number(grant.subject_id) === owner.ownerSubdivisionId
  return false
}

export async function loadScopeGrants(
  index: WikiAccessIndex,
  scopeType: WikiScopeType,
  scopeId: number,
  conn?: mariadb.PoolConnection,
): Promise<GrantView[]> {
  const own = scopeType === 'space'
    ? index.grantsBySpace.get(scopeId) ?? []
    : index.grantsByArticle.get(scopeId) ?? []

  const applicable = scopeType === 'space' ? own : collectApplicableGrants(index, scopeId)
  const ownIds = new Set(own.map(grant => Number(grant.id)))

  const [labels, owner] = await Promise.all([
    loadSubjectLabels(applicable, conn),
    loadScopeOwner(scopeType, scopeId, conn),
  ])

  const spaceTitles = new Map<number, string>()
  const articleTitles = new Map<number, string>()

  const inheritedSpaceIds = [...new Set(applicable.filter(grant => grant.scope_type === 'space' && !ownIds.has(Number(grant.id))).map(grant => Number(grant.scope_id)))]
  const inheritedArticleIds = [...new Set(applicable.filter(grant => grant.scope_type === 'article' && !ownIds.has(Number(grant.id))).map(grant => Number(grant.scope_id)))]

  if (inheritedSpaceIds.length) {
    const rows = await query<Array<{ id: number, title: string }>>(
      `SELECT id, title FROM wiki_spaces WHERE id IN (${inheritedSpaceIds.map(() => '?').join(',')})`,
      inheritedSpaceIds,
      conn,
    )
    for (const row of rows) spaceTitles.set(Number(row.id), row.title)
  }

  if (inheritedArticleIds.length) {
    const rows = await query<Array<{ id: number, title: string }>>(
      `SELECT id, title FROM wiki_articles WHERE id IN (${inheritedArticleIds.map(() => '?').join(',')})`,
      inheritedArticleIds,
      conn,
    )
    for (const row of rows) articleTitles.set(Number(row.id), row.title)
  }

  return applicable.map((grant) => {
    const inherited = !ownIds.has(Number(grant.id))
    const origin = grant.scope_type === 'space'
      ? spaceTitles.get(Number(grant.scope_id)) ?? ''
      : articleTitles.get(Number(grant.scope_id)) ?? ''

    return {
      ...grant,
      id: Number(grant.id),
      scope_id: Number(grant.scope_id),
      subject_id: Number(grant.subject_id),
      include_descendants: Number(grant.include_descendants),
      subject_label: grant.subject_type === 'permission'
        ? grant.subject_key
        : labels.get(`${grant.subject_type}:${Number(grant.subject_id)}`) ?? String(grant.subject_id),
      inherited,
      origin_label: inherited ? origin : '',
      owner_derived: !inherited && isOwnerDerivedGrant(grant, owner),
    }
  })
}

export function scopeEffectiveLevel(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  scopeType: WikiScopeType,
  scopeId: number,
) {
  return scopeType === 'space'
    ? getSpaceEffectiveLevel(index, subjects, scopeId)
    : getEffectiveLevel(index, subjects, scopeId)
}

export function checkNoEscalation(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  input: GrantInput,
): string | null {
  if (subjects.canManage) return null

  const own = scopeEffectiveLevel(index, subjects, input.scopeType, input.scopeId)
  if (!levelAtLeast(own, input.accessLevel)) {
    return 'Du kannst keine höhere Berechtigung vergeben, als du selbst hast.'
  }

  return null
}

export function checkLastAdmin(
  index: WikiAccessIndex,
  subjects: ViewerSubjects,
  grant: WikiAccessGrant,
): string | null {
  if (subjects.canManage) return null
  if (grant.access_level !== 'admin') return null

  const siblings = grant.scope_type === 'space'
    ? index.grantsBySpace.get(Number(grant.scope_id)) ?? []
    : index.grantsByArticle.get(Number(grant.scope_id)) ?? []

  const remainingAdmins = siblings.filter(entry => entry.access_level === 'admin' && Number(entry.id) !== Number(grant.id))
  if (remainingAdmins.length) return null

  return 'Die letzte Verwaltungs-Berechtigung dieses Bereichs kann nur mit der Berechtigung „Wiki verwalten" entfernt werden.'
}

export async function findGrant(grantId: number, conn?: mariadb.PoolConnection) {
  const rows = await query<WikiAccessGrant[]>(
    `SELECT id, scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key,
            access_level, created_by
     FROM wiki_access_grants
     WHERE id = ?
     LIMIT 1`,
    [grantId],
    conn,
  )
  return rows[0] ?? null
}

export async function deleteScopeGrants(
  scopeType: WikiScopeType,
  scopeIds: number[],
  conn?: mariadb.PoolConnection,
) {
  if (!scopeIds.length) return
  await query(
    `DELETE FROM wiki_access_grants
     WHERE scope_type = ? AND scope_id IN (${scopeIds.map(() => '?').join(',')})`,
    [scopeType, ...scopeIds],
    conn,
  )
}

export function collectSubtreeIds(index: WikiAccessIndex, articleId: number) {
  const ids = [articleId]
  const queue = [articleId]

  while (queue.length) {
    const current = queue.shift()!
    for (const node of index.articles.values()) {
      if (node.parentId === current && !ids.includes(node.id)) {
        ids.push(node.id)
        queue.push(node.id)
      }
    }
  }

  return ids
}
