import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

export type ReorderWikiPathsResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<ReorderWikiPathsResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const body = await readBody(event)
  const rawIds = Array.isArray(body?.pathIds) ? body.pathIds : []
  if (!rawIds.length) return { ok: false, error: 'Es wurde nichts zum Sortieren übergeben.' }

  const pathIds: number[] = []
  for (const raw of rawIds) {
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Der Lernpfad wurde nicht gefunden.' }
    if (pathIds.includes(id)) return { ok: false, error: 'Ein Lernpfad wurde doppelt übergeben.' }
    pathIds.push(id)
  }

  const rows = await query<Array<{ id: number }>>(
    `SELECT id FROM wiki_paths WHERE id IN (${pathIds.map(() => '?').join(', ')})`,
    pathIds,
  )
  if (rows.length !== pathIds.length) return { ok: false, error: 'Der Lernpfad wurde nicht gefunden.' }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      for (const [index, pathId] of pathIds.entries()) {
        await query('UPDATE wiki_paths SET position = ? WHERE id = ?', [(index + 1) * 10, pathId], conn)
      }
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to reorder the wiki learning paths', err)
  }
})
