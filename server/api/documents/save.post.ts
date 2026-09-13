import { defineEventHandler } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { readMultipart } from '~/server/utils/api/request'
import { detachFileAttachment, getActiveFileAttachment, storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import {
  createAssociationDocument,
  DOCUMENT_ENTITY_TYPE,
  DOCUMENT_UPLOAD_FOLDER,
  getAssociationDocument,
  updateAssociationDocument,
  validateAssociationDocument,
} from '~/server/utils/associationDocuments'
import type { SaveAssociationDocumentBody } from '~/types/document'

interface SaveDocumentSuccess {
  ok: true
  id: number
}

interface SaveDocumentError {
  ok: false
  error: string
}

export type SaveDocumentResponse = SaveDocumentSuccess | SaveDocumentError

export default defineEventHandler(async (event): Promise<SaveDocumentResponse> => {
  const current = await requirePermission(event, 'settings.documents.manage')
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Ungültige Formulardaten.' }

  const documentJson = multipart.getField('document')
  if (!documentJson) return { ok: false, error: 'Es wurden keine Dokumentdaten übermittelt.' }

  let body: SaveAssociationDocumentBody
  try {
    body = JSON.parse(documentJson)
  } catch {
    return { ok: false, error: 'Ungültige Dokumentdaten.' }
  }

  const validationError = validateAssociationDocument(body)
  if (validationError) return { ok: false, error: validationError }

  const fileError = validateUploadedFile(multipart.file)
  if (fileError && multipart.file) return { ok: false, error: fileError }

  const id = Number(body.id ?? 0)

  return await withAuditTransaction(current.user, async (conn) => {
    if (id > 0) {
      const existing = await getAssociationDocument(id, conn)
      if (!existing) return { ok: false, error: 'Dokument wurde nicht gefunden.' }

      await updateAssociationDocument(id, body, conn)

      if (multipart.file) {
        const attachment = await getActiveFileAttachment(DOCUMENT_ENTITY_TYPE, id, conn)
        if (attachment) await detachFileAttachment(attachment.id, current.user.id, conn)
        await storeAndAttachUploadedFile(multipart.file, DOCUMENT_UPLOAD_FOLDER, DOCUMENT_ENTITY_TYPE, id, current.user.id, conn)
      }

      return { ok: true, id }
    }

    if (!multipart.file) return { ok: false, error: 'Bitte eine Datei hochladen.' }

    const newId = await createAssociationDocument(body, current.user.id, conn)
    await storeAndAttachUploadedFile(multipart.file, DOCUMENT_UPLOAD_FOLDER, DOCUMENT_ENTITY_TYPE, newId, current.user.id, conn)

    return { ok: true, id: newId }
  })
})
