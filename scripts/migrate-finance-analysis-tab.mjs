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

// The finance analysis moved from its own page (FinanceAnalysis) into the "analysis" tab of
// Finances. Wiki help mapped to the old page is moved to that tab so the help button keeps finding
// it. Tool links and checklist items in articles that still name FinanceAnalysis are deliberately
// left alone: they break visibly and have to be updated by their authors.
const OLD_PAGE = 'FinanceAnalysis'
const NEW_PAGE = 'Finances'
const NEW_SECTION = 'analysis'

async function migrateFinanceAnalysisTab() {
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
    const tables = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wiki_page_help'`,
    )
    if (!tables.length) {
      console.log('migrate-finance-analysis-tab: no wiki_page_help table, nothing to move')
      return
    }

    await conn.beginTransaction()
    // IGNORE: an article already mapped to the new tab keeps that row; the old duplicate is dropped below.
    const moved = await conn.query(
      `UPDATE IGNORE wiki_page_help SET page_name = ?, section_key = ? WHERE page_name = ?`,
      [NEW_PAGE, NEW_SECTION, OLD_PAGE],
    )
    await conn.query(`DELETE FROM wiki_page_help WHERE page_name = ?`, [OLD_PAGE])
    await conn.commit()

    console.log(`migrate-finance-analysis-tab: moved ${Number(moved.affectedRows ?? 0)} help mapping(s) to ${NEW_PAGE}/${NEW_SECTION}`)
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

migrateFinanceAnalysisTab().catch((error) => {
  const errorCode = error?.code || error?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedUser = DB_AUDIT_SETUP_USER || DB_USER
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'
    console.error(
      `migrate-finance-analysis-tab: database authentication failed for user "${attemptedUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }
  console.error('migrate-finance-analysis-tab: failed', error)
  process.exit(1)
})
