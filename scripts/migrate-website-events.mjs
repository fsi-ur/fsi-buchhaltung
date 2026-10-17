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

const EVENT_COLUMNS = [
  ['website_published', 'ADD COLUMN website_published TINYINT(1) NOT NULL DEFAULT 0'],
  ['website_visible_from', 'ADD COLUMN website_visible_from DATETIME NULL'],
  ['website_title', 'ADD COLUMN website_title VARCHAR(255) NULL'],
  ['website_description', 'ADD COLUMN website_description TEXT NULL'],
]

const API_KEYS_DDL = `
  CREATE TABLE api_keys (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(127) NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    key_hash CHAR(64) NOT NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL DEFAULT NULL,
    revoked_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY unique_api_key_hash (key_hash),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  )
`

// seed-admin.mjs grants every key to the admin role only when it creates that role, so an
// already-seeded install needs the new keys here.
const ADMIN_PERMISSIONS = ['events.publish', 'settings.apiKeys.manage']

async function tableExists(conn, databaseName, tableName) {
  const rows = await conn.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
     LIMIT 1`,
    [databaseName, tableName],
  )
  return rows.length > 0
}

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

async function migrateWebsiteEvents() {
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

    for (const [columnName, clause] of EVENT_COLUMNS) {
      if (await columnExists(conn, databaseName, 'events', columnName)) continue
      await conn.query(`ALTER TABLE events ${clause}`)
      console.log(`migrate-website-events: added events.${columnName}`)
    }

    if (!await tableExists(conn, databaseName, 'api_keys')) {
      await conn.query(API_KEYS_DDL)
      console.log('migrate-website-events: created api_keys')
    }

    const adminRows = await conn.query(`SELECT id FROM roles WHERE code = 'admin' LIMIT 1`)
    const adminRoleId = adminRows.length > 0 ? Number(adminRows[0].id) : null
    if (adminRoleId) {
      for (const permissionKey of ADMIN_PERMISSIONS) {
        await conn.query(
          `INSERT IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)`,
          [adminRoleId, permissionKey],
        )
      }
      console.log(`migrate-website-events: granted ${ADMIN_PERMISSIONS.join(', ')} to admin role ${adminRoleId}`)
    } else {
      console.log('migrate-website-events: no admin role found, skipping permission grant')
    }

    console.log('migrate-website-events: complete')
  }
  finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateWebsiteEvents().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `migrate-website-events: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error('migrate-website-events: failed', error)
  process.exit(1)
})
