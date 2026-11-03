/**
 * Bulk document export: bundle the documents of several selected records (receipts, …) into one
 * merged PDF or a ZIP of the original files. Shared between the client dialog and the server engine.
 * A new table opts in by adding its key here and registering a source in
 * `server/utils/documentExport/registry.ts`, its permissions below and the `documentExport.sources.<key>` i18n nouns.
 */
import type { PermissionKey } from '~/config/permissions'

export const DOCUMENT_EXPORT_SOURCE_KEYS = ['receipts'] as const
export type DocumentExportSourceKey = typeof DOCUMENT_EXPORT_SOURCE_KEYS[number]

/**
 * All of these are required to export a source — at least the rights needed to open each record and
 * its file one by one. The endpoint enforces them; the client uses them to show the selection at all.
 */
export const DOCUMENT_EXPORT_PERMISSIONS: Record<DocumentExportSourceKey, PermissionKey[]> = {
  receipts: ['receipts.view', 'files.view'],
}

/** `pdf` = one merged document, `zip` = the original files (optionally with an Excel index). */
export type DocumentExportFormat = 'pdf' | 'zip'

/**
 * Optional context an export is made in, e.g. from the finance analysis filtered to one cost centre.
 * It does not choose the records (`ids` does) — it changes how they are accounted: records spread over
 * several cost centres stay complete, but their share for the scope is shown and summed.
 */
export interface DocumentExportCostCentreScope {
  id: number
  /** Also count positions on cost centres below `id`. */
  includeChildren: boolean
}

export interface DocumentExportRequest {
  ids: number[]
  format: DocumentExportFormat
  /** pdf only: overview page(s) acting as a linked table of contents before the documents. */
  includeCover: boolean
  /** zip only: an .xlsx overview of the exported records next to the files. */
  includeIndex: boolean
  /** Only for sources listed in `DOCUMENT_EXPORT_COST_CENTRE_SCOPE`. */
  costCentre?: DocumentExportCostCentreScope | null
}

/** Sources whose records are booked on cost centres and can therefore be exported for one. */
export const DOCUMENT_EXPORT_COST_CENTRE_SCOPE: Record<DocumentExportSourceKey, boolean> = {
  receipts: true,
}

/** Upper bound per export so a single request cannot pull a whole archive into memory. */
export const MAX_DOCUMENT_EXPORT_COUNT = 250
/** Sum of the attached files' sizes; the export is built in memory. */
export const MAX_DOCUMENT_EXPORT_BYTES = 250 * 1024 * 1024

export function isDocumentExportSourceKey(value: unknown): value is DocumentExportSourceKey {
  return typeof value === 'string' && (DOCUMENT_EXPORT_SOURCE_KEYS as readonly string[]).includes(value)
}
