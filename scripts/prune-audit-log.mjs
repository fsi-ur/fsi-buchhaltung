import mariadb from 'mariadb'

const {
  DB_HOST = 'buchhaltung-db-local',
  DB_PORT = '3307',
  DB_USER = 'fsi',
  DB_PASSWORD = 'fsi_password',
  DB_NAME = 'fsi_buchhaltung',
  DB_CONN_LIMIT = '2',
} = process.env

// Mirrors the 'finances' domain in server/utils/audit/registry.ts. Financial data is subject to
// retention obligations and is kept separately (usually much longer, often unlimited).
const FINANCE_TABLES = [
  'receipts', 'receipt_positions',
  'invoices', 'invoice_positions',
  'reimbursements', 'reimbursement_positions',
  'cash_counts', 'cash_count_positions',
  'budgets', 'budget_cost_centre_lines',
  'bank_statements', 'bank_statement_positions',
  'finance_accounts', 'bank_discrepancy_bookings',
]

const BATCH_SIZE = 5000

async function readRetentionSettings(conn) {
  const rows = await conn.query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)`,
    ['audit_retention_days', 'audit_retention_finance_days'],
  )
  const values = new Map(rows.map(row => [row.setting_key, row.setting_value]))
  const retentionDays = Number(values.get('audit_retention_days'))
  const financeRetentionDays = Number(values.get('audit_retention_finance_days'))
  return {
    retentionDays: Number.isInteger(retentionDays) && retentionDays >= 0 ? retentionDays : 1095,
    financeRetentionDays: Number.isInteger(financeRetentionDays) && financeRetentionDays >= 0 ? financeRetentionDays : 0,
  }
}

async function pruneWithCutoff(conn, cutoffDays, tableFilter) {
  if (cutoffDays <= 0) {
    console.log(`prune-audit-log: ${tableFilter} retention is unlimited (0), skipping`)
    return 0
  }
  if (tableFilter === 'finance' && !FINANCE_TABLES.length) return 0

  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000)
  const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' ')

  const tableClause = tableFilter === 'finance'
    ? `table_name IN (${FINANCE_TABLES.map(() => '?').join(', ')})`
    : `table_name NOT IN (${FINANCE_TABLES.map(() => '?').join(', ')})`

  let totalDeleted = 0

  // Single-table DELETE (required for LIMIT) with a derived-table subquery: MariaDB forbids
  // selecting from the table being deleted from directly, but wrapping it in a derived table
  // (the `keep_insert` alias) is the standard workaround. Always keeps the oldest insert row per
  // record so the creation information is never lost.
  for (;;) {
    const result = await conn.query(
      `DELETE FROM entity_versions
       WHERE changed_at < ?
         AND ${tableClause}
         AND id <> (
           SELECT min_id FROM (
             SELECT MIN(e2.id) AS min_id FROM entity_versions e2
             WHERE e2.table_name = entity_versions.table_name
               AND e2.record_key = entity_versions.record_key
               AND e2.operation = 'insert'
           ) AS keep_insert
         )
       LIMIT ${BATCH_SIZE}`,
      [cutoffStr, ...FINANCE_TABLES],
    )
    const affected = Number(result.affectedRows ?? 0)
    totalDeleted += affected
    if (affected < BATCH_SIZE) break
  }

  console.log(`prune-audit-log: deleted ${totalDeleted} ${tableFilter} rows older than ${cutoffStr}`)
  return totalDeleted
}

async function pruneAuditLog() {
  const pool = mariadb.createPool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectionLimit: Number(DB_CONN_LIMIT),
  })

  let conn
  try {
    conn = await pool.getConnection()
    const { retentionDays, financeRetentionDays } = await readRetentionSettings(conn)

    const deletedNonFinance = await pruneWithCutoff(conn, retentionDays, 'nonFinance')
    const deletedFinance = await pruneWithCutoff(conn, financeRetentionDays, 'finance')

    console.log(`prune-audit-log: complete, deleted ${deletedNonFinance + deletedFinance} rows total`)
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

pruneAuditLog().catch((error) => {
  console.error('prune-audit-log: failed', error)
  process.exit(1)
})
