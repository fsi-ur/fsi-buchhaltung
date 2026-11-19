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

// An answer to an appointment whose occurrence changed afterwards (other time, other date, or the
// organiser asked everyone again) is kept but flagged: it counts as "no answer" until the member
// confirms it. Before, such answers were either silently kept or deleted.
const COLUMNS = [
  ['appointment_responses', 'needs_reconfirmation', 'ADD COLUMN needs_reconfirmation TINYINT(1) NOT NULL DEFAULT 0 AFTER comment'],
]

async function columnExists(conn, databaseName, tableName, columnName) {
  const rows = await conn.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [databaseName, tableName, columnName],
  )
  return rows.length > 0
}

async function migrateAppointmentResponseReconfirmation() {
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
  })

  let conn

  try {
    conn = await pool.getConnection()
    const rows = await conn.query('SELECT DATABASE() AS db_name')
    const databaseName = rows[0]?.db_name?.trim()
    if (!databaseName) throw new Error('Failed to resolve current database name')

    for (const [tableName, columnName, clause] of COLUMNS) {
      if (await columnExists(conn, databaseName, tableName, columnName)) continue
      await conn.query(`ALTER TABLE ${tableName} ${clause}`)
      console.log(`migrate-appointment-response-reconfirmation: added ${tableName}.${columnName}`)
    }
  }
  finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateAppointmentResponseReconfirmation().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `migrate-appointment-response-reconfirmation: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error('migrate-appointment-response-reconfirmation: failed', error)
  process.exit(1)
})
