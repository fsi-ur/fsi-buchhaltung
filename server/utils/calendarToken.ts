import type mariadb from 'mariadb'
import { hmacToken, makeToken } from '~/server/utils/auth'
import { query } from '~/server/utils/db'
import { utcNowSql } from '~/server/utils/time'

export async function generateCalendarToken(userId: number, conn?: mariadb.PoolConnection): Promise<string> {
  const rawToken = makeToken()
  const tokenHash = hmacToken(rawToken)

  await query(
    `UPDATE users SET calendar_token_hash = ?, calendar_token_created_at = ? WHERE id = ?`,
    [tokenHash, utcNowSql(), userId],
    conn,
  )

  return rawToken
}

export async function hasCalendarToken(userId: number): Promise<boolean> {
  const rows = await query<{ calendar_token_hash: string | null }[]>(
    `SELECT calendar_token_hash FROM users WHERE id = ? LIMIT 1`,
    [userId],
  )

  return Boolean(rows[0]?.calendar_token_hash)
}

export async function getUserByCalendarToken(rawToken: string): Promise<{ id: number } | null> {
  const tokenHash = hmacToken(rawToken)
  const rows = await query<{ id: number, is_active: number }[]>(
    `SELECT id, is_active FROM users WHERE calendar_token_hash = ? LIMIT 1`,
    [tokenHash],
  )

  const user = rows[0]
  if (!user || !user.is_active) return null

  return { id: Number(user.id) }
}
