import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

export type ReorderWikiSpacesResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<ReorderWikiSpacesResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const body = await readBody(event)
  const rawIds = Array.isArray(body?.spaceIds) ? body.spaceIds : []
  if (!rawIds.length) return { ok: false, error: 'Es wurde nichts zum Sortieren übergeben.' }

  const spaceIds: number[] = []
  for (const raw of rawIds) {
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }
    if (spaceIds.includes(id)) return { ok: false, error: 'Ein Bereich wurde doppelt übergeben.' }
    spaceIds.push(id)
  }

  const rows = await query<Array<{ id: number }>>(
    `SELECT id FROM wiki_spaces WHERE id IN (${spaceIds.map(() => '?').join(', ')})`,
    spaceIds,
  )
  if (rows.length !== spaceIds.length) return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      for (const [index, spaceId] of spaceIds.entries()) {
        await query('UPDATE wiki_spaces SET position = ? WHERE id = ?', [(index + 1) * 10, spaceId], conn)
      }
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to reorder the wiki spaces', err)
  }
})
