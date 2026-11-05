import mariadb from 'mariadb'

/**
 * Schema changes from the security audit (docs/security-audit.md). Every step is idempotent.
 *
 * - SEC-01: `members.account` becomes UNIQUE — one account per member record, so linking can't be
 *   used to inherit another member's positions. Duplicates are NOT resolved automatically: the
 *   migration fails and lists them, an admin has to unlink the surplus records first.
 * - SEC-19: `members.account_deactivation_skipped` — set when the editor who marked a member as
 *   "left" may not deactivate the linked account; the leave dispatcher then leaves it active.
 * - SEC-23: `reimbursement_positions.receipt_id` becomes UNIQUE — a receipt can be reimbursed once;
 *   two concurrent saves can no longer both pass the "already reimbursed" check. Duplicates fail
 *   the migration with a list instead of being removed.
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

async function grantPositionsAssign(conn) {
  // positions.assign is a permission of its own (SEC-01, owner decision: not implied by
  // permissions.manage). Once, on upgrade, hand it to everyone who held permissions.manage, so an
  // existing install keeps someone who can assign positions. The marker keeps later deploys from
  // re-granting it after an admin deliberately took it away.
  const MARKER = 'migration.positions_assign_granted'
  const done = await conn.query(`SELECT id FROM system_events WHERE event_type = ? LIMIT 1`, [MARKER])
  if (done.length) return

  const grants = [
    ['role_permissions', 'role_id'],
    ['position_permissions', 'position_id'],
    ['user_permissions', 'user_id'],
  ]
  const counts = {}
  for (const [table, column] of grants) {
    const result = await conn.query(
      `INSERT IGNORE INTO ${table} (${column}, permission_key)
       SELECT ${column}, 'positions.assign' FROM ${table} WHERE permission_key = 'permissions.manage'`,
    )
    counts[table] = Number(result.affectedRows ?? 0)
  }
  await conn.query(
    `INSERT INTO system_events (event_type, actor_user_id, actor_username, details) VALUES (?, NULL, NULL, ?)`,
    [MARKER, JSON.stringify(counts)],
  )
  console.log(`${LOG}: granted positions.assign to permissions.manage holders ${JSON.stringify(counts)}`)
}

async function columnExists(conn, table, column) {
  const rows = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  )
  return rows.length > 0
}

async function memberDeactivationSkipped(conn) {
  if (await columnExists(conn, 'members', 'account_deactivation_skipped')) return
  await conn.query(`ALTER TABLE members ADD COLUMN account_deactivation_skipped TINYINT(1) NOT NULL DEFAULT 0 AFTER left_at`)
  console.log(`${LOG}: added members.account_deactivation_skipped`)
}

async function uniqueReimbursedReceipt(conn) {
  if (await indexExists(conn, 'reimbursement_positions', 'uq_reimbursement_positions_receipt')) return

  const duplicates = await conn.query(
    `SELECT receipt_id, GROUP_CONCAT(reimbursement_id ORDER BY reimbursement_id) AS reimbursement_ids
     FROM reimbursement_positions
     GROUP BY receipt_id
     HAVING COUNT(*) > 1`,
  )
  if (duplicates.length) {
    const lines = duplicates.map(row => `  receipt ${row.receipt_id}: reimbursements ${row.reimbursement_ids}`).join('\n')
    throw new Error(`Receipts are part of more than one reimbursement. Remove the surplus positions first, then re-run:\n${lines}`)
  }

  await conn.query(`ALTER TABLE reimbursement_positions ADD UNIQUE KEY uq_reimbursement_positions_receipt (receipt_id)`)
  console.log(`${LOG}: added UNIQUE reimbursement_positions.receipt_id`)
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
    await grantPositionsAssign(conn)
    await memberDeactivationSkipped(conn)
    await uniqueReimbursedReceipt(conn)
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
