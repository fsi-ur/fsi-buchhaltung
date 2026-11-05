import type * as mariadb from 'mariadb'
import { getAuditedTableMetadata, type AuditedTableMetadata } from '~/server/utils/dbAudit'
import { query } from '~/server/utils/db'

type PrimaryKeyValue = string | number | boolean | null

interface EntityVersionRow {
  id: number
  table_name: string
  record_key: string
  primary_key_json: string
  operation: 'insert' | 'update' | 'delete'
  state: string | null
  changed_by: number | null
  changed_by_username: string | null
  changed_at: string
}

interface PrimaryKeyInput {
  [column: string]: PrimaryKeyValue
}

function quoteIdentifier(value: string) {
  return `\`${value.replace(/`/g, '``')}\``
}

function parseJson<T>(value: string | null) {
  if (!value) return null
  return JSON.parse(value) as T
}

async function getTableMetadata(tableName: string, conn: mariadb.PoolConnection) {
  const metadata = await getAuditedTableMetadata(conn)
  const table = metadata.get(tableName)

  if (!table) {
    throw new Error(`Table ${tableName} is not configured for audit versioning`)
  }

  return table
}

function buildRecordKey(table: AuditedTableMetadata, primaryKey: PrimaryKeyInput) {
  return table.primaryKeyColumns
    .map((column) => `${column}=${String(primaryKey[column] ?? 'null')}`)
    .join('&')
}

function buildWhereClause(table: AuditedTableMetadata, primaryKey: PrimaryKeyInput) {
  const clauses = table.primaryKeyColumns.map((column) => `${quoteIdentifier(column)} <=> ?`)
  const values = table.primaryKeyColumns.map((column) => primaryKey[column] ?? null)

  return {
    sql: clauses.join(' AND '),
    values,
  }
}

function buildUpsertStatement(table: AuditedTableMetadata, state: Record<string, any>) {
  const columns = table.columns.filter((column) => Object.prototype.hasOwnProperty.call(state, column))
  if (!columns.length) {
    throw new Error(`No restorable columns found for ${table.name}`)
  }

  const assignments = columns
    .filter((column) => !table.primaryKeyColumns.includes(column))
    .map((column) => `${quoteIdentifier(column)} = VALUES(${quoteIdentifier(column)})`)

  return {
    sql: `
      INSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
      ON DUPLICATE KEY UPDATE ${assignments.length ? assignments.join(', ') : `${quoteIdentifier(columns[0]!)} = ${quoteIdentifier(columns[0]!)}`}
    `,
    values: columns.map((column) => state[column] ?? null),
  }
}

export async function listEntityVersions(
  tableName: string,
  primaryKey: PrimaryKeyInput,
  conn: mariadb.PoolConnection,
) {
  const table = await getTableMetadata(tableName, conn)
  const recordKey = buildRecordKey(table, primaryKey)

  return query<EntityVersionRow[]>(
    `SELECT id, table_name, record_key, primary_key_json, operation, state, changed_by, changed_by_username, changed_at
     FROM entity_versions
     WHERE table_name = ?
       AND record_key = ?
     ORDER BY id DESC`,
    [tableName, recordKey],
    conn,
  )
}

export async function getEntityStateAt(
  tableName: string,
  primaryKey: PrimaryKeyInput,
  options: {
    versionId?: number
    changedAt?: string
  } = {},
  conn: mariadb.PoolConnection,
) {
  const table = await getTableMetadata(tableName, conn)
  const recordKey = buildRecordKey(table, primaryKey)

  const clauses = [
    `table_name = ?`,
    `record_key = ?`,
  ]
  const params: unknown[] = [tableName, recordKey]

  if (options.versionId) {
    clauses.push(`id <= ?`)
    params.push(options.versionId)
  }

  if (options.changedAt) {
    clauses.push(`changed_at <= ?`)
    params.push(options.changedAt)
  }

  const rows = await query<EntityVersionRow[]>(
    `SELECT id, table_name, record_key, primary_key_json, operation, state, changed_by, changed_by_username, changed_at
     FROM entity_versions
     WHERE ${clauses.join(' AND ')}
     ORDER BY id DESC
     LIMIT 1`,
    params,
    conn,
  )

  const version = rows[0]
  if (!version) return null
  if (version.operation === 'delete') return null
  return parseJson<Record<string, any>>(version.state)
}

export async function restoreEntityState(
  tableName: string,
  primaryKey: PrimaryKeyInput,
  options: {
    versionId?: number
    changedAt?: string
  } = {},
  conn: mariadb.PoolConnection,
) {
  const table = await getTableMetadata(tableName, conn)
  const targetState = await getEntityStateAt(tableName, primaryKey, options, conn)

  if (targetState === null) {
    const where = buildWhereClause(table, primaryKey)
    await query(
      `DELETE FROM ${quoteIdentifier(table.name)}
       WHERE ${where.sql}`,
      where.values,
      conn,
    )
    return { ok: true as const, restored: false as const }
  }

  const statement = buildUpsertStatement(table, targetState)
  await query(statement.sql, statement.values, conn)

  return { ok: true as const, restored: true as const, state: targetState }
}

export function parseVersionRecord<T = Record<string, any>>(row: Pick<EntityVersionRow, 'state' | 'primary_key_json' | 'operation'>) {
  return {
    primaryKey: parseJson<PrimaryKeyInput>(row.primary_key_json),
    operation: row.operation,
    state: parseJson<T>(row.state),
  }
}
