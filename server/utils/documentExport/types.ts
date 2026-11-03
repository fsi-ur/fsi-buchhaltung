import type { AssociationProfileRow } from '~/types/association'
import type { LocalDate } from '~/shared/time'

export interface DocumentExportFile {
  original_name: string
  mime_type: string
  data: Buffer
}

/** One column of the overview (PDF table of contents and Excel index). `Nr.`, `Seite` and `Datei` are added by the engine. */
export interface DocumentExportColumn {
  key: string
  label: string
  /** Relative width in the PDF overview; omit to leave the column out of the PDF (Excel only). */
  pdfWeight?: number
  /** Width in Excel character units; omit to leave the column out of the Excel index. */
  excelWidth?: number
  align?: 'right'
}

export interface DocumentExportItem {
  id: number
  /** Cell text per column key. */
  values: Record<string, string>
  /** Short identification, used for PDF bookmarks and as the heading of a placeholder page. */
  label: string
  /** Parts of the file name inside the ZIP, after the running number, e.g. date, number, payee. */
  fileNameParts: Array<string | null | undefined>
  /**
   * Summed into the overview's total row when the source declares an amount column. Within a
   * cost-centre scope this is the record's share for that scope, not its full total.
   */
  amount?: number
  /** The latest attached document, or null when there is none (or it is missing on disk, see `fileMissing`). */
  file: DocumentExportFile | null
  fileMissing: boolean
  /** Label/value pairs shown on the placeholder page when the record has no embeddable document. */
  details: Array<{ label: string, value: string }>
  /** Optional table below the details on the placeholder page (e.g. a receipt's positions). */
  detailTable?: {
    title: string
    columns: Array<{ label: string, weight: number, align?: 'right' }>
    rows: string[][]
    /** Indexes of rows to emphasise, e.g. the positions that fall into the cost-centre scope. */
    highlightedRows?: number[]
    /** Small explanation under the table, e.g. what the highlighting means. */
    note?: string
  }
}

export type DocumentExportLoadResult = { ok: true, items: DocumentExportItem[] } | { ok: false, error: string }

/** The resolved form of `DocumentExportRequest.costCentre`. */
export interface DocumentExportScope {
  costCentre: {
    /** The selected cost centre plus, with `includeChildren`, every cost centre below it. */
    ids: number[]
    /** e.g. "100 – Feste (inkl. untergeordneter Kostenstellen)" */
    label: string
  } | null
}

export const EMPTY_DOCUMENT_EXPORT_SCOPE: DocumentExportScope = { costCentre: null }

/**
 * Everything the engine needs to know about one kind of record. Registered in `registry.ts`;
 * the generic endpoint `POST /api/document-export/<key>` resolves it, checks `DOCUMENT_EXPORT_PERMISSIONS` and
 * hands the loaded items to the PDF/ZIP builders. Columns and the amount column may depend on the
 * scope (e.g. an extra "Anteil Kostenstelle" column that the sum then uses).
 */
export interface DocumentExportSource {
  /** Document title, e.g. "Belegexport". */
  title: string
  /** Prefix of the downloaded file name, e.g. "Belege" → `Belege_2026-11-03.pdf`. */
  fileNamePrefix: string
  noun: { one: string, many: string }
  columns: DocumentExportColumn[] | ((scope: DocumentExportScope) => DocumentExportColumn[])
  /** Column the total row is written into; requires `amount` on the items. */
  amountColumn?: string | ((scope: DocumentExportScope) => string)
  /** Column under which "Kein Dokument hinterlegt" is noted in the overview. */
  primaryColumn: string
  /** Formats the summed `amount` values. */
  formatAmount?: (value: number) => string
  /** Centered line under the title, e.g. the covered date range. */
  subtitle?: (items: DocumentExportItem[]) => string | null
  /** Explanations printed under the overview table, e.g. how split records are counted in a scope. */
  overviewNotes?: (scope: DocumentExportScope) => string[]
  /** Loads the records in export order. Must fail when an id does not exist instead of silently dropping it. */
  load: (ids: number[], scope: DocumentExportScope) => Promise<DocumentExportLoadResult>
}

export interface DocumentExportContext {
  createdOn: LocalDate
  association: AssociationProfileRow | null
  logo: { mimeType: string, data: Buffer } | null
  scope: DocumentExportScope
}

export function sourceColumns(source: DocumentExportSource, scope: DocumentExportScope) {
  return typeof source.columns === 'function' ? source.columns(scope) : source.columns
}

export function sourceAmountColumn(source: DocumentExportSource, scope: DocumentExportScope) {
  return typeof source.amountColumn === 'function' ? source.amountColumn(scope) : source.amountColumn
}
