import mariadb from 'mariadb'

/**
 * Schema changes from the security audit (docs/security-audit.md). Every step is idempotent.
 *
 * - SEC-01: `members.account` becomes UNIQUE — one account per member record, so linking can't be
 *   used to inherit another member's positions. Duplicates are NOT resolved automatically: the
 *   migration fails and lists them, an admin has to unlink the surplus records first.
 * - SEC-09: `system_events` — durable log (snapshot restores) that a restore itself never touches.
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
} = process.env

const LOG = 'migrate-security-hardening'

async function indexExists(conn, table, index) {
  const rows = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index],
  )
  return rows.length > 0
}

async function uniqueMemberAccount(conn) {
  if (await indexExists(conn, 'members', 'uq_members_account')) return

  const duplicates = await conn.query(
    `SELECT account, GROUP_CONCAT(id ORDER BY id) AS member_ids
     FROM members
     WHERE account IS NOT NULL
     GROUP BY account
     HAVING COUNT(*) > 1`,
  )
  if (duplicates.length) {
    const lines = duplicates.map(row => `  account ${row.account}: members ${row.member_ids}`).join('\n')
    throw new Error(
      `members.account is linked to more than one member record. Unlink the surplus members first, then re-run:\n${lines}`,
    )
  }

  await conn.query(`ALTER TABLE members ADD UNIQUE KEY uq_members_account (account)`)
  console.log(`${LOG}: added UNIQUE members.account`)
}

async function systemEvents(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS system_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      actor_user_id BIGINT UNSIGNED NULL,
      actor_username VARCHAR(255) NULL,
      details LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_system_events_created (created_at)
    )
  `)
  console.log(`${LOG}: ensured system_events`)
}

async function migrate() {
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
    await uniqueMemberAccount(conn)
    await systemEvents(conn)
    console.log(`${LOG}: done`)
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrate().catch((err) => {
  console.error(`${LOG}: failed —`, err?.message ?? err)
  process.exit(1)
})
