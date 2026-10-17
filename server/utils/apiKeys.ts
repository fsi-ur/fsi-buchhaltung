import type mariadb from 'mariadb'
import type { H3Event } from 'h3'
import { getRequestHeader, setResponseStatus } from 'h3'
import { hmacToken, makeToken } from '~/server/utils/auth'
import { query } from '~/server/utils/db'
import { utcNowSql } from '~/server/utils/time'
import { parseInstant } from '~/shared/time'
import type { ApiKey } from '~/types/apiKey'

/** Every key starts with this, so a leaked one is recognisable (e.g. by secret scanners). */
export const API_KEY_PREFIX = 'fsi_'
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8
const API_KEY_NAME_MAX_LENGTH = 127

/** `last_used_at` is only refreshed this often, so a busy website doesn't write on every request. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000

interface ApiKeyRow {
  id: number
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
  created_by_username: string | null
}

export function normalizeApiKeyName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateApiKeyName(name: string): string | null {
  if (!name) return 'Bitte einen Namen für den Schlüssel angeben.'
  if (name.length > API_KEY_NAME_MAX_LENGTH) return `Der Name darf höchstens ${API_KEY_NAME_MAX_LENGTH} Zeichen lang sein.`
  return null
}

/** Reads the key from `Authorization: Bearer <key>` or, failing that, `X-API-Key: <key>`. */
export function readApiKeyFromRequest(event: H3Event): string | null {
  const authorization = getRequestHeader(event, 'authorization')?.trim()
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(\S+)$/i)
    if (match) return match[1]!
  }
  const header = getRequestHeader(event, 'x-api-key')?.trim()
  return header || null
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const rows = await query<ApiKeyRow[]>(
    `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at, u.username AS created_by_username
     FROM api_keys k
     LEFT JOIN users u ON u.id = k.created_by
     ORDER BY k.revoked_at IS NULL DESC, k.created_at DESC, k.id DESC`,
  )

  return rows.map(row => ({
    id: Number(row.id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at != null ? String(row.last_used_at) : null,
    revokedAt: row.revoked_at != null ? String(row.revoked_at) : null,
    createdBy: row.created_by_username != null ? String(row.created_by_username) : null,
  }))
}

/** Creates a key and returns it in plain text — the only time it is ever available. */
export async function createApiKey(
  name: string,
  createdBy: number,
  conn: mariadb.PoolConnection,
): Promise<{ id: number, key: string }> {
  const key = `${API_KEY_PREFIX}${makeToken()}`

  const result: any = await query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, created_by, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [name, key.slice(0, DISPLAY_PREFIX_LENGTH), hmacToken(key), createdBy, utcNowSql()],
    conn,
  )

  return { id: Number(result.insertId), key }
}

/** Revokes a key for good. Returns false when it doesn't exist or was already revoked. */
export async function revokeApiKey(id: number, conn: mariadb.PoolConnection): Promise<boolean> {
  const result: any = await query(
    `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    [utcNowSql(), id],
    conn,
  )
  return Number(result.affectedRows) > 0
}

export type ApiKeyAuthResult = { ok: true, keyId: number } | { ok: false, error: string }

/**
 * Authenticates a request against `api_keys`. Sets 401 on failure, so external clients get a proper
 * status code alongside the usual `{ ok: false, error }` body.
 */
export async function requireApiKey(event: H3Event, now: Date = new Date()): Promise<ApiKeyAuthResult> {
  const key = readApiKeyFromRequest(event)
  if (!key || !key.startsWith(API_KEY_PREFIX)) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Missing or malformed API key' }
  }

  const rows = await query<{ id: number, last_used_at: string | null }[]>(
    `SELECT id, last_used_at FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL LIMIT 1`,
    [hmacToken(key)],
  )

  const row = rows[0]
  if (!row) {
    setResponseStatus(event, 401)
    return { ok: false, error: 'Invalid API key' }
  }

  const lastUsed = parseInstant(row.last_used_at)?.getTime() ?? 0
  if (now.getTime() - lastUsed >= LAST_USED_RESOLUTION_MS) {
    await query(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, [utcNowSql(now), row.id])
  }

  return { ok: true, keyId: Number(row.id) }
}
