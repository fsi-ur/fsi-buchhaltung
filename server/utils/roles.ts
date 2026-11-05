import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'

interface RoleIdRow {
  id: number
}

export async function getDefaultRoleId(conn?: mariadb.PoolConnection) {
  const rows = await query<RoleIdRow[]>(
    `SELECT id
     FROM roles
     WHERE is_default = 1
       AND is_active = 1
     ORDER BY id ASC
     LIMIT 1`,
    [],
    conn
  )

  return rows.length > 0 ? Number(rows[0]!.id) : null
}

export async function assignDefaultRoleToUser(userId: number, conn?: mariadb.PoolConnection) {
  const defaultRoleId = await getDefaultRoleId(conn)
  if (!defaultRoleId) return null

  await query(
    `INSERT IGNORE INTO user_roles (user_id, role_id)
     VALUES (?, ?)`,
    [userId, defaultRoleId],
    conn
  )

  return defaultRoleId
}
