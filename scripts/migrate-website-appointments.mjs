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

const APPOINTMENT_COLUMNS = [
  ['website_published', 'ADD COLUMN website_published TINYINT(1) NOT NULL DEFAULT 0 AFTER reminder_lead_minutes'],
  ['website_visible_from', 'ADD COLUMN website_visible_from DATETIME NULL AFTER website_published'],
]

// seed-admin.mjs grants every key to the admin role only when it creates that role, so an
// already-seeded install needs the new key here.
const ADMIN_PERMISSIONS = ['calendar.publish']

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

async function migrateWebsiteAppointments() {
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

    for (const [columnName, clause] of APPOINTMENT_COLUMNS) {
      if (await columnExists(conn, databaseName, 'appointments', columnName)) continue
      await conn.query(`ALTER TABLE appointments ${clause}`)
      console.log(`migrate-website-appointments: added appointments.${columnName}`)
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
      console.log(`migrate-website-appointments: granted ${ADMIN_PERMISSIONS.join(', ')} to admin role ${adminRoleId}`)
    } else {
      console.log('migrate-website-appointments: no admin role found, skipping permission grant')
    }

    console.log('migrate-website-appointments: complete')
  }
  finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateWebsiteAppointments().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `migrate-website-appointments: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error('migrate-website-appointments: failed', error)
  process.exit(1)
})
