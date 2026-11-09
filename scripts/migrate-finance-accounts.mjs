import mariadb from 'mariadb'

/**
 * Introduces several own money accounts (`finance_accounts`).
 *
 * - Bank statements belong to an account (`bank_statements.account_id`).
 * - A statement position can be a transfer to/from another own account
 *   (`position_type = 'transfer'`, `counter_account_id`, signed `amount`), confirmed on the other
 *   account's statement by a transfer with `linked_position_id`; a `reimbursement` position confirms
 *   a bank reimbursement. Differing amounts are bank differences (`bank_discrepancy_bookings`).
 *   Existing bank reimbursements stay unconfirmed until a statement takes them over.
 * - Bank-paid reimbursements record the account they were paid from (`paid_from_account_id`).
 * - The single IBAN/BIC/bank name of the association profile moves into an account and the
 *   columns are dropped.
 *
 * Existing data: with an IBAN on the profile a "Hauptkonto" (type bank, default) is created; without
 * an IBAN but with statements or bank reimbursements a "Hauptkonto" of type "other" (no default);
 * with neither, no account at all — bank features then stay off. Every existing statement and bank
 * reimbursement is assigned to that account. Idempotent: each step checks the current schema.
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

const LOG = 'migrate-finance-accounts'

async function columnExists(conn, table, column) {
  const rows = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )
  return rows.length > 0
}

async function columnInfo(conn, table, column) {
  const rows = await conn.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )
  return rows[0] ?? null
}

async function foreignKeyExists(conn, table, column) {
  const rows = await conn.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [table, column],
  )
  return rows.length > 0
}

async function ensureLegacyAccount(conn) {
  const [{ count }] = await conn.query(`SELECT COUNT(*) AS count FROM finance_accounts`)
  if (Number(count) > 0) {
    const [existing] = await conn.query(`SELECT id FROM finance_accounts ORDER BY is_default DESC, id ASC LIMIT 1`)
    return Number(existing.id)
  }

  const hasProfileBankColumns = await columnExists(conn, 'association_profiles', 'iban')
  const [profile] = hasProfileBankColumns
    ? await conn.query(`SELECT name, iban, bic, bankname FROM association_profiles ORDER BY id ASC LIMIT 1`)
    : [undefined]
  const iban = String(profile?.iban ?? '').trim()

  const [{ statements }] = await conn.query(`SELECT COUNT(*) AS statements FROM bank_statements`)
  const [{ reimbursements }] = await conn.query(`SELECT COUNT(*) AS reimbursements FROM reimbursements WHERE cash = 0`)
  const hasBankData = Number(statements) > 0 || Number(reimbursements) > 0

  if (iban) {
    const result = await conn.query(
      `INSERT INTO finance_accounts (name, account_type, account_holder, iban, bic, bankname, is_default)
       VALUES ('Hauptkonto', 'bank', ?, ?, ?, ?, 1)`,
      [profile?.name ? String(profile.name).trim() || null : null, iban, String(profile?.bic ?? '').trim() || null, String(profile?.bankname ?? '').trim() || null],
    )
    console.log(`${LOG}: created bank account "Hauptkonto" from the association profile`)
    return Number(result.insertId)
  }

  if (hasBankData) {
    const result = await conn.query(
      `INSERT INTO finance_accounts (name, account_type, bankname, is_default)
       VALUES ('Hauptkonto', 'other', ?, 0)`,
      [String(profile?.bankname ?? '').trim() || null],
    )
    console.log(`${LOG}: created account "Hauptkonto" (type other, no IBAN) for the existing bank data`)
    return Number(result.insertId)
  }

  console.log(`${LOG}: no bank data and no IBAN — no account created, bank features stay off`)
  return null
}

async function migrateFinanceAccounts() {
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
      CREATE TABLE IF NOT EXISTS finance_accounts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(127) NOT NULL,
        account_type ENUM('bank','other') NOT NULL DEFAULT 'bank',
        account_holder VARCHAR(255) NULL,
        iban VARCHAR(34) NULL,
        bic VARCHAR(11) NULL,
        bankname VARCHAR(127) NULL,
        identifier VARCHAR(255) NULL,
        notes TEXT NULL,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        archived_at TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY uq_finance_accounts_name (name)
      )
    `)
    console.log(`${LOG}: ensured finance_accounts`)

    // Columns first (nullable), so the legacy account can be assigned before NOT NULL applies.
    if (!await columnExists(conn, 'bank_statements', 'account_id')) {
      await conn.query(`ALTER TABLE bank_statements ADD COLUMN account_id BIGINT UNSIGNED NULL AFTER id`)
      console.log(`${LOG}: added bank_statements.account_id`)
    }
    if (!await columnExists(conn, 'bank_statement_positions', 'counter_account_id')) {
      await conn.query(`ALTER TABLE bank_statement_positions ADD COLUMN counter_account_id BIGINT UNSIGNED NULL AFTER event_id`)
      console.log(`${LOG}: added bank_statement_positions.counter_account_id`)
    }
    const positionType = await columnInfo(conn, 'bank_statement_positions', 'position_type')
    if (positionType && !String(positionType.COLUMN_TYPE).includes("'reimbursement'")) {
      await conn.query(`ALTER TABLE bank_statement_positions MODIFY position_type ENUM('receipt','invoice','event','transfer','reimbursement') NOT NULL`)
      console.log(`${LOG}: added position types 'transfer' and 'reimbursement'`)
    }
    if (!await columnExists(conn, 'bank_statement_positions', 'linked_position_id')) {
      await conn.query(`ALTER TABLE bank_statement_positions
        ADD COLUMN linked_position_id BIGINT UNSIGNED NULL AFTER counter_account_id,
        ADD UNIQUE KEY uq_bsp_linked_position (linked_position_id),
        ADD CONSTRAINT fk_bsp_linked_position FOREIGN KEY (linked_position_id) REFERENCES bank_statement_positions(id)`)
      console.log(`${LOG}: added bank_statement_positions.linked_position_id`)
    }
    if (!await columnExists(conn, 'bank_statement_positions', 'reimbursement_id')) {
      await conn.query(`ALTER TABLE bank_statement_positions
        ADD COLUMN reimbursement_id BIGINT UNSIGNED NULL AFTER linked_position_id,
        ADD UNIQUE KEY uq_bsp_reimbursement (reimbursement_id),
        ADD CONSTRAINT fk_bsp_reimbursement FOREIGN KEY (reimbursement_id) REFERENCES reimbursements(id)`)
      console.log(`${LOG}: added bank_statement_positions.reimbursement_id`)
    }
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bank_discrepancy_bookings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bank_statement_position_id BIGINT UNSIGNED NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        sphere_id TINYINT UNSIGNED NULL,
        cost_centre_id MEDIUMINT UNSIGNED NULL,
        notes TEXT NULL,
        confirmed_by BIGINT UNSIGNED NULL,
        confirmed_at TIMESTAMP NOT NULL,
        UNIQUE KEY uq_bank_discrepancy_booking (bank_statement_position_id),
        FOREIGN KEY (bank_statement_position_id) REFERENCES bank_statement_positions(id) ON DELETE CASCADE,
        FOREIGN KEY (sphere_id) REFERENCES spheres(id),
        FOREIGN KEY (cost_centre_id) REFERENCES cost_centres(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `)
    console.log(`${LOG}: ensured bank_discrepancy_bookings`)
    if (!await columnExists(conn, 'reimbursements', 'paid_from_account_id')) {
      await conn.query(`ALTER TABLE reimbursements ADD COLUMN paid_from_account_id BIGINT UNSIGNED NULL AFTER disbursed_by`)
      console.log(`${LOG}: added reimbursements.paid_from_account_id`)
    }

    await conn.beginTransaction()
    const legacyAccountId = await ensureLegacyAccount(conn)
    if (legacyAccountId) {
      const statements = await conn.query(`UPDATE bank_statements SET account_id = ? WHERE account_id IS NULL`, [legacyAccountId])
      const reimbursements = await conn.query(
        `UPDATE reimbursements SET paid_from_account_id = ? WHERE cash = 0 AND paid_from_account_id IS NULL`,
        [legacyAccountId],
      )
      console.log(`${LOG}: assigned ${Number(statements.affectedRows ?? 0)} statements and ${Number(reimbursements.affectedRows ?? 0)} reimbursements`)
    }
    await conn.commit()

    const accountColumn = await columnInfo(conn, 'bank_statements', 'account_id')
    if (accountColumn?.IS_NULLABLE === 'YES') {
      await conn.query(`ALTER TABLE bank_statements MODIFY account_id BIGINT UNSIGNED NOT NULL`)
    }
    if (!await foreignKeyExists(conn, 'bank_statements', 'account_id')) {
      await conn.query(`ALTER TABLE bank_statements ADD CONSTRAINT fk_bank_statements_account FOREIGN KEY (account_id) REFERENCES finance_accounts(id)`)
    }
    if (!await foreignKeyExists(conn, 'bank_statement_positions', 'counter_account_id')) {
      await conn.query(`ALTER TABLE bank_statement_positions ADD CONSTRAINT fk_bsp_counter_account FOREIGN KEY (counter_account_id) REFERENCES finance_accounts(id)`)
    }
    if (!await foreignKeyExists(conn, 'reimbursements', 'paid_from_account_id')) {
      await conn.query(`ALTER TABLE reimbursements ADD CONSTRAINT fk_reimbursements_paid_from_account FOREIGN KEY (paid_from_account_id) REFERENCES finance_accounts(id)`)
    }

    // The profile's bank details now live in the account — drop them only after they were copied.
    for (const column of ['iban', 'bic', 'bankname']) {
      if (await columnExists(conn, 'association_profiles', column)) {
        await conn.query(`ALTER TABLE association_profiles DROP COLUMN ${column}`)
        console.log(`${LOG}: dropped association_profiles.${column}`)
      }
    }

    console.log(`${LOG}: complete`)
  }
  catch (error) {
    if (conn) await conn.rollback().catch(() => {})
    throw error
  }
  finally {
    if (conn) conn.release()
    await pool.end()
  }
}

migrateFinanceAccounts().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `${LOG}: database authentication failed for user "${attemptedUser}". `
      + `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error(`${LOG}: failed`, error)
  process.exit(1)
})
