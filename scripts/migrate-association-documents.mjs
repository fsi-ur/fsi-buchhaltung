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

async function tableExists(conn, table) {
  const rows = await conn.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     LIMIT 1`,
    [DB_NAME, table],
  )

  return rows.length > 0
}

async function main() {
  let conn

  try {
    conn = await pool.getConnection()

    if (await tableExists(conn, 'association_documents')) {
      console.log('migrate-association-documents: association_documents already exists')
    } else {
      await conn.query(
        `CREATE TABLE association_documents (
           id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           title VARCHAR(191) NOT NULL,
           description VARCHAR(500) NULL,
           is_active TINYINT(1) NOT NULL DEFAULT 1,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           created_by BIGINT UNSIGNED NULL,
           FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
         )`,
      )
      console.log('migrate-association-documents: created association_documents')
    }

    if (await tableExists(conn, 'entity_documents')) {
      console.log('migrate-association-documents: entity_documents already exists')
    } else {
      await conn.query(
        `CREATE TABLE entity_documents (
           id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           entity_type VARCHAR(50) NOT NULL,
           entity_id BIGINT UNSIGNED NOT NULL,
           document_id BIGINT UNSIGNED NOT NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           created_by BIGINT UNSIGNED NULL,
           UNIQUE KEY uq_entity_document (entity_type, entity_id, document_id),
           KEY idx_entity_documents_document (document_id),
           FOREIGN KEY (document_id) REFERENCES association_documents(id) ON DELETE CASCADE,
           FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
         )`,
      )
      console.log('migrate-association-documents: created entity_documents')
    }
  } finally {
    if (conn) conn.release()
    await pool.end()
  }
}

main().catch((err) => {
  const errorCode = err?.code || err?.cause?.code
  if (errorCode === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR' || errorCode === 'ER_ACCESS_DENIED_ERROR') {
    const attemptedPasswordVar = DB_AUDIT_SETUP_USER ? 'DB_AUDIT_SETUP_PASSWORD' : 'DB_PASSWORD'

    console.error(
      `migrate-association-documents: database authentication failed for user "${migrationUser}". ` +
      `Check DB_HOST/DB_PORT/DB_NAME and the ${attemptedPasswordVar} value in .env.`,
    )
  }

  console.error('migrate-association-documents: failed', err)
  process.exit(1)
})
