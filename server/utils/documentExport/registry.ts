import type { DocumentExportSourceKey } from '~/shared/documentExport'
import { receiptDocumentExportSource } from './sources/receipts'
import type { DocumentExportSource } from './types'

/**
 * Every table that can bulk-export its documents. To add one: add the key to `DOCUMENT_EXPORT_SOURCE_KEYS`
 * and `DOCUMENT_EXPORT_PERMISSIONS` (shared/documentExport.ts), write a source under `sources/`
 * (columns, loader — `loadLatestAttachments` does the file part), register it here,
 * add the `documentExport.sources.<key>` nouns to i18n, and on the client make the table
 * `selectable` with a `CommonDocumentExportButton` in its `#selection-actions` slot.
 */
export const DOCUMENT_EXPORT_SOURCES: Record<DocumentExportSourceKey, DocumentExportSource> = {
  receipts: receiptDocumentExportSource,
}
