import { resolveStoredFilePath } from '~/server/utils/storedFilePath'
import fs from 'fs/promises'
import path from 'path'
import { query } from '~/server/utils/db'
import { resolveSelectedCostCentreIds } from '~/server/utils/financeAnalysis/filters'
import { buildXlsxWorkbook } from '~/server/utils/xlsx'
import { buildZip } from '~/server/utils/zip'
import {
  MAX_DOCUMENT_EXPORT_BYTES,
  MAX_DOCUMENT_EXPORT_COUNT,
  type DocumentExportCostCentreScope,
  type DocumentExportFormat,
  type DocumentExportRequest,
} from '~/shared/documentExport'
import type { LocalDate, LocalDateTime } from '~/shared/time'
import {
  sourceAmountColumn,
  sourceColumns,
  type DocumentExportContext,
  type DocumentExportFile,
  type DocumentExportItem,
  type DocumentExportScope,
  type DocumentExportSource,
} from './types'

export function parseDocumentExportRequest(body: unknown): { ok: true, request: DocumentExportRequest } | { ok: false, error: string } {
  const raw = (body ?? {}) as Record<string, unknown>

  const format = raw.format
  if (format !== 'pdf' && format !== 'zip') return { ok: false, error: 'Ungültiges Exportformat.' }

  if (!Array.isArray(raw.ids) || !raw.ids.length) {
    return { ok: false, error: 'Bitte mindestens einen Eintrag auswählen.' }
  }

  const ids: number[] = []
  for (const value of raw.ids) {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'Ungültige ID.' }
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length > MAX_DOCUMENT_EXPORT_COUNT) {
    return { ok: false, error: `Höchstens ${MAX_DOCUMENT_EXPORT_COUNT} Einträge können auf einmal exportiert werden.` }
  }

  let costCentre: DocumentExportCostCentreScope | null = null
  if (raw.costCentre !== undefined && raw.costCentre !== null) {
    const scope = raw.costCentre as Record<string, unknown>
    const id = Number(scope.id)
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'Ungültige Kostenstelle.' }
    costCentre = { id, includeChildren: scope.includeChildren === true }
  }

  return {
    ok: true,
    request: {
      ids,
      format: format as DocumentExportFormat,
      includeCover: raw.includeCover !== false,
      includeIndex: raw.includeIndex !== false,
      costCentre,
    },
  }
}

/** Resolves the requested cost-centre scope into the concrete cost centre ids and a printable label. */
export async function resolveDocumentExportScope(costCentre: DocumentExportCostCentreScope | null | undefined): Promise<{ ok: true, scope: DocumentExportScope } | { ok: false, error: string }> {
  if (!costCentre) return { ok: true, scope: { costCentre: null } }

  const [row] = await query<Array<{ code: string, name: string }>>(
    'SELECT code, name FROM cost_centres WHERE id = ? LIMIT 1',
    [costCentre.id],
  )
  if (!row) return { ok: false, error: 'Die Kostenstelle existiert nicht.' }

  const ids = await resolveSelectedCostCentreIds(costCentre.id, costCentre.includeChildren)
  const hasChildren = ids.length > 1
  return {
    ok: true,
    scope: {
      costCentre: {
        ids,
        label: `${compactParts([row.code, row.name], ' – ')}${hasChildren ? ' (inkl. untergeordneter Kostenstellen)' : ''}`,
      },
    },
  }
}

export interface LoadedAttachment {
  file: DocumentExportFile | null
  fileMissing: boolean
}

/**
 * The latest active attachment of each entity (the one its editor shows) with the file's bytes.
 * Entities without an attachment are absent from the map. Fails when the files together exceed
 * `MAX_DOCUMENT_EXPORT_BYTES`; a file missing on disk is reported per entity instead.
 */
export async function loadLatestAttachments(entityType: string, entityIds: number[]): Promise<{ ok: true, attachments: Map<number, LoadedAttachment> } | { ok: false, error: string }> {
  const attachments = new Map<number, LoadedAttachment>()
  if (!entityIds.length) return { ok: true, attachments }

  const placeholders = entityIds.map(() => '?').join(',')
  const rows = await query<Array<{ entity_id: number, file_path: string, original_name: string, mime_type: string, file_size: number }>>(
    `SELECT fa.entity_id, f.file_path, f.original_name, f.mime_type, f.file_size
     FROM file_attachments fa
     JOIN files f ON f.id = fa.file_id
     WHERE fa.entity_type = ? AND fa.detached_at IS NULL AND fa.entity_id IN (${placeholders})
       AND fa.id = (
         SELECT MAX(latest.id) FROM file_attachments latest
         WHERE latest.entity_type = fa.entity_type AND latest.entity_id = fa.entity_id AND latest.detached_at IS NULL
       )`,
    [entityType, ...entityIds],
  )

  const totalBytes = rows.reduce((sum, row) => sum + Number(row.file_size || 0), 0)
  if (totalBytes > MAX_DOCUMENT_EXPORT_BYTES) {
    return { ok: false, error: `Die ausgewählten Dokumente sind zusammen größer als ${Math.round(MAX_DOCUMENT_EXPORT_BYTES / 1024 / 1024)} MB. Bitte weniger Einträge auf einmal exportieren.` }
  }

  for (const row of rows) {
    const entityId = Number(row.entity_id)
    try {
      const absolutePath = resolveStoredFilePath(row.file_path)
      if (!absolutePath) throw new Error('file path outside UPLOAD_DIR')
      const data = await fs.readFile(absolutePath)
      attachments.set(entityId, { file: { original_name: row.original_name, mime_type: row.mime_type, data }, fileMissing: false })
    } catch (err) {
      console.error(`document export: file of ${entityType} ${entityId} could not be read`, err)
      attachments.set(entityId, { file: null, fileMissing: true })
    }
  }

  return { ok: true, attachments }
}

export function formatExportDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}

export function compactParts(parts: Array<string | null | undefined>, separator: string) {
  return parts.map(part => String(part ?? '').trim()).filter(Boolean).join(separator)
}

/** Text shown wherever a record has no document of its own in the export. */
export function missingDocumentText(item: DocumentExportItem) {
  return item.fileMissing ? 'Datei fehlt im Speicher' : 'Kein Dokument hinterlegt'
}

export function countLabel(source: DocumentExportSource, count: number) {
  return `${count} ${count === 1 ? source.noun.one : source.noun.many}`
}

export function totalAmount(items: DocumentExportItem[]) {
  return Math.round(items.reduce((sum, item) => sum + (item.amount ?? 0), 0) * 100) / 100
}

export function exportFooterLabel(source: DocumentExportSource, context: DocumentExportContext) {
  return compactParts([context.association?.short_name || context.association?.name, source.title], ' · ')
}

function sanitizeFileNamePart(value: string, maxLength: number) {
  return value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, maxLength)
    .trim()
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
}

/**
 * File name inside the ZIP: running number (keeps the export order and makes names unique) plus the
 * source's name parts, e.g. `003_2026-10-14_R-1234_Getränke Müller.pdf`.
 */
export function documentExportEntryName(item: DocumentExportItem, position: number, total: number) {
  const digits = Math.max(3, String(total).length)
  const extension = EXTENSION_BY_MIME[item.file?.mime_type ?? '']
    ?? (path.extname(item.file?.original_name ?? '').toLowerCase() || '.bin')
  const parts = [
    String(position).padStart(digits, '0'),
    ...item.fileNameParts.map(part => (part ? sanitizeFileNamePart(part, 60) : '')),
  ].filter(Boolean)
  return `${parts.join('_')}${extension}`
}

export function documentExportFileName(source: DocumentExportSource, format: DocumentExportFormat, createdOn: LocalDate) {
  return `${source.fileNamePrefix}_${createdOn}.${format}`
}

/** Rows of the Excel index: running number, the source's Excel columns and the file name in the archive (or why there is none). */
export function documentIndexRows(source: DocumentExportSource, items: DocumentExportItem[], fileNames: Array<string | null>, scope: DocumentExportScope) {
  const columns = sourceColumns(source, scope).filter(column => column.excelWidth !== undefined)
  return items.map((item, index) => [
    String(index + 1),
    ...columns.map(column => item.values[column.key] ?? ''),
    fileNames[index] ?? missingDocumentText(item),
  ])
}

export function buildDocumentExportZip(params: {
  source: DocumentExportSource
  items: DocumentExportItem[]
  includeIndex: boolean
  modifiedAt: LocalDateTime
  context: DocumentExportContext
}): { ok: true, data: Buffer } | { ok: false, error: string } {
  const { source, items, includeIndex, modifiedAt, context } = params
  const { association, logo, createdOn } = context

  const entries: Array<{ name: string, data: Buffer }> = []
  const fileNames = items.map((item, index) => {
    if (!item.file) return null
    const name = documentExportEntryName(item, index + 1, items.length)
    entries.push({ name, data: item.file.data })
    return name
  })

  if (!entries.length && !includeIndex) {
    return { ok: false, error: 'Keiner der ausgewählten Einträge hat ein Dokument. Bitte die Excel-Übersicht beilegen oder das PDF-Format wählen.' }
  }

  if (includeIndex) {
    const { scope } = context
    const summary = [
      scope.costCentre ? `Kostenstelle: ${scope.costCentre.label}` : null,
      countLabel(source, items.length),
      sourceAmountColumn(source, scope) && source.formatAmount ? `Summe: ${source.formatAmount(totalAmount(items))}` : null,
      `Stand: ${formatExportDate(createdOn)}`,
    ]
    const workbook = buildXlsxWorkbook({
      modifiedAt,
      sheetName: source.noun.many,
      title: source.title,
      subtitle: compactParts(summary, ' · '),
      columns: [
        { label: 'Nr.', width: 6 },
        ...sourceColumns(source, scope).filter(column => column.excelWidth !== undefined).map(column => ({ label: column.label, width: column.excelWidth })),
        { label: 'Datei', width: 48 },
      ],
      rows: documentIndexRows(source, items, fileNames, scope),
      orientation: 'landscape',
      footerLabel: exportFooterLabel(source, context),
      emptyText: 'Keine Einträge ausgewählt.',
      letterhead: association
        ? {
            name: association.name,
            addressLines: [
              compactParts([association.street, association.street_number], ' '),
              compactParts([association.postal_code, association.city], ' '),
            ],
          }
        : null,
      logo,
    })
    entries.push({ name: `${source.fileNamePrefix}_Übersicht_${createdOn}.xlsx`, data: workbook })
  }

  return { ok: true, data: buildZip(entries, modifiedAt) }
}
