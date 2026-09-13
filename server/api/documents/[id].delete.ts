import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { detachFileAttachment, getActiveFileAttachment } from '~/server/utils/files'
import {
  countDocumentUses,
  DOCUMENT_ENTITY_TYPE,
  getAssociationDocument,
} from '~/server/utils/associationDocuments'
import { getNotificationSettings } from '~/server/utils/notifications/settings'

interface DeleteDocumentSuccess {
  ok: true
}

interface DeleteDocumentError {
  ok: false
  error: string
}

export type DeleteDocumentResponse = DeleteDocumentSuccess | DeleteDocumentError

export default defineEventHandler(async (event): Promise<DeleteDocumentResponse> => {
  const current = await requirePermission(event, 'settings.documents.manage')
  if (!current.ok) return current

  const id = Number(event.context.params?.id)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Ungültige Dokument-ID.' }

  const document = await getAssociationDocument(id)
  if (!document) return { ok: false, error: 'Dokument wurde nicht gefunden.' }

  const settings = await getNotificationSettings()
  const usedByTemplate = Object.values(settings.template_attachments).some(selection => selection?.documentIds.includes(id))
  if (usedByTemplate) return { ok: false, error: 'Dieses Dokument ist noch einer Nachrichtenvorlage zugeordnet.' }

  if (await countDocumentUses(id)) {
    return { ok: false, error: 'Dieses Dokument ist noch mit Nachrichten oder Wiki-Artikeln verknüpft.' }
  }

  return await withAuditTransaction(current.user, async (conn) => {
    const attachment = await getActiveFileAttachment(DOCUMENT_ENTITY_TYPE, id, conn)
    if (attachment) await detachFileAttachment(attachment.id, current.user.id, conn)

    await query(`DELETE FROM association_documents WHERE id = ?`, [id], conn)

    return { ok: true }
  })
})
