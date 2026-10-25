import mariadb from 'mariadb'

/**
 * Adds `cash_count_discrepancy_bookings` — the confirmation (and optional sphere/cost centre
 * override) of the net cash difference of one count. The default assignment for differences without
 * an event split lives in app_settings (`cash_discrepancy_default_*`) and needs no schema.
 *
 * An early version of this table had one row per register; such a table is converted to one row per
 * count. Surplus rows of a count are dropped — the kept one then no longer matches the net amount and
 * shows as "Betrag geändert", asking for a new confirmation.
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

async function migrateCashDiscrepancyBookings() {
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

    await conn.query(`
      CREATE TABLE IF NOT EXISTS cash_count_discrepancy_bookings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        cash_count_id BIGINT UNSIGNED NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        sphere_id TINYINT UNSIGNED NULL,
        cost_centre_id MEDIUMINT UNSIGNED NULL,
        notes TEXT NULL,
        confirmed_by BIGINT UNSIGNED NULL,
        confirmed_at TIMESTAMP NOT NULL,
        UNIQUE KEY uq_cash_count_discrepancy_booking (cash_count_id),
        FOREIGN KEY (cash_count_id) REFERENCES cash_counts(id) ON DELETE CASCADE,
        FOREIGN KEY (sphere_id) REFERENCES spheres(id),
        FOREIGN KEY (cost_centre_id) REFERENCES cost_centres(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `)
    console.log('migrate-cash-discrepancy-bookings: ensured cash_count_discrepancy_bookings')

    const legacyColumn = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cash_count_discrepancy_bookings' AND COLUMN_NAME = 'register_number'`,
    )
    if (legacyColumn.length) {
      const removed = await conn.query(
        `DELETE later FROM cash_count_discrepancy_bookings later
         INNER JOIN cash_count_discrepancy_bookings earlier
           ON earlier.cash_count_id = later.cash_count_id AND earlier.id < later.id`,
      )
      // One statement, so the foreign key on cash_count_id is never left without an index.
      await conn.query(
        `ALTER TABLE cash_count_discrepancy_bookings
           DROP INDEX uq_cash_count_discrepancy_booking,
           ADD UNIQUE KEY uq_cash_count_discrepancy_booking (cash_count_id),
           DROP COLUMN register_number`,
      )
      console.log(`migrate-cash-discrepancy-bookings: converted to one booking per count (removed ${Number(removed.affectedRows ?? 0)} per-register rows)`)
    }

    console.log('migrate-cash-discrepancy-bookings: complete')
  }
  finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateCashDiscrepancyBookings().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `migrate-cash-discrepancy-bookings: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error('migrate-cash-discrepancy-bookings: failed', error)
  process.exit(1)
})
