import mariadb from 'mariadb'
import { normalizeBigInt } from '~/server/utils/normalize'

// Connection to the cash register (Kassensystem) database. Only active when
// CASH_REGISTER_MODE=connected; use the restricted read-only user created by
// the kassensystem's setup:connection-db-user script.
const cashRegisterMode = (process.env.CASH_REGISTER_MODE || 'standalone').toLowerCase()

let pool: mariadb.Pool | null = null

export function isCashRegisterConnected() {
  return cashRegisterMode === 'connected'
}

function getPool() {
  if (!pool) {
    pool = mariadb.createPool({
      host: process.env.CASH_REGISTER_DB_HOST || process.env.DB_HOST,
      port: Number(process.env.CASH_REGISTER_DB_PORT || 3306),
      user: process.env.CASH_REGISTER_DB_USER,
      password: process.env.CASH_REGISTER_DB_PASSWORD,
      database: process.env.CASH_REGISTER_DB_NAME || 'fsi_kasse',
      connectionLimit: Number(process.env.CASH_REGISTER_DB_CONN_LIMIT || 2),
      dateStrings: true,
      timezone: 'UTC',
    })
  }

  return pool
}

// Both applications deploy independently, so the read side must tolerate a
// kassensystem whose price-snapshot migration has not run yet. Cached for the
// process lifetime — a restart picks up the migration.
let snapshotSupport: boolean | null = null

export async function hasCashRegisterPriceSnapshots(): Promise<boolean> {
  if (snapshotSupport !== null) return snapshotSupport

  const rows = await cashRegisterQuery<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'order_items' AND COLUMN_NAME IN ('unit_price', 'unit_deposit', 'item_name'))
          OR (TABLE_NAME = 'fachschaft_payments' AND COLUMN_NAME = 'amount'))`,
  )

  snapshotSupport = Number(rows[0]?.n ?? 0) === 4
  return snapshotSupport
}

let standSupport = false

export async function hasCashRegisterStands(): Promise<boolean> {
  if (standSupport) return true

  const rows = await cashRegisterQuery<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME IN ('orders', 'donations') AND COLUMN_NAME = 'stand_id')
          OR (TABLE_NAME = 'stands' AND COLUMN_NAME = 'name'))`,
  )

  standSupport = Number(rows[0]?.n ?? 0) === 3
  return standSupport
}

export async function cashRegisterQuery<T = any>(sql: string, params?: unknown[]): Promise<T> {
  if (!isCashRegisterConnected()) {
    throw new Error('Cash register connection is not configured')
  }

  const conn = await getPool().getConnection()
  try {
    const result = await conn.query(sql, params)
    return normalizeBigInt(result)
  } finally {
    conn.release()
  }
}
