import type * as mariadb from 'mariadb'
import { query, withAuditTransaction } from '~/server/utils/db'
import { toDbBoolean } from '~/server/utils/api/request'
import type { User } from '~/types/user'

interface ToggleActiveOptions<T extends Record<string, any>> {
  table: string
  entityType: string
  id: number
  isActive: boolean
  user: Pick<User, 'id' | 'username'>
  notFoundMessage: string
}

export async function toggleActiveRecord<T extends Record<string, any>>({
  table,
  entityType,
  id,
  isActive,
  user,
  notFoundMessage,
}: ToggleActiveOptions<T>) {
  const active = toDbBoolean(isActive)

  return withAuditTransaction(user, async (conn: mariadb.PoolConnection) => {
    const existingRows = await query<T[]>(
      `SELECT * FROM ${table} WHERE id = ? LIMIT 1`,
      [id],
      conn,
    )

    if (!existingRows.length) {
      return { ok: false as const, error: notFoundMessage }
    }

    await query(
      `UPDATE ${table} SET is_active = ? WHERE id = ?`,
      [active, id],
      conn,
    )

    return { ok: true as const }
  })
}
