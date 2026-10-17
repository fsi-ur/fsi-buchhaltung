import mariadb from 'mariadb'

const {
  DB_HOST = 'buchhaltung-db-local',
  DB_PORT = '3307',
  DB_USER = 'fsi',
  DB_PASSWORD = 'fsi_password',
  DB_NAME = 'fsi_buchhaltung',
  DB_AUDIT_SETUP_USER,
  DB_AUDIT_SETUP_PASSWORD,
  DB_CONN_LIMIT = '2',
} = process.env

const EXCLUDED_AUDIT_TABLES = new Set([
  'entity_versions',
  'sessions',
  // High-churn, low-value wiki state -- auditing it would only bloat entity_versions.
  'wiki_path_progress',
  'wiki_checklist_personal_state',
  'wiki_checklist_run_state',
  'wiki_article_views',
])

// Columns that must not, on their own, make an UPDATE count as a change worth recording. The AFTER
// UPDATE trigger compares OLD/NEW over every *other* column, so a write touching only these writes
// no entity_versions row at all -- the churn never reaches the table, not just the UI.
//
// `updated_at` is excluded everywhere because the audit log never displays it (see
// GLOBALLY_IGNORED_COLUMNS in server/utils/audit/fields.ts): a row whose only change is that
// timestamp would render as an empty "changed by X" entry.
const COMPARISON_IGNORED_COLUMNS = ['updated_at']

// Per table, on top of COMPARISON_IGNORED_COLUMNS. wiki_articles is written every few seconds by
// the editor's autosave, which only ever touches the draft columns; the published content, title,
// status and owner changes that matter still produce entries as usual.
const TABLE_COMPARISON_IGNORED_COLUMNS = new Map([
  ['wiki_articles', ['draft_md', 'draft_updated_at', 'draft_updated_by']],
  // Refreshed by every website request authenticated with the key.
  ['api_keys', ['last_used_at']],
])

function buildComparisonColumns(table) {
  const ignored = new Set([
    ...COMPARISON_IGNORED_COLUMNS,
    ...(TABLE_COMPARISON_IGNORED_COLUMNS.get(table.name) ?? []),
  ])
  const columns = table.columns.filter(column => !ignored.has(column))
  // A table made up entirely of ignored columns would compare as "never changed" -- fall back to
  // the full row rather than silently dropping all of its updates.
  return columns.length ? columns : table.columns
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``
}

function quoteString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function buildJsonObjectExpression(columns, recordSource) {
  const entries = columns.flatMap((column) => [
    quoteString(column),
    `${recordSource}.${quoteIdentifier(column)}`,
  ])

  return `JSON_OBJECT(${entries.join(', ')})`
}

function buildPrimaryKeyJsonExpression(primaryKeyColumns, recordSource) {
  const entries = primaryKeyColumns.flatMap((column) => [
    quoteString(column),
    `${recordSource}.${quoteIdentifier(column)}`,
  ])

  return `JSON_OBJECT(${entries.join(', ')})`
}

function buildRecordKeyExpression(primaryKeyColumns, recordSource) {
  const parts = primaryKeyColumns.map((column) => (
    `CONCAT(${quoteString(`${column}=`)}, COALESCE(CAST(${recordSource}.${quoteIdentifier(column)} AS CHAR), 'null'))`
  ))

  if (parts.length === 1) return parts[0]
  return `CONCAT_WS('&', ${parts.join(', ')})`
}

function buildTriggerName(tableName, operation) {
  return quoteIdentifier(`audit_${tableName}_${operation}`)
}

function buildTriggerNameValue(tableName, operation) {
  return `audit_${tableName}_${operation}`
}

async function getCurrentDatabaseName(conn) {
  const rows = await conn.query('SELECT DATABASE() AS db_name')
  const databaseName = rows[0]?.db_name?.trim()

  if (!databaseName) {
    throw new Error('Failed to resolve current database name for audit setup')
  }

  return databaseName
}

async function loadAuditedTableMetadata(conn, databaseName) {
  const [columnRows, primaryKeyRows] = await Promise.all([
    conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC`,
      [databaseName],
    ),
    conn.query(
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

  const metadata = new Map()

  for (const row of columnRows) {
    if (EXCLUDED_AUDIT_TABLES.has(row.TABLE_NAME)) continue

    const table = metadata.get(row.TABLE_NAME) ?? {
      name: row.TABLE_NAME,
      columns: [],
      primaryKeyColumns: [],
    }
    table.columns.push(row.COLUMN_NAME)
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

async function entityVersionsTableExists(conn, databaseName) {
  const rows = await conn.query(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = 'entity_versions'
     LIMIT 1`,
    [databaseName],
  )

  return Boolean(rows[0]?.table_name)
}

async function ensureAuditInfrastructure() {
  const setupUser = DB_AUDIT_SETUP_USER || DB_USER
  const setupPassword = DB_AUDIT_SETUP_USER
    ? (DB_AUDIT_SETUP_PASSWORD ?? '')
    : DB_PASSWORD

  const pool = mariadb.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: setupUser,
    password: setupPassword,
    database: DB_NAME,
    connectionLimit: Number(DB_CONN_LIMIT),
  })

  let conn
  try {
    conn = await pool.getConnection()
    const databaseName = await getCurrentDatabaseName(conn)

    if (!await entityVersionsTableExists(conn, databaseName)) {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS entity_versions (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          table_name VARCHAR(128) NOT NULL,
          record_key VARCHAR(512) NOT NULL,
          primary_key_json LONGTEXT NOT NULL,
          operation VARCHAR(16) NOT NULL,
          state LONGTEXT NULL,
          changed_by BIGINT UNSIGNED NULL,
          changed_by_username VARCHAR(255) NULL,
          changed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          change_group_id CHAR(36) NULL,
          INDEX idx_entity_versions_lookup (table_name, record_key, id),
          INDEX idx_entity_versions_changed_at (changed_at),
          INDEX idx_entity_versions_changed_by (changed_by),
          INDEX idx_entity_versions_change_group (change_group_id, id)
        )
      `)
      console.log('ensure-audit-infrastructure: created entity_versions table')
    }

    const metadata = await loadAuditedTableMetadata(conn, databaseName)

    for (const tableName of EXCLUDED_AUDIT_TABLES) {
      await conn.query(`DROP TRIGGER IF EXISTS ${buildTriggerName(tableName, 'ai')}`)
      await conn.query(`DROP TRIGGER IF EXISTS ${buildTriggerName(tableName, 'au')}`)
      await conn.query(`DROP TRIGGER IF EXISTS ${buildTriggerName(tableName, 'ad')}`)
    }

    for (const table of metadata.values()) {
      const tableName = quoteIdentifier(table.name)
      const afterInsertTrigger = buildTriggerNameValue(table.name, 'ai')
      const afterUpdateTrigger = buildTriggerNameValue(table.name, 'au')
      const afterDeleteTrigger = buildTriggerNameValue(table.name, 'ad')
      const recordKeyNew = buildRecordKeyExpression(table.primaryKeyColumns, 'NEW')
      const recordKeyOld = buildRecordKeyExpression(table.primaryKeyColumns, 'OLD')
      const primaryKeyNew = buildPrimaryKeyJsonExpression(table.primaryKeyColumns, 'NEW')
      const primaryKeyOld = buildPrimaryKeyJsonExpression(table.primaryKeyColumns, 'OLD')
      const rowJsonNew = buildJsonObjectExpression(table.columns, 'NEW')
      const rowJsonOld = buildJsonObjectExpression(table.columns, 'OLD')
      const comparisonColumns = buildComparisonColumns(table)
      const comparisonNew = buildJsonObjectExpression(comparisonColumns, 'NEW')
      const comparisonOld = buildJsonObjectExpression(comparisonColumns, 'OLD')

      await conn.query(`DROP TRIGGER IF EXISTS ${buildTriggerName(table.name, 'ai')}`)
      await conn.query(`DROP TRIGGER IF EXISTS ${buildTriggerName(table.name, 'au')}`)
      await conn.query(`DROP TRIGGER IF EXISTS ${buildTriggerName(table.name, 'ad')}`)

      await conn.query(`
        CREATE TRIGGER ${buildTriggerName(table.name, 'ai')}
        AFTER INSERT ON ${tableName}
        FOR EACH ROW
        INSERT INTO entity_versions (
          table_name,
          record_key,
          primary_key_json,
          operation,
          state,
          changed_by,
          changed_by_username,
          change_group_id
        ) VALUES (
          ${quoteString(table.name)},
          ${recordKeyNew},
          ${primaryKeyNew},
          'insert',
          ${rowJsonNew},
          @audit_user_id,
          @audit_username,
          @audit_change_group_id
        )
      `)
      console.log(`ensure-audit-infrastructure: created trigger ${afterInsertTrigger}`)

      await conn.query(`
        CREATE TRIGGER ${buildTriggerName(table.name, 'au')}
        AFTER UPDATE ON ${tableName}
        FOR EACH ROW
        BEGIN
          IF NOT (${comparisonOld} <=> ${comparisonNew}) THEN
            INSERT INTO entity_versions (
              table_name,
              record_key,
              primary_key_json,
              operation,
              state,
              changed_by,
              changed_by_username,
              change_group_id
            ) VALUES (
              ${quoteString(table.name)},
              ${recordKeyNew},
              ${primaryKeyNew},
              'update',
              ${rowJsonNew},
              @audit_user_id,
              @audit_username,
              @audit_change_group_id
            );
          END IF;
        END
      `)
      console.log(`ensure-audit-infrastructure: created trigger ${afterUpdateTrigger}`)

      await conn.query(`
        CREATE TRIGGER ${buildTriggerName(table.name, 'ad')}
        AFTER DELETE ON ${tableName}
        FOR EACH ROW
        INSERT INTO entity_versions (
          table_name,
          record_key,
          primary_key_json,
          operation,
          state,
          changed_by,
          changed_by_username,
          change_group_id
        ) VALUES (
          ${quoteString(table.name)},
          ${recordKeyOld},
          ${primaryKeyOld},
          'delete',
          ${rowJsonOld},
          @audit_user_id,
          @audit_username,
          @audit_change_group_id
        )
      `)
      console.log(`ensure-audit-infrastructure: created trigger ${afterDeleteTrigger}`)
    }

    console.log('ensure-audit-infrastructure: complete')
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

ensureAuditInfrastructure().catch((error) => {
  if (error?.code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || error?.cause?.code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'

    console.error(
      `ensure-audit-infrastructure: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }

  console.error('ensure-audit-infrastructure: failed', error)
  process.exit(1)
})
