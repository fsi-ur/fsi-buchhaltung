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

const TABLE_NAME = 'invoices'
const COLUMN_NAME = 'recipient_attention'

async function tableExists(conn, databaseName, tableName) {
  const rows = await conn.query(
    `SELECT TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
     LIMIT 1`,
    [databaseName, tableName],
  )

  return Boolean(rows[0]?.table_name)
}

async function columnExists(conn, databaseName, tableName, columnName) {
  const rows = await conn.query(
    `SELECT COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [databaseName, tableName, columnName],
  )

  return Boolean(rows[0]?.column_name)
}

async function getCurrentDatabaseName(conn) {
  const rows = await conn.query('SELECT DATABASE() AS db_name')
  const databaseName = rows[0]?.db_name?.trim()

  if (!databaseName) {
    throw new Error('Failed to resolve current database name for invoice recipient_attention migration')
  }

  return databaseName
}

async function migrateInvoiceRecipientAttention() {
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
    const databaseName = await getCurrentDatabaseName(conn)

    if (!await tableExists(conn, databaseName, TABLE_NAME)) {
      console.log(`migrate-invoice-recipient-attention: skipped (${TABLE_NAME} does not exist)`)
      return
    }

    if (!await columnExists(conn, databaseName, TABLE_NAME, COLUMN_NAME)) {
      await conn.query(
        `ALTER TABLE ${TABLE_NAME}
         ADD COLUMN ${COLUMN_NAME} VARCHAR(255) NULL AFTER contact_person`,
      )
      console.log(`migrate-invoice-recipient-attention: added nullable ${COLUMN_NAME} column`)
    }

    console.log('migrate-invoice-recipient-attention: complete')
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateInvoiceRecipientAttention().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'

    console.error(
      `migrate-invoice-recipient-attention: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }

  console.error('migrate-invoice-recipient-attention: failed', error)
  process.exit(1)
})
