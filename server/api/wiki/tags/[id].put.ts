import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { isTagSlugTaken, parseTagInput } from '~/server/utils/wiki/tags'
import { internalError } from '~/server/utils/api/errors'

export type UpdateWikiTagResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Das Schlagwort wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<UpdateWikiTagResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const tagId = Number(event.context.params?.id)
  if (!Number.isInteger(tagId) || tagId <= 0) return { ok: false, error: NOT_FOUND }

  const existing = await query<Array<{ id: number }>>('SELECT id FROM wiki_tags WHERE id = ? LIMIT 1', [tagId])
  if (!existing.length) return { ok: false, error: NOT_FOUND }

  const parsed = parseTagInput(await readBody(event))
  if (!parsed.ok) return parsed
  const { slug, label } = parsed.input

  if (await isTagSlugTaken(slug, tagId)) {
    return { ok: false, error: `Den Kurznamen „${slug}“ gibt es bereits.` }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query('UPDATE wiki_tags SET slug = ?, label = ? WHERE id = ?', [slug, label, tagId], conn)
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to update the wiki tag', err)
  }
})
