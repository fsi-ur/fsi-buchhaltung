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

export type CreateWikiPathResponse =
  | { ok: true, pathId: number }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<CreateWikiPathResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  const input = normalizePathInput(await readBody(event))
  if (!input.slug) input.slug = slugifyTitle(input.title)

  const invalid = validatePathFields(input)
  if (invalid) return { ok: false, error: invalid }

  if (await isPathSlugTaken(input.slug, null)) {
    return { ok: false, error: 'Es gibt bereits einen Lernpfad mit diesem Kurznamen.' }
  }
  if (!await articlesExist(input.items.map(item => item.articleId))) {
    return { ok: false, error: 'Ein Artikel des Lernpfads wurde nicht gefunden.' }
  }

  try {
    const pathId = await withAuditTransaction(current.user, async (conn) => {
      const positionRows = await query<Array<{ next_position: number }>>(
        'SELECT COALESCE(MAX(position), 0) + 10 AS next_position FROM wiki_paths',
        [],
        conn,
      )

      const result = await query<{ insertId: number }>(
        'INSERT INTO wiki_paths (slug, title, description, icon, position, is_published) VALUES (?, ?, ?, ?, ?, ?)',
        [
          input.slug,
          input.title,
          input.description,
          input.icon,
          Number(positionRows[0]?.next_position ?? 10),
          input.isPublished ? 1 : 0,
        ],
        conn,
      )

      const newId = Number(result.insertId)
      await savePathItems(newId, input, conn)
      await savePathAudiences(newId, input, conn)
      return newId
    })

    return { ok: true, pathId }
  } catch (err: any) {
    return internalError('Failed to create the wiki learning path', err)
  }
})
