import type mariadb from 'mariadb'
import { query, getDbConnection } from '~/server/utils/db'
import { getAuditedTableMetadata, type AuditedTableMetadata } from '~/server/utils/dbAudit'
import {
  AUDIT_TABLES,
  type AuditTableDefinition,
  canViewAuditTable,
  getAuditTableDefinition,
  visibleTablesForUser,
} from '~/server/utils/audit/registry'
import { fieldKind, fieldLabelKey, GLOBALLY_IGNORED_COLUMNS } from '~/server/utils/audit/fields'
import { isRedactedColumn } from '~/server/utils/audit/redaction'
import { AUDIT_FINANCE_TABLES } from '~/server/utils/audit/retention'
import type { User } from '~/types/user'
import { instantToSql, isInstant, sqlTimestampToInstant } from '~/shared/time'

export type AuditOperation = 'insert' | 'update' | 'delete'

export interface AuditChangeField {
  column: string
  labelKey: string | null
  fallbackLabel: string
  kind: ReturnType<typeof fieldKind>
  before: unknown | null
  after: unknown | null
  beforeLabel?: string | null
  afterLabel?: string | null
  redacted?: boolean
}

export interface AuditEntry {
  id: number
  table: string
  entityLabelKey: string
  domain: string
  recordKey: string
  primaryKey: Record<string, unknown>
  operation: AuditOperation
  description: string | null
  fields: AuditChangeField[]
  openPage: { page: string, meta: Record<string, unknown> } | null
  deletedSnapshot?: Record<string, unknown> | null
}

export interface AuditActorInfo {
  id: number | null
  username: string | null
  displayName: string | null
}

export interface AuditGroup {
  key: string
  grouped: boolean
  changedAt: string
  changedBy: AuditActorInfo
  entries: AuditEntry[]
}

export interface AuditFilters {
  from?: string
  to?: string
  /** 'system' filters for changes with no captured actor (background jobs, seed/migration scripts). */
  userIds?: Array<number | 'system'>
  tables?: string[]
  domains?: string[]
  operations?: AuditOperation[]
  search?: string
}

interface RawRow {
  id: number
  table_name: string
  record_key: string
  primary_key_json: string
  operation: AuditOperation
  state: string | null
  changed_by: number | null
  changed_by_username: string | null
  changed_at: string
  change_group_id: string | null
}

function humanizeColumn(column: string) {
  return column
    .replace(/_/g, ' ')
    .replace(/^./, c => c.toUpperCase())
}

function parseJson<T = Record<string, any>>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function groupKeyFor(row: RawRow) {
  if (row.change_group_id) return { key: `g:${row.change_group_id}`, grouped: true }
  return { key: `h:${row.changed_by ?? 'system'}:${row.changed_at}`, grouped: false }
}

async function loadPreviousStates(rows: RawRow[], conn?: mariadb.PoolConnection) {
  const ids = rows.map(r => r.id)
  if (!ids.length) return new Map<number, Record<string, any> | null>()

  const placeholders = ids.map(() => '?').join(', ')
  const prevRows = await query<Array<{ current_id: number, prev_state: string | null, prev_operation: AuditOperation | null }>>(
    `SELECT cur.id AS current_id, prev.state AS prev_state, prev.operation AS prev_operation
     FROM entity_versions cur
     LEFT JOIN entity_versions prev
       ON prev.table_name = cur.table_name
      AND prev.record_key = cur.record_key
      AND prev.id = (
        SELECT MAX(e2.id) FROM entity_versions e2
        WHERE e2.table_name = cur.table_name AND e2.record_key = cur.record_key AND e2.id < cur.id
      )
     WHERE cur.id IN (${placeholders})`,
    ids,
    conn,
  )

  const map = new Map<number, Record<string, any> | null>()
  for (const row of prevRows) {
    if (row.prev_operation === 'delete' || !row.prev_state) {
      map.set(row.current_id, null)
    } else {
      map.set(row.current_id, parseJson(row.prev_state))
    }
  }
  return map
}

async function resolveReferences(entries: AuditEntry[], conn?: mariadb.PoolConnection) {
  const wanted = new Map<string, Set<string | number>>()

  for (const entry of entries) {
    const def = getAuditTableDefinition(entry.table)
    if (!def?.references) continue
    for (const field of entry.fields) {
      if (field.kind !== 'reference') continue
      const ref = def.references[field.column]
      if (!ref) continue
      for (const value of [field.before, field.after]) {
        if (value === null || value === undefined) continue
        if (!wanted.has(ref.table)) wanted.set(ref.table, new Set())
        wanted.get(ref.table)!.add(value as string | number)
      }
    }
  }

  const labelsByTable = new Map<string, Map<string, string>>()

  for (const [table, ids] of wanted.entries()) {
    const idList = Array.from(ids)
    if (!idList.length) continue
    // Reference targets are internal registry-declared tables only, never user input.
    const columns = REFERENCE_LABEL_COLUMNS.get(table) ?? ['id']
    const placeholders = idList.map(() => '?').join(', ')
    const rows = await query<Array<Record<string, any>>>(
      `SELECT id, ${columns.map(c => `\`${c}\``).join(', ')} FROM \`${table}\` WHERE id IN (${placeholders})`,
      idList,
      conn,
    )
    const map = new Map<string, string>()
    for (const row of rows) {
      const label = columns.map(c => row[c]).filter(Boolean).join(' ').trim()
      map.set(String(row.id), label || `#${row.id}`)
    }
    labelsByTable.set(table, map)
  }

  for (const entry of entries) {
    const def = getAuditTableDefinition(entry.table)
    if (!def?.references) continue
    for (const field of entry.fields) {
      if (field.kind !== 'reference') continue
      const ref = def.references[field.column]
      if (!ref) continue
      const map = labelsByTable.get(ref.table)
      if (field.before !== null && field.before !== undefined) {
        field.beforeLabel = map?.get(String(field.before)) ?? `#${field.before}`
      }
      if (field.after !== null && field.after !== undefined) {
        field.afterLabel = map?.get(String(field.after)) ?? `#${field.after}`
      }
    }
  }
}

const REFERENCE_LABEL_COLUMNS = new Map<string, string[]>()

function registerReferenceLabelColumns() {
  if (REFERENCE_LABEL_COLUMNS.size) return
  for (const def of Object.values(AUDIT_TABLES)) {
    if (!def.references) continue
    for (const ref of Object.values(def.references)) {
      REFERENCE_LABEL_COLUMNS.set(ref.table, ref.labelColumns)
    }
  }
}

function buildField(table: string, def: AuditTableDefinition | undefined, column: string, before: unknown, after: unknown): AuditChangeField {
  const value = after !== null && after !== undefined ? after : before
  const kind = fieldKind(table, column, value)
  const redacted = isRedactedColumn(table, column)

  return {
    column,
    labelKey: fieldLabelKey(table, column),
    fallbackLabel: humanizeColumn(column),
    kind,
    before: redacted ? null : before ?? null,
    after: redacted ? null : after ?? null,
    redacted: redacted || undefined,
  }
}

function valuesEqual(a: unknown, b: unknown) {
  if (a === b) return true
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

function markInstants(state: Record<string, any> | null, timestampColumns: string[]) {
  if (!state || !timestampColumns.length) return state
  const marked = { ...state }
  for (const column of timestampColumns) {
    const value = marked[column]
    if (typeof value === 'string') marked[column] = sqlTimestampToInstant(value)
  }
  return marked
}

async function buildEntry(
  row: RawRow,
  rawPreviousState: Record<string, any> | null,
  tableMeta: AuditedTableMetadata | undefined,
): Promise<AuditEntry> {
  const def = getAuditTableDefinition(row.table_name)
  const primaryKeyColumns = tableMeta?.primaryKeyColumns ?? []
  const timestampColumns = tableMeta?.timestampColumns ?? []
  const currentState = markInstants(parseJson(row.state), timestampColumns) ?? {}
  const previousState = markInstants(rawPreviousState, timestampColumns)
  // A single-column surrogate PK (the common `id BIGINT AUTO_INCREMENT` case) is pure noise in a
  // diff. A composite/natural PK (junction tables like user_roles(user_id, role_id)) carries the
  // actual data of the row — those columns must NOT be ignored or the entry would show no fields.
  const ignorablePrimaryKeyColumns = primaryKeyColumns.length === 1 ? primaryKeyColumns : []
  const ignored = new Set([
    ...GLOBALLY_IGNORED_COLUMNS,
    ...(def?.ignoredColumns ?? []),
    ...ignorablePrimaryKeyColumns,
  ])

  const fields: AuditChangeField[] = []

  if (row.operation === 'insert') {
    for (const [column, value] of Object.entries(currentState)) {
      if (ignored.has(column)) continue
      if (value === null || value === undefined || value === '') continue
      fields.push(buildField(row.table_name, def, column, null, value))
    }
  } else if (row.operation === 'update') {
    const columns = new Set([...Object.keys(currentState), ...Object.keys(previousState ?? {})])
    for (const column of columns) {
      if (ignored.has(column)) continue
      const before = previousState?.[column] ?? null
      const after = currentState[column] ?? null
      if (valuesEqual(before, after)) continue
      fields.push(buildField(row.table_name, def, column, before, after))
    }
  }
  // delete: no field list, the last known state is exposed via deletedSnapshot instead.

  const primaryKey = parseJson<Record<string, unknown>>(row.primary_key_json) ?? {}
  const describeSource = row.operation === 'delete' ? currentState : currentState
  const description = def?.describe?.(describeSource) ?? null

  const openPage = def?.openPage && row.operation !== 'delete'
    ? { page: def.openPage.page, meta: { [def.openPage.metaKey]: Object.values(primaryKey)[0] } }
    : null

  return {
    id: row.id,
    table: row.table_name,
    entityLabelKey: def?.labelKey ?? 'audit.entities.unknown',
    domain: def?.domain ?? 'settings',
    recordKey: row.record_key,
    primaryKey,
    operation: row.operation,
    description,
    fields,
    openPage,
    deletedSnapshot: row.operation === 'delete'
      ? Object.fromEntries(Object.entries(currentState).filter(([column]) => !isRedactedColumn(row.table_name, column)))
      : undefined,
  }
}

async function hydrateRows(rows: RawRow[]): Promise<AuditGroup[]> {
  if (!rows.length) return []
  registerReferenceLabelColumns()

  const conn = await getDbConnection()
  let metadata: Map<string, AuditedTableMetadata>
  try {
    metadata = await getAuditedTableMetadata(conn)
  } finally {
    conn.release()
  }

  const previousStates = await loadPreviousStates(rows)

  const entries: AuditEntry[] = []
  for (const row of rows) {
    entries.push(await buildEntry(row, previousStates.get(row.id) ?? null, metadata.get(row.table_name)))
  }

  await resolveReferences(entries)

  // An update whose only DB-level changes are ignored columns (e.g. a wiki article autosave tick
  // that only touches draft content) produces an entry with no visible fields — pure noise, drop it
  // rather than rendering an empty "changed by X" line.
  const entryByRowId = new Map<number, AuditEntry>()
  rows.forEach((row, i) => {
    const entry = entries[i]!
    if (entry.operation === 'update' && entry.fields.length === 0) return
    entryByRowId.set(row.id, entry)
  })

  const groups: AuditGroup[] = []
  const groupIndex = new Map<string, AuditGroup>()

  for (const row of rows) {
    const entry = entryByRowId.get(row.id)
    if (!entry) continue

    const { key, grouped } = groupKeyFor(row)
    let group = groupIndex.get(key)
    if (!group) {
      group = {
        key,
        grouped,
        changedAt: row.changed_at,
        changedBy: {
          id: row.changed_by,
          username: row.changed_by_username,
          displayName: row.changed_by_username,
        },
        entries: [],
      }
      groupIndex.set(key, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }

  return groups
}

function resolveVisibleTables(user: User, filters: Pick<AuditFilters, 'tables' | 'domains'>) {
  let tables = visibleTablesForUser(user)
  if (filters.tables?.length) {
    const wanted = new Set(filters.tables)
    tables = tables.filter(t => wanted.has(t))
  }
  if (filters.domains?.length) {
    const wanted = new Set(filters.domains)
    tables = tables.filter((t) => {
      const def = getAuditTableDefinition(t)
      return def && wanted.has(def.domain)
    })
  }
  return tables
}

function buildAuditFilterClauses(visibleTables: string[], filters: AuditFilters) {
  const clauses = [`table_name IN (${visibleTables.map(() => '?').join(', ')})`]
  const params: unknown[] = [...visibleTables]

  if (filters.from && isInstant(filters.from)) { clauses.push('changed_at >= ?'); params.push(filters.from) }
  if (filters.to && isInstant(filters.to)) { clauses.push('changed_at <= ?'); params.push(filters.to) }
  if (filters.userIds?.length) {
    // "System" is the absence of an actor, so it can't be expressed as an id — it has to be ORed in
    // as an IS NULL check alongside the id list.
    const ids = filters.userIds.filter((id): id is number => id !== 'system')
    const parts: string[] = []
    if (ids.length) { parts.push(`changed_by IN (${ids.map(() => '?').join(', ')})`); params.push(...ids) }
    if (filters.userIds.includes('system')) parts.push('changed_by IS NULL')
    clauses.push(`(${parts.join(' OR ')})`)
  }
  if (filters.operations?.length) {
    clauses.push(`operation IN (${filters.operations.map(() => '?').join(', ')})`)
    params.push(...filters.operations)
  }
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`
    clauses.push('(record_key LIKE ? OR changed_by_username LIKE ? OR state LIKE ?)')
    params.push(term, term, term)
  }

  return { sql: clauses.join(' AND '), params }
}

/**
 * Pages by change-group ("one save operation"), not by row, so a group is never split across a
 * page boundary. Groups are ordered by their own newest row (MAX(id)).
 *
 * The candidate row set for query A is filtered by the base filters only — NOT by the cursor — and
 * the cursor is applied as a HAVING on the aggregated MAX(id) instead. Filtering individual rows by
 * "id < cursor" before grouping would be wrong: a group whose newest row was already shown on an
 * earlier page can still have older member rows with id < cursor, and those would make the same
 * group reappear (partially) on this page, duplicating it. Grouping over the full filtered set and
 * only then excluding groups whose MAX(id) is already past the cursor avoids that.
 */
export async function listAuditGroups(
  user: User,
  filters: AuditFilters,
  pagination: { before?: number, limit?: number },
) {
  const visibleTables = resolveVisibleTables(user, filters)
  if (!visibleTables.length) return { ok: true as const, groups: [] as AuditGroup[], nextCursor: null as number | null }

  const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 100)
  const { sql: filterSql, params: filterParams } = buildAuditFilterClauses(visibleTables, filters)

  const havingSql = pagination.before !== undefined ? ` HAVING MAX(id) < ?` : ''
  const havingParams = pagination.before !== undefined ? [pagination.before] : []

  // Over-fetch by one group: whether that extra row exists is what actually tells us there's a next
  // page. Using `groupRows.length === limit` instead is an off-by-one — when the true group count is
  // an exact multiple of `limit`, that check reports "more" even though the next page comes back
  // empty, leaving the "load more" button visibly dead on its last click.
  const overFetchedRows = await query<Array<{ change_group_id: string | null, changed_by: number | null, changed_at: string, max_id: number }>>(
    `SELECT change_group_id, changed_by, changed_at, MAX(id) AS max_id
     FROM entity_versions
     WHERE ${filterSql}
     GROUP BY COALESCE(change_group_id, CONCAT('h:', COALESCE(changed_by, -1), ':', changed_at))${havingSql}
     ORDER BY max_id DESC
     LIMIT ${limit + 1}`,
    [...filterParams, ...havingParams],
  )

  const hasNextPage = overFetchedRows.length > limit
  const groupRows = overFetchedRows.slice(0, limit)

  if (!groupRows.length) return { ok: true as const, groups: [] as AuditGroup[], nextCursor: null }

  const realGroupIds = groupRows.filter(g => g.change_group_id).map(g => g.change_group_id!)
  const syntheticPairs = groupRows.filter(g => !g.change_group_id).map(g => [g.changed_by, g.changed_at] as const)

  const membershipClauses: string[] = []
  const membershipParams: unknown[] = []
  if (realGroupIds.length) {
    membershipClauses.push(`change_group_id IN (${realGroupIds.map(() => '?').join(', ')})`)
    membershipParams.push(...realGroupIds)
  }
  if (syntheticPairs.length) {
    // `changed_by` is NULL for system-initiated writes (background dispatch, seed/migration
    // scripts) that never ran inside withAuditTransaction. A plain `(changed_by, changed_at) IN
    // (...)` tuple match never matches those rows — `NULL = NULL` is never true in SQL — so the
    // group would be found by the grouping query above but come back with zero member rows here,
    // silently vanishing instead of showing as a "System" change. `<=>` is NULL-safe equality.
    const pairClauses = syntheticPairs.map(() => `(changed_by <=> ? AND changed_at = ?)`)
    membershipClauses.push(`(change_group_id IS NULL AND (${pairClauses.join(' OR ')}))`)
    for (const [by, at] of syntheticPairs) membershipParams.push(by, at)
  }

  const rows = await query<RawRow[]>(
    `SELECT id, table_name, record_key, primary_key_json, operation, state, changed_by, changed_by_username, changed_at, change_group_id
     FROM entity_versions
     WHERE ${filterSql} AND (${membershipClauses.join(' OR ')})
     ORDER BY id DESC`,
    [...filterParams, ...membershipParams],
  )

  const nextCursor = hasNextPage ? groupRows[groupRows.length - 1]!.max_id : null
  const groups = await hydrateRows(rows)

  return { ok: true as const, groups, nextCursor }
}

export async function getRecordAuditGroups(
  user: User,
  table: string,
  primaryKey: Record<string, unknown>,
  options: { includeChildren?: boolean } = {},
) {
  const def = getAuditTableDefinition(table)
  if (!def) return { ok: true as const, groups: [] as AuditGroup[] }
  if (!canViewAuditTable(user, table)) return { ok: false as const, error: 'Not authorized' }

  const conn = await getDbConnection()
  let recordKey: string
  try {
    const metadata = await getAuditedTableMetadata(conn)
    const tableMeta = metadata.get(table)
    if (!tableMeta) return { ok: true as const, groups: [] as AuditGroup[] }
    recordKey = tableMeta.primaryKeyColumns
      .map(column => `${column}=${String(primaryKey[column] ?? 'null')}`)
      .join('&')
  } finally {
    conn.release()
  }

  const includeChildren = options.includeChildren ?? true
  const tablesToQuery = [table]
  if (includeChildren) {
    for (const [childTable, childDef] of Object.entries(AUDIT_TABLES)) {
      if (childDef.parent?.table !== table) continue
      // A child table carries its own viewPermissions/restricted flags: seeing the parent record is
      // not permission to see everything hanging off it (e.g. members.view must not expose
      // member_pending_field_changes, which needs members.approveChanges).
      if (!canViewAuditTable(user, childTable)) continue
      tablesToQuery.push(childTable)
    }
  }

  // Child rows are matched by foreign key value embedded in their own state, not the parent's
  // record_key, so each child table needs its own lookup.
  const rowSets = await Promise.all(tablesToQuery.map(async (t) => {
    if (t === table) {
      return query<RawRow[]>(
        `SELECT id, table_name, record_key, primary_key_json, operation, state, changed_by, changed_by_username, changed_at, change_group_id
         FROM entity_versions WHERE table_name = ? AND record_key = ? ORDER BY id DESC LIMIT 500`,
        [table, recordKey],
      )
    }

    const childDef = getAuditTableDefinition(t)!
    const parentId = Object.values(primaryKey)[0]
    return query<RawRow[]>(
      `SELECT id, table_name, record_key, primary_key_json, operation, state, changed_by, changed_by_username, changed_at, change_group_id
       FROM entity_versions
       WHERE table_name = ?
         AND JSON_EXTRACT(state, ?) = ?
       ORDER BY id DESC LIMIT 500`,
      [t, `$.${childDef.parent!.foreignKey}`, parentId],
    )
  }))

  const rows = rowSets.flat().sort((a, b) => b.id - a.id)
  const groups = await hydrateRows(rows)

  return { ok: true as const, groups }
}

const SCOPE_COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

interface ScopedTableSpec {
  table: string
  /** Column matched against the parentId. Defaults to the registered `parent.foreignKey`. */
  scopeColumn: string
  /**
   * Set when `scopeColumn` points at an intermediate table rather than at the parent record itself
   * (e.g. event_shift_members.shift_id → event_shift_slots.event_id). `column` is the intermediate
   * table's own column holding the parentId; its primary key must be `id`.
   */
  via?: { table: string, column: string }
  /** Additional constant equality filters, needed for polymorphic scopes (entity_type, scope_type). */
  literals: Array<[string, string]>
}

/**
 * Parses a scope spec of the form `table[:scopeColumn][>viaTable:viaColumn][;column=value]...`:
 *   `wiki_checklists`                                     → parent.foreignKey = parentId
 *   `wiki_articles:id`                                    → the article's own row
 *   `file_attachments:entity_id;entity_type=wiki_article` → polymorphic attachment scope
 *   `event_shift_members>event_shift_slots:event_id`      → two hops: shift_id → slot → event
 * Returns null for anything malformed or not registered — callers skip those silently rather than
 * failing the whole request, so a button may list a table the current user may not see.
 */
export function parseScopedTableSpec(raw: string): ScopedTableSpec | null {
  const [head, ...literalParts] = raw.split(';')
  const [left, viaPart] = String(head).split('>')
  const [table, explicitColumn] = String(left).split(':')
  if (!table) return null

  const def = getAuditTableDefinition(table)
  if (!def) return null

  const scopeColumn = explicitColumn || def.parent?.foreignKey
  if (!scopeColumn || !SCOPE_COLUMN_PATTERN.test(scopeColumn)) return null

  let via: ScopedTableSpec['via']
  if (viaPart !== undefined) {
    const [viaTable, viaColumn] = viaPart.split(':')
    if (!viaTable || !viaColumn) return null
    // Whitelisted through the registry, so the table name is safe to use as an identifier.
    if (!getAuditTableDefinition(viaTable)) return null
    if (!SCOPE_COLUMN_PATTERN.test(viaColumn)) return null
    via = { table: viaTable, column: viaColumn }
  }

  const literals: Array<[string, string]> = []
  for (const part of literalParts) {
    const index = part.indexOf('=')
    if (index <= 0) return null
    const column = part.slice(0, index)
    if (!SCOPE_COLUMN_PATTERN.test(column)) return null
    literals.push([column, part.slice(index + 1)])
  }

  return { table, scopeColumn, via, literals }
}

/**
 * Ids of the intermediate rows belonging to `parentId`, for a two-hop scope. Both the live table
 * and the audit trail are consulted: the live table alone would miss a deleted intermediate row
 * (whose children's history is exactly what you still want to see), the audit trail alone would
 * miss rows created before this table was audited.
 */
async function resolveViaIds(via: { table: string, column: string }, parentId: number): Promise<number[]> {
  const [liveRows, auditRows] = await Promise.all([
    query<Array<{ id: number }>>(
      `SELECT id FROM \`${via.table}\` WHERE \`${via.column}\` = ? LIMIT 2000`,
      [parentId],
    ),
    query<Array<{ via_id: number | null }>>(
      `SELECT DISTINCT JSON_EXTRACT(state, '$.id') AS via_id
       FROM entity_versions
       WHERE table_name = ?
         AND JSON_EXTRACT(state, ?) = ?
       LIMIT 2000`,
      [via.table, `$.${via.column}`, parentId],
    ),
  ])

  const ids = new Set<number>()
  for (const row of liveRows) ids.add(Number(row.id))
  for (const row of auditRows) {
    if (row.via_id === null || row.via_id === undefined) continue
    const id = Number(row.via_id)
    if (Number.isFinite(id)) ids.add(id)
  }
  return Array.from(ids)
}

/**
 * History for a section of a record's data (e.g. "just this event's shift slots", "just this
 * article's attachments") rather than the record's full combined history. Powers the per-section
 * history buttons in the events planner and the wiki editor: each tab/section shows exactly the
 * rows belonging to it for the current parent record.
 *
 * Tables the user may not view are skipped rather than rejected — the caller lists what the section
 * touches, the registry decides what is visible.
 */
export async function getScopedAuditGroups(user: User, tables: string[], parentId: number) {
  const specs = tables
    .map(parseScopedTableSpec)
    .filter((spec): spec is ScopedTableSpec => spec !== null
      && canViewAuditTable(user, spec.table)
      // Resolving the hop reads the intermediate table, so it needs to be visible as well.
      && (!spec.via || canViewAuditTable(user, spec.via.table)))

  if (!specs.length) return { ok: true as const, groups: [] as AuditGroup[] }

  const rowSets = await Promise.all(specs.map(async (spec) => {
    const clauses = ['table_name = ?']
    const params: unknown[] = [spec.table]

    if (spec.via) {
      const viaIds = await resolveViaIds(spec.via, parentId)
      if (!viaIds.length) return []
      clauses.push(`JSON_EXTRACT(state, ?) IN (${viaIds.map(() => '?').join(', ')})`)
      params.push(`$.${spec.scopeColumn}`, ...viaIds)
    } else {
      clauses.push('JSON_EXTRACT(state, ?) = ?')
      params.push(`$.${spec.scopeColumn}`, parentId)
    }

    for (const [column, value] of spec.literals) {
      clauses.push('JSON_UNQUOTE(JSON_EXTRACT(state, ?)) = ?')
      params.push(`$.${column}`, value)
    }

    return query<RawRow[]>(
      `SELECT id, table_name, record_key, primary_key_json, operation, state, changed_by, changed_by_username, changed_at, change_group_id
       FROM entity_versions
       WHERE ${clauses.join(' AND ')}
       ORDER BY id DESC LIMIT 500`,
      params,
    )
  }))

  const rows = rowSets.flat().sort((a, b) => b.id - a.id)
  const groups = await hydrateRows(rows)

  return { ok: true as const, groups }
}

export interface AuditFilterOptions {
  domains: Array<{ key: string, tables: string[] }>
  tables: Array<{ table: string, labelKey: string, domain: string }>
  actors: Array<{ id: number | null, username: string | null }>
}

export async function getAuditFilterOptions(user: User): Promise<AuditFilterOptions> {
  const visibleTables = visibleTablesForUser(user)
  const domainMap = new Map<string, string[]>()
  const tableOptions: AuditFilterOptions['tables'] = []
  for (const table of visibleTables) {
    const def = getAuditTableDefinition(table)
    if (!def) continue
    if (!domainMap.has(def.domain)) domainMap.set(def.domain, [])
    domainMap.get(def.domain)!.push(table)
    tableOptions.push({ table, labelKey: def.labelKey, domain: def.domain })
  }

  if (!visibleTables.length) return { domains: [], tables: [], actors: [] }

  // Grouped by id (not by the raw (changed_by, changed_by_username) pair) so a single person shows
  // up once even if old rows captured a different or missing username snapshot than newer ones —
  // e.g. rows written before a caller passed the actor's username through, or a later rename. The
  // live `users.username` wins when the account still exists; a historical snapshot is the fallback
  // for a deleted account, and NULL id is the one true "no actor" (system) bucket.
  const actors = await query<Array<{ id: number | null, username: string | null }>>(
    `SELECT ev.changed_by AS id, COALESCE(u.username, MAX(ev.changed_by_username)) AS username
     FROM entity_versions ev
     LEFT JOIN users u ON u.id = ev.changed_by
     WHERE ev.table_name IN (${visibleTables.map(() => '?').join(', ')})
     GROUP BY ev.changed_by
     ORDER BY username ASC
     LIMIT 500`,
    visibleTables,
  )

  return {
    domains: Array.from(domainMap.entries()).map(([key, tables]) => ({ key, tables })),
    tables: tableOptions,
    actors,
  }
}

/**
 * Deletes old entity_versions rows in batches so no single giant transaction is created, always
 * keeping the oldest `insert` row per record so creation history is never lost. Finance tables use
 * a separate (typically longer, often unlimited) retention window because financial records are
 * subject to retention obligations.
 */
export async function pruneAuditLog(options: { retentionDays: number, financeRetentionDays: number }) {
  const financeTables = AUDIT_FINANCE_TABLES
  const now = new Date()
  let totalDeleted = 0

  async function pruneWithCutoff(cutoffDays: number, tableFilter: 'finance' | 'nonFinance') {
    if (cutoffDays <= 0) return
    if (tableFilter === 'finance' && !financeTables.length) return

    const cutoffStr = instantToSql(new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000))

    const tableClause = !financeTables.length
      ? '1=1'
      : tableFilter === 'finance'
        ? `table_name IN (${financeTables.map(() => '?').join(', ')})`
        : `table_name NOT IN (${financeTables.map(() => '?').join(', ')})`

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Single-table DELETE (required for LIMIT) with a derived-table subquery: MariaDB forbids
      // selecting from the table being deleted from directly, but wrapping it in a derived table
      // (the `keep_insert` alias) is the standard workaround.
      const result = await query<{ affectedRows: number }>(
        `DELETE FROM entity_versions
         WHERE changed_at < ?
           AND ${tableClause}
           AND id <> (
             SELECT min_id FROM (
               SELECT MIN(e2.id) AS min_id FROM entity_versions e2
               WHERE e2.table_name = entity_versions.table_name
                 AND e2.record_key = entity_versions.record_key
                 AND e2.operation = 'insert'
             ) AS keep_insert
           )
         LIMIT 5000`,
        [cutoffStr, ...financeTables],
      )
      const affected = (result as any).affectedRows ?? 0
      totalDeleted += affected
      if (affected < 5000) break
    }
  }

  await pruneWithCutoff(options.retentionDays, 'nonFinance')
  await pruneWithCutoff(options.financeRetentionDays, 'finance')

  return { deleted: totalDeleted }
}
