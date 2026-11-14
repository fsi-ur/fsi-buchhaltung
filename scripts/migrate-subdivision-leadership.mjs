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

const COLUMNS = [
  // A subdivision-bound position (e.g. "Leitung") is always held within one subdivision.
  ['positions', 'subdivision_bound', 'ADD COLUMN subdivision_bound TINYINT(1) NOT NULL DEFAULT 0 AFTER description'],
  // Subdivision leaders may hand such a position out within their own subdivision.
  ['positions', 'assignable_by_leaders', 'ADD COLUMN assignable_by_leaders TINYINT(1) NOT NULL DEFAULT 0 AFTER subdivision_bound'],
  ['member_positions', 'subdivision_id', 'ADD COLUMN subdivision_id MEDIUMINT UNSIGNED NULL AFTER until'],
]

// init.sql creates member_positions before subdivisions, so the foreign key is added here for
// fresh installs as well.
const FOREIGN_KEY_NAME = 'fk_member_positions_subdivision'

// seed-admin.mjs grants every key to the admin role only when it creates that role, so an
// already-seeded install needs the new keys here.
const ADMIN_PERMISSIONS = ['subdivisions.leadership.view', 'subdivisions.leadership.edit']

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

async function foreignKeyExists(conn, databaseName, tableName, constraintName) {
  const rows = await conn.query(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     LIMIT 1`,
    [databaseName, tableName, constraintName],
  )
  return rows.length > 0
}

async function migrateSubdivisionLeadership() {
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
      console.log(`migrate-subdivision-leadership: added ${tableName}.${columnName}`)
    }

    if (!await foreignKeyExists(conn, databaseName, 'member_positions', FOREIGN_KEY_NAME)) {
      await conn.query(
        `ALTER TABLE member_positions
         ADD CONSTRAINT ${FOREIGN_KEY_NAME} FOREIGN KEY (subdivision_id) REFERENCES subdivisions(id)`,
      )
      console.log(`migrate-subdivision-leadership: added foreign key ${FOREIGN_KEY_NAME}`)
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
      console.log(`migrate-subdivision-leadership: granted ${ADMIN_PERMISSIONS.join(', ')} to admin role ${adminRoleId}`)
    } else {
      console.log('migrate-subdivision-leadership: no admin role found, skipping permission grant')
    }

    console.log('migrate-subdivision-leadership: complete')
  }
  finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateSubdivisionLeadership().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `migrate-subdivision-leadership: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error('migrate-subdivision-leadership: failed', error)
  process.exit(1)
})
