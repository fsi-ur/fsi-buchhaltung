import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { isTagSlugTaken, parseTagInput } from '~/server/utils/wiki/tags'
import { internalError } from '~/server/utils/api/errors'

export type CreateWikiTagResponse =
  | { ok: true, tagId: number }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<CreateWikiTagResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const parsed = parseTagInput(await readBody(event))
  if (!parsed.ok) return parsed
  const { slug, label } = parsed.input

  if (await isTagSlugTaken(slug, null)) {
    return { ok: false, error: `Den Kurznamen „${slug}“ gibt es bereits.` }
  }

  try {
    const tagId = await withAuditTransaction(current.user, async (conn) => {
      const result: any = await query(
        'INSERT INTO wiki_tags (slug, label) VALUES (?, ?)',
        [slug, label],
        conn,
      )
      return Number(result.insertId)
    })

    return { ok: true, tagId }
  } catch (err: any) {
    return internalError('Failed to create the wiki tag', err)
  }
})
