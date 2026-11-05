import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { getEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { validateParent } from '~/server/utils/wiki/articles'
import { internalError } from '~/server/utils/api/errors'

export type ReorderWikiArticlesResponse = { ok: true } | { ok: false, error: string }

interface ReorderItem {
  id: number
  parentId: number | null
  position: number
}

export default defineEventHandler(async (event): Promise<ReorderWikiArticlesResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const body = await readBody(event)
  const rawItems = Array.isArray(body?.items) ? body.items : []
  if (!rawItems.length) return { ok: false, error: 'Es wurde nichts zum Sortieren übergeben.' }

  const items: ReorderItem[] = []
  for (const raw of rawItems) {
    const id = Number(raw?.id)
    const position = Number(raw?.position)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Ungültiger Artikel in der Sortierung.' }
    if (!Number.isInteger(position) || position < 0 || position > 32000) {
      return { ok: false, error: 'Ungültige Position in der Sortierung.' }
    }
    const parentId = raw?.parentId === null || raw?.parentId === undefined || raw?.parentId === ''
      ? null
      : Number(raw.parentId)
    items.push({ id, parentId, position })
  }

  const { index, subjects } = await getWikiAccess(event, current.user)

  for (const item of items) {
    const node = index.articles.get(item.id)
    if (!node) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }
    if (!levelAtLeast(getEffectiveLevel(index, subjects, item.id), 'write')) {
      return { ok: false, error: 'Du hast keine Berechtigung, diesen Artikel zu verschieben.' }
    }

    if (item.parentId !== null && !levelAtLeast(getEffectiveLevel(index, subjects, item.parentId), 'write')) {
      return { ok: false, error: 'Du hast keine Berechtigung für den Zielort.' }
    }

    const parentError = await validateParent(item.id, node.spaceId, item.parentId)
    if (parentError) return { ok: false, error: parentError }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      for (const item of items) {
        await query(
          'UPDATE wiki_articles SET parent_id = ?, position = ? WHERE id = ?',
          [item.parentId, item.position, item.id],
          conn,
        )
      }
    })
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to reorder wiki articles', err)
  }
})
