import mariadb from 'mariadb'

// Creates/updates the restricted database user the running app connects as (SEC-10).
//
// The app only needs data access: SELECT/INSERT/UPDATE/DELETE on its own tables, no DDL, no
// TRIGGER, no GRANT. The audit triggers run with their DEFINER's rights (the setup user that
// created them), so audit rows keep being written although this user cannot UPDATE
// `entity_versions` or drop the triggers. `entity_versions` gets SELECT plus INSERT/DELETE only
// because the snapshot restore (SEC-09) replaces it and the retention job prunes it.
//
// Grants are per table, so the script re-runs after every migration (docker-compose `migrate`
// service) to cover new tables. Re-running is safe: password and grants are kept in sync.

const {
  DB_HOST = 'buchhaltung-db-local',
  DB_PORT = '3307',
  DB_NAME = 'fsi_buchhaltung',
  DB_USER,
  DB_PASSWORD,
  DB_ROOT_PASSWORD,
  DB_AUDIT_SETUP_USER,
  DB_AUDIT_SETUP_PASSWORD,
  DB_RUNTIME_USER,
  DB_RUNTIME_PASSWORD,
} = process.env

const AUDIT_TABLE = 'entity_versions'
// Append-only for the app (restore log, SEC-09).
const APPEND_ONLY_TABLES = new Set(['system_events'])

if (!DB_RUNTIME_USER || !DB_RUNTIME_PASSWORD) {
  console.log('create-runtime-db-user: skipped (DB_RUNTIME_USER or DB_RUNTIME_PASSWORD not set)')
  process.exit(0)
}
if (DB_RUNTIME_USER === DB_USER || DB_RUNTIME_USER === DB_AUDIT_SETUP_USER || DB_RUNTIME_USER === 'root') {
  console.error('create-runtime-db-user: DB_RUNTIME_USER must be a separate user, not DB_USER / the setup user / root')
  process.exit(1)
}

const setupUser = DB_AUDIT_SETUP_USER || 'root'
const setupPassword = DB_AUDIT_SETUP_USER
  ? (DB_AUDIT_SETUP_PASSWORD ?? '')
  : (DB_ROOT_PASSWORD ?? '')

const databaseName = DB_NAME.replaceAll('`', '')
const quoteTable = table => `\`${databaseName}\`.\`${String(table).replaceAll('`', '')}\``

async function createRuntimeUser() {
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

    await conn.query(`CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?`, [DB_RUNTIME_USER, DB_RUNTIME_PASSWORD])
    await conn.query(`ALTER USER ?@'%' IDENTIFIED BY ?`, [DB_RUNTIME_USER, DB_RUNTIME_PASSWORD])

    try {
      await conn.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@'%'`, [DB_RUNTIME_USER])
    } catch {
      // No existing grants to revoke.
    }

    const tables = await conn.query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [databaseName],
    )

    for (const { name } of tables) {
      const privileges = name === AUDIT_TABLE
        ? 'SELECT, INSERT, DELETE'
        : APPEND_ONLY_TABLES.has(name) ? 'SELECT, INSERT' : 'SELECT, INSERT, UPDATE, DELETE'
      await conn.query(`GRANT ${privileges} ON ${quoteTable(name)} TO ?@'%'`, [DB_RUNTIME_USER])
    }

    console.log(
      `create-runtime-db-user: user "${DB_RUNTIME_USER}" is set up `
      + `(data access on ${tables.length} tables; ${AUDIT_TABLE}: SELECT, INSERT, DELETE; no DDL/TRIGGER)`,
    )
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

createRuntimeUser().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    console.error(
      `create-runtime-db-user: database authentication failed for setup user "${setupUser}". `
      + 'Check DB_AUDIT_SETUP_USER/DB_AUDIT_SETUP_PASSWORD (or DB_ROOT_PASSWORD) in .env.',
    )
  }

  console.error('create-runtime-db-user: failed', error)
  process.exit(1)
})
