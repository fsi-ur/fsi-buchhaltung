import mariadb from 'mariadb'

/**
 * Makes every time column say what it holds (see shared/time.ts):
 *   TIMESTAMP = real instant (UTC) · DATETIME = wall clock in the app time zone · DATE = calendar day.
 *
 * 1. Seeds the `app_time_zone` setting (APP_TIME_ZONE env or Europe/Berlin) — the one zone every
 *    DATETIME/DATE is read in.
 * 2. TIMESTAMP → DATETIME for times people type in. The client always sent the wall clock it showed
 *    (Berlin), and the UTC session stored exactly that text — so the values ARE wall clocks already
 *    and are kept verbatim; only the type now says so (they used to be displayed 1–2 h late).
 * 3. TIMESTAMP → DATE for reimbursement dates that come from date-only pickers. Rows that carry a
 *    time of day were written by the server's "now" fallback in UTC; they get that instant's day in
 *    the app time zone instead of the UTC day.
 * 4. DATETIME → TIMESTAMP for system moments that were filled by NOW()/CURRENT_TIMESTAMP in the UTC
 *    session — they are instants, and as TIMESTAMP they now leave the DB marked as such.
 * 5. Drops `DEFAULT CURRENT_TIMESTAMP` from the notification module's wall-clock DATETIME columns:
 *    that default would silently store UTC into a local-time column. Every insert sets them.
 *
 * Every step checks the current column type first, so the script is safe to re-run.
 */

const {
  DB_HOST = 'buchhaltung-db-local',
  DB_PORT = '3307',
  DB_USER = 'fsi',
  DB_PASSWORD = 'fsi_password',
  DB_NAME = 'fsi_buchhaltung',
  DB_AUDIT_SETUP_USER,
  DB_AUDIT_SETUP_PASSWORD,
  DB_CONN_LIMIT = '2',
  APP_TIME_ZONE,
} = process.env

const LOG_PREFIX = 'migrate-explicit-time-zones:'
const DEFAULT_TIME_ZONE = 'Europe/Berlin'

const TO_DATETIME = [
  { table: 'cash_counts', column: 'counted_before_at', definition: 'DATETIME NULL' },
  { table: 'cash_counts', column: 'counted_after_at', definition: 'DATETIME NOT NULL' },
  { table: 'bank_statements', column: 'statement_date', definition: 'DATETIME NOT NULL' },
]

const TO_DATE = [
  { table: 'reimbursements', column: 'submitted_at', definition: 'DATE NOT NULL' },
  { table: 'reimbursements', column: 'checked_at', definition: 'DATE NULL' },
  { table: 'reimbursements', column: 'disbursed_at', definition: 'DATE NULL' },
]

const TO_TIMESTAMP = [
  { table: 'users', column: 'calendar_token_created_at', definition: 'TIMESTAMP NULL DEFAULT NULL' },
  { table: 'appointments', column: 'created_at', definition: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' },
  { table: 'appointments', column: 'updated_at', definition: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  { table: 'appointment_responses', column: 'responded_at', definition: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  { table: 'association_documents', column: 'created_at', definition: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' },
  { table: 'entity_documents', column: 'created_at', definition: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' },
]

const DROP_UTC_DEFAULT = [
  { table: 'notifications', column: 'created_at', definition: 'DATETIME NOT NULL' },
  { table: 'notification_push_subscriptions', column: 'created_at', definition: 'DATETIME NOT NULL' },
]

function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function localDateOfUtc(sqlUtc, timeZone) {
  const instant = new Date(`${sqlUtc.replace(' ', 'T')}Z`)
  return instant.toLocaleDateString('sv-SE', { timeZone })
}

async function getCurrentDatabaseName(conn) {
  const rows = await conn.query('SELECT DATABASE() AS db_name')
  const databaseName = rows[0]?.db_name?.trim()
  if (!databaseName) throw new Error('Failed to resolve current database name for the time zone migration')
  return databaseName
}

async function columnInfo(conn, databaseName, table, column) {
  const rows = await conn.query(
    `SELECT DATA_TYPE AS data_type, COLUMN_DEFAULT AS column_default
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [databaseName, table, column],
  )
  if (!rows[0]) return null
  return { dataType: String(rows[0].data_type).toLowerCase(), columnDefault: rows[0].column_default }
}

async function ensureTimeZoneSetting(conn) {
  const seed = isValidTimeZone(APP_TIME_ZONE) ? APP_TIME_ZONE : DEFAULT_TIME_ZONE
  await conn.query(
    `INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES ('app_time_zone', ?)`,
    [seed],
  )
  const rows = await conn.query(`SELECT setting_value FROM app_settings WHERE setting_key = 'app_time_zone'`)
  const value = rows[0]?.setting_value
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

async function migrateExplicitTimeZones() {
  const migrationUser = DB_AUDIT_SETUP_USER || DB_USER
  const migrationPassword = DB_AUDIT_SETUP_USER
    ? (DB_AUDIT_SETUP_PASSWORD ?? '')
    : DB_PASSWORD

  const pool = mariadb.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: migrationUser,
    password: migrationPassword,
    database: DB_NAME,
    connectionLimit: Number(DB_CONN_LIMIT),
    // The same frame the app writes in: UTC session, values as the literal strings they are.
    timezone: 'UTC',
    dateStrings: true,
  })

  let conn

  try {
    conn = await pool.getConnection()
    const databaseName = await getCurrentDatabaseName(conn)

    const timeZone = await ensureTimeZoneSetting(conn)
    console.log(`${LOG_PREFIX} app time zone is ${timeZone}`)

    for (const { table, column, definition } of TO_DATETIME) {
      const info = await columnInfo(conn, databaseName, table, column)
      if (!info || info.dataType !== 'timestamp') continue
      await conn.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${definition}`)
      console.log(`${LOG_PREFIX} ${table}.${column} is now a wall-clock DATETIME (values kept)`)
    }

    for (const { table, column, definition } of TO_DATE) {
      const info = await columnInfo(conn, databaseName, table, column)
      if (!info || info.dataType === 'date') continue

      const rows = await conn.query(
        `SELECT id, \`${column}\` AS value FROM \`${table}\`
         WHERE \`${column}\` IS NOT NULL AND TIME(\`${column}\`) <> '00:00:00'`,
      )
      for (const row of rows) {
        const day = localDateOfUtc(String(row.value), timeZone)
        await conn.query(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE id = ?`, [`${day} 00:00:00`, row.id])
      }

      await conn.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${definition}`)
      console.log(`${LOG_PREFIX} ${table}.${column} is now a DATE (${rows.length} row(s) moved to their ${timeZone} day)`)
    }

    for (const { table, column, definition } of TO_TIMESTAMP) {
      const info = await columnInfo(conn, databaseName, table, column)
      if (!info || info.dataType !== 'datetime') continue
      await conn.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${definition}`)
      console.log(`${LOG_PREFIX} ${table}.${column} is now an instant (TIMESTAMP, values kept as UTC)`)
    }

    for (const { table, column, definition } of DROP_UTC_DEFAULT) {
      const info = await columnInfo(conn, databaseName, table, column)
      if (!info || info.dataType !== 'datetime' || info.columnDefault === null) continue
      await conn.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${definition}`)
      console.log(`${LOG_PREFIX} ${table}.${column} lost its UTC default`)
    }

    console.log(`${LOG_PREFIX} complete`)
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateExplicitTimeZones().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'

    console.error(
      `${LOG_PREFIX} database authentication failed for user "${attemptedUser}". `
      + `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }

  console.error(`${LOG_PREFIX} failed`, error)
  process.exit(1)
})
