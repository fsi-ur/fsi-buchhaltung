import mariadb from 'mariadb'

// Creates the restricted database user the cash register (Kassensystem) uses
// in connected mode. The user gets only the privileges the kassensystem needs
// on the accounting database: reading users/permissions/members/events and
// managing the shared sessions table. Re-running the script is safe; it keeps
// the password and grants in sync.

const {
  DB_HOST = 'buchhaltung-db-local',
  DB_PORT = '3307',
  DB_NAME = 'fsi_buchhaltung',
  DB_ROOT_PASSWORD,
  DB_AUDIT_SETUP_USER,
  DB_AUDIT_SETUP_PASSWORD,
  CONNECTION_DB_USER,
  CONNECTION_DB_PASSWORD,
} = process.env

// `users` is granted column by column (SEC-30): the kassensystem logs in against it, so it needs the
// password hash, but nothing else (calendar token hashes, timestamps, ...). Checked against the
// kassensystem's queries (login, session lookup, user list).
const USER_COLUMNS = ['id', 'username', 'password_hash', 'is_active', 'must_change_password']

const SELECT_TABLES = [
  'members',
  'events',
  'roles',
  'user_roles',
  'role_permissions',
  'user_permissions',
]

const SESSION_TABLE = 'sessions'

if (!CONNECTION_DB_USER || !CONNECTION_DB_PASSWORD) {
  console.log('create-connection-db-user: skipped (CONNECTION_DB_USER or CONNECTION_DB_PASSWORD not set)')
  process.exit(0)
}

const setupUser = DB_AUDIT_SETUP_USER || 'root'
const setupPassword = DB_AUDIT_SETUP_USER
  ? (DB_AUDIT_SETUP_PASSWORD ?? '')
  : (DB_ROOT_PASSWORD ?? '')

const databaseName = DB_NAME.replaceAll('`', '')

async function createConnectionUser() {
  const pool = mariadb.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: setupUser,
    password: setupPassword,
    connectionLimit: 1,
  })

  let conn

  try {
    conn = await pool.getConnection()

    await conn.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [CONNECTION_DB_USER, CONNECTION_DB_PASSWORD])
    await conn.query(`ALTER USER ?@'%' IDENTIFIED BY ?`, [CONNECTION_DB_USER, CONNECTION_DB_PASSWORD])

    try {
      await conn.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@'%'`, [CONNECTION_DB_USER])
    } catch {
      // No existing grants to revoke.
    }

    await conn.query(
      `GRANT SELECT (${USER_COLUMNS.map(column => `\`${column}\``).join(', ')}) ON \`${databaseName}\`.\`users\` TO ?@'%'`,
      [CONNECTION_DB_USER],
    )

    for (const table of SELECT_TABLES) {
      await conn.query(`GRANT SELECT ON \`${databaseName}\`.\`${table}\` TO ?@'%'`, [CONNECTION_DB_USER])
    }

    await conn.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${databaseName}\`.\`${SESSION_TABLE}\` TO ?@'%'`,
      [CONNECTION_DB_USER],
    )

    console.log(
      `create-connection-db-user: user "${CONNECTION_DB_USER}" is set up ` +
      `(SELECT on users(${USER_COLUMNS.join(', ')}), ${SELECT_TABLES.join(', ')}; full access on ${SESSION_TABLE})`,
    )
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

createConnectionUser().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    console.error(
      `create-connection-db-user: database authentication failed for setup user "${setupUser}". ` +
      'Check DB_AUDIT_SETUP_USER/DB_AUDIT_SETUP_PASSWORD (or DB_ROOT_PASSWORD) in .env.',
    )
  }

  console.error('create-connection-db-user: failed', error)
  process.exit(1)
})
