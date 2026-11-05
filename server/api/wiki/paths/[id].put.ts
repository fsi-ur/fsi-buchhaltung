import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { slugifyTitle } from '~/server/utils/wiki/articles'
import {
  articlesExist,
  isPathSlugTaken,
  normalizePathInput,
  savePathAudiences,
  savePathItems,
  validatePathFields,
} from '~/server/utils/wiki/paths'
import { internalError } from '~/server/utils/api/errors'

export type UpdateWikiPathResponse = { ok: true } | { ok: false, error: string }

const NOT_FOUND = 'Der Lernpfad wurde nicht gefunden.'

export default defineEventHandler(async (event): Promise<UpdateWikiPathResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const pathId = Number(event.context.params?.id)
  if (!Number.isInteger(pathId) || pathId <= 0) return { ok: false, error: NOT_FOUND }

  const existing = await query<Array<{ id: number }>>('SELECT id FROM wiki_paths WHERE id = ? LIMIT 1', [pathId])
  if (!existing.length) return { ok: false, error: NOT_FOUND }

  const input = normalizePathInput(await readBody(event))
  if (!input.slug) input.slug = slugifyTitle(input.title)

  const invalid = validatePathFields(input)
  if (invalid) return { ok: false, error: invalid }

  if (await isPathSlugTaken(input.slug, pathId)) {
    return { ok: false, error: 'Es gibt bereits einen Lernpfad mit diesem Kurznamen.' }
  }
  if (!await articlesExist(input.items.map(item => item.articleId))) {
    return { ok: false, error: 'Ein Artikel des Lernpfads wurde nicht gefunden.' }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        'UPDATE wiki_paths SET slug = ?, title = ?, description = ?, icon = ?, is_published = ? WHERE id = ?',
        [input.slug, input.title, input.description, input.icon, input.isPublished ? 1 : 0, pathId],
        conn,
      )

      await savePathItems(pathId, input, conn)
      await savePathAudiences(pathId, input, conn)
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to update the wiki learning path', err)
  }
})
