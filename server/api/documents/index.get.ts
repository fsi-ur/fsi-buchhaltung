import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { DOCUMENT_ACCESS_PERMISSIONS, listAssociationDocuments } from '~/server/utils/associationDocuments'
import type { AssociationDocument } from '~/types/document'

interface ListDocumentsSuccess {
  ok: true
  documents: AssociationDocument[]
}

interface ListDocumentsError {
  ok: false
  error: string
}

export type ListDocumentsResponse = ListDocumentsSuccess | ListDocumentsError

export default defineEventHandler(async (event): Promise<ListDocumentsResponse> => {
  const current = await requirePermission(event, DOCUMENT_ACCESS_PERMISSIONS)
  if (!current.ok) return current

  const activeOnly = String(getQuery(event).activeOnly ?? '') === 'true'

  return { ok: true, documents: await listAssociationDocuments({ activeOnly }) }
})
