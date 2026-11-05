import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

export type DeleteWikiGlossaryTermResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Glossar-Eintrag wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<DeleteWikiGlossaryTermResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const termId = Number(event.context.params?.id)
  if (!Number.isInteger(termId) || termId <= 0) return { ok: false, error: NOT_FOUND }

  const rows = await query<Array<{ id: number }>>(
    'SELECT id FROM wiki_glossary_terms WHERE id = ? LIMIT 1',
    [termId],
  )
  if (!rows.length) return { ok: false, error: NOT_FOUND }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query('DELETE FROM wiki_glossary_terms WHERE id = ?', [termId], conn)
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to delete the glossary term', err)
  }
})
