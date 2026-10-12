import type mariadb from 'mariadb'
import type { User } from '~/types/user'

type AuditActor =
  | Pick<User, 'id' | 'username'>
  | { id: number | null, username?: string | null }
  | number
  | null
  | undefined

interface DatabaseNameRow {
  db_name: string | null
}

interface TableColumnRow {
  TABLE_NAME: string
  COLUMN_NAME: string
  ORDINAL_POSITION: number
  DATA_TYPE: string
}

interface TablePrimaryKeyRow {
  TABLE_NAME: string
  COLUMN_NAME: string
  ORDINAL_POSITION: number
}

export interface AuditedTableMetadata {
  name: string
  columns: string[]
  primaryKeyColumns: string[]
  timestampColumns: string[]
}

const EXCLUDED_AUDIT_TABLES = new Set([
  'entity_versions',
  'sessions',
])

let metadataPromise: Promise<Map<string, AuditedTableMetadata>> | null = null

function normalizeAuditActor(actor: AuditActor) {
  if (actor === null || actor === undefined) {
    return { id: null, username: null }
  }

  if (typeof actor === 'number') {
    return { id: Number.isFinite(actor) ? actor : null, username: null }
  }

  return {
    id: actor.id ?? null,
    username: actor.username?.trim() || null,
  }
}

async function getCurrentDatabaseName(conn: mariadb.PoolConnection) {
  const rows = await conn.query<DatabaseNameRow[]>(`SELECT DATABASE() AS db_name`)
  const databaseName = rows[0]?.db_name?.trim()

  if (!databaseName) {
    throw new Error('Failed to resolve current database name for audit setup')
  }

  return databaseName
}

async function loadAuditedTableMetadata(conn: mariadb.PoolConnection) {
  const databaseName = await getCurrentDatabaseName(conn)

  const [columnRows, primaryKeyRows] = await Promise.all([
    conn.query<TableColumnRow[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC`,
      [databaseName],
    ),
    conn.query<TablePrimaryKeyRow[]>(
      `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.ORDINAL_POSITION
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND kcu.TABLE_NAME = tc.TABLE_NAME
        AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
       WHERE tc.TABLE_SCHEMA = ?
         AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
       ORDER BY kcu.TABLE_NAME ASC, kcu.ORDINAL_POSITION ASC`,
      [databaseName],
    ),
  ])

  const metadata = new Map<string, AuditedTableMetadata>()

  for (const row of columnRows) {
    if (EXCLUDED_AUDIT_TABLES.has(row.TABLE_NAME)) continue

    const table = metadata.get(row.TABLE_NAME) ?? {
      name: row.TABLE_NAME,
      columns: [],
      primaryKeyColumns: [],
      timestampColumns: [],
    }
    table.columns.push(row.COLUMN_NAME)
    if (String(row.DATA_TYPE).toLowerCase() === 'timestamp') table.timestampColumns.push(row.COLUMN_NAME)
    metadata.set(row.TABLE_NAME, table)
  }

  for (const row of primaryKeyRows) {
    const table = metadata.get(row.TABLE_NAME)
    if (!table) continue
    table.primaryKeyColumns.push(row.COLUMN_NAME)
  }

  for (const [tableName, table] of metadata.entries()) {
    if (table.primaryKeyColumns.length > 0) continue
    metadata.delete(tableName)
  }

  return metadata
}

export async function getAuditedTableMetadata(conn: mariadb.PoolConnection) {
  if (!metadataPromise) {
    metadataPromise = loadAuditedTableMetadata(conn)
  }

  return metadataPromise
}

export async function setAuditActor(
  conn: mariadb.PoolConnection,
  actor: AuditActor,
  changeGroupId?: string | null,
) {
  const normalized = normalizeAuditActor(actor)
  await conn.query(
    `SET @audit_user_id = ?, @audit_username = ?, @audit_change_group_id = ?`,
    [normalized.id, normalized.username, changeGroupId ?? null],
  )
}

export async function clearAuditActor(conn: mariadb.PoolConnection) {
  await conn.query(`SET @audit_user_id = NULL, @audit_username = NULL, @audit_change_group_id = NULL`)
}
