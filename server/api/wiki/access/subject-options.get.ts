import { defineEventHandler, getQuery } from 'h3'
import { query } from '~/server/utils/db'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import { PERMISSIONS } from '~/config/permissions'
import type { WikiGrantSubjectType } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export interface WikiSubjectOption {
  type: WikiGrantSubjectType
  id: number
  key: string
  label: string
}

export type WikiSubjectOptionsResponse =
  | { ok: true, options: WikiSubjectOption[] }
  | { ok: false, error: string }

const LIMIT = 25

export default defineEventHandler(async (event): Promise<WikiSubjectOptionsResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const params = getQuery(event)
  const type = String(params.type ?? '') as WikiGrantSubjectType
  const term = String(params.q ?? '').trim()
  const like = `%${term}%`

  try {
    if (type === 'permission') {
      const options = PERMISSIONS
        .filter(permission => !term || permission.key.toLowerCase().includes(term.toLowerCase()))
        .slice(0, LIMIT)
        .map(permission => ({ type, id: 0, key: permission.key as string, label: permission.labelKey }))
      return { ok: true, options }
    }

    if (type === 'user' || type === 'role') {
      if (!hasPermission(current.user, 'users.view')) {
        return { ok: false, error: 'Du darfst die Benutzerliste nicht einsehen.' }
      }
    }

    const source = type === 'user'
      ? { table: 'users', column: 'username', extra: 'AND is_active = 1' }
      : type === 'role'
        ? { table: 'roles', column: 'name', extra: '' }
        : type === 'position'
          ? { table: 'positions', column: 'name', extra: 'AND is_active = 1' }
          : type === 'subdivision'
            ? { table: 'subdivisions', column: 'name', extra: 'AND is_active = 1' }
            : null

    if (!source) return { ok: false, error: 'Ungültige Art von Berechtigten.' }

    const rows = await query<Array<{ id: number, label: string }>>(
      `SELECT id, ${source.column} AS label
       FROM ${source.table}
       WHERE ${source.column} LIKE ? ${source.extra}
       ORDER BY ${source.column}
       LIMIT ${LIMIT}`,
      [like],
    )

    return {
      ok: true,
      options: rows.map(row => ({ type, id: Number(row.id), key: '', label: row.label })),
    }
  } catch (err: any) {
    return internalError('Failed to load subject options', err)
  }
})
