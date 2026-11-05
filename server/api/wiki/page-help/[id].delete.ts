import { defineEventHandler, getRouterParam } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

export type DeleteWikiPageHelpResponse =
  | { ok: true }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<DeleteWikiPageHelpResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const entryId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return { ok: false, error: 'Die Verknüpfung wurde nicht gefunden.' }
  }

  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_page_help WHERE id = ? LIMIT 1',
    [entryId],
  )
  if (!rows.length) return { ok: false, error: 'Die Verknüpfung wurde nicht gefunden.' }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query('DELETE FROM wiki_page_help WHERE id = ?', [entryId], conn)
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to delete the page help mapping', err)
  }
})
