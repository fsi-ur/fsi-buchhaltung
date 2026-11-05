import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

export type DeleteWikiPathResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Lernpfad wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<DeleteWikiPathResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const pathId = Number(event.context.params?.id)
  if (!Number.isInteger(pathId) || pathId <= 0) return { ok: false, error: NOT_FOUND }

  const existing = await query<Array<{ id: number }>>('SELECT id FROM wiki_paths WHERE id = ? LIMIT 1', [pathId])
  if (!existing.length) return { ok: false, error: NOT_FOUND }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query('DELETE FROM wiki_paths WHERE id = ?', [pathId], conn)
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to delete the wiki learning path', err)
  }
})
