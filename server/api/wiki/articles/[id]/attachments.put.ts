import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { loadAttachmentItems, normalizeAttachmentSelection, saveAttachmentSelection } from '~/server/utils/attachments'
import { requireArticleWrite } from '~/server/utils/wiki/access'
import { WIKI_ARTICLE_ENTITY_TYPE } from '~/server/utils/wiki/articles'
import type { WikiAttachment } from '~/types/wiki'

export type SaveWikiAttachmentsResponse =
  | { ok: true, attachments: WikiAttachment[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<SaveWikiAttachmentsResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const access = await requireArticleWrite(event, current.user, articleId)
  if (!access.ok) return access

  const body = await readBody<{ attachments?: unknown }>(event)
  const selection = normalizeAttachmentSelection(body?.attachments, 'Anhänge')
  if (!selection.ok) return selection

  try {
    await withAuditTransaction(current.user, conn =>
      saveAttachmentSelection(WIKI_ARTICLE_ENTITY_TYPE, articleId, selection.value, Number(current.user.id), conn))

    return { ok: true, attachments: await loadAttachmentItems(selection.value) }
  } catch (err: any) {
    return { ok: false, error: `Failed to save wiki attachments: ${err}` }
  }
})
