import mariadb from 'mariadb'
import { clearAuditActor, setAuditActor } from '~/server/utils/dbAudit'
import { normalizeBigInt } from '~/server/utils/normalize'
import type { User } from '~/types/user'
import { castTimestampColumn, normalizeQueryParams } from '~/shared/time'

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: Number(process.env.DB_CONN_LIMIT || 5),
  dateStrings: true,
  timezone: 'UTC',
  typeCast: castTimestampColumn,
})

export async function getDbConnection() {
  return await pool.getConnection()
}

export async function query<T = any>(sql: string, params?: unknown[], conn?: mariadb.PoolConnection): Promise<T> {
  let connection = conn
  let shouldRelease = false

  try {
    if (!connection) {
      connection = await pool.getConnection()
      shouldRelease = true
    }

    const result = await connection.query(sql, normalizeQueryParams(params))
    return normalizeBigInt(result)
  } finally {
    if (shouldRelease && connection) connection.release()
  }
}

export async function withTransaction<T>(callback: (conn: mariadb.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()
    const result = await callback(conn)
    await conn.commit()
    return normalizeBigInt(result)
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

type AuditActor = Pick<User, 'id' | 'username'> | { id: number | null, username?: string | null } | number | null | undefined

export async function withAuditTransaction<T>(
  actor: AuditActor,
  callback: (conn: mariadb.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection()

  try {
    await conn.beginTransaction()
    await setAuditActor(conn, actor, crypto.randomUUID())
    const result = await callback(conn)
    await conn.commit()
    return normalizeBigInt(result)
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    try {
      await clearAuditActor(conn)
    } finally {
      conn.release()
    }
  }
}
