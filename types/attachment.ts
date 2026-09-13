/**
 * One selection of attachments, used everywhere a record can carry files: a composed message, a
 * notification template, a wiki article. Two kinds live side by side on purpose:
 *
 * - `documentIds` point at the association's document library (`association_documents`). They are
 *   resolved late — replacing the file behind "Satzung" changes what every record carrying that
 *   document hands out.
 * - `fileIds` are one-off uploads that belong to this record alone and are deliberately NOT listed
 *   in the library, so a single odd attachment does not pollute it.
 */
export interface AttachmentSelection {
  documentIds: number[]
  fileIds: number[]
}

export function emptyAttachmentSelection(): AttachmentSelection {
  return { documentIds: [], fileIds: [] }
}

export function isAttachmentSelectionEmpty(selection: AttachmentSelection | null | undefined): boolean {
  return !selection || (!selection.documentIds.length && !selection.fileIds.length)
}

export function attachmentSelectionSize(selection: AttachmentSelection | null | undefined): number {
  return selection ? selection.documentIds.length + selection.fileIds.length : 0
}

export interface AttachmentItem {
  key: string
  kind: 'document' | 'file'
  documentId: number | null
  fileId: number | null
  title: string
  fileName: string | null
  fileSize: number | null
  mimeType: string | null
  /**
   * The record still references it, but nothing would be sent: the document was deactivated or has
   * no file, or the file row is gone. Shown as a warning rather than silently dropped — a mail
   * quietly losing its Satzung is worse than an obvious broken chip.
   */
  unavailable: boolean
}

export type AttachmentScope = 'notification' | 'notification_template' | 'wiki_article'

export const ATTACHMENT_SCOPES: AttachmentScope[] = ['notification', 'notification_template', 'wiki_article']

export interface AttachmentFileInfo {
  fileId: number
  fileName: string
  fileSize: number
  mimeType: string
}
