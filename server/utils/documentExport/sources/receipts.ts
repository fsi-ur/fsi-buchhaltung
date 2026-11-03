import { query } from '~/server/utils/db'
import { formatMoney } from '~/server/utils/invoicePdf'
import { ReceiptStatus } from '~/types/receipt'
import { compactParts, formatExportDate, loadLatestAttachments } from '../engine'
import type { DocumentExportColumn, DocumentExportItem, DocumentExportScope, DocumentExportSource } from '../types'

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  [ReceiptStatus.Draft]: 'Entwurf',
  [ReceiptStatus.Open]: 'Offen',
  [ReceiptStatus.Paid]: 'Bezahlt',
  [ReceiptStatus.Cancelled]: 'Storniert',
}

interface ReceiptRow {
  id: number
  receipt_date: string
  receipt_number: string | null
  company_name: string | null
  description: string | null
  status: ReceiptStatus
}

interface PositionRow {
  receipt_id: number
  cost_centre_id: number | null
  sphere_code: string | null
  sphere_name: string | null
  cost_centre_code: string | null
  cost_centre_name: string | null
  amount: number | string
  tax: number | null
}

function roundCents(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Receipts in export order (receipt date ascending, then id) with positions and the attached document.
 * Within a cost-centre scope each receipt stays complete, but `amount` (what the overview sums) is the
 * share of its positions on the scope's cost centres, and those positions are highlighted.
 */
async function loadReceipts(ids: number[], scope: DocumentExportScope) {
  const placeholders = ids.map(() => '?').join(',')

  const receipts = await query<ReceiptRow[]>(
    `SELECT r.id, r.receipt_date, r.receipt_number, c.name AS company_name, r.description, r.status
     FROM receipts r
     LEFT JOIN companies c ON c.id = r.company_id
     WHERE r.id IN (${placeholders})
     ORDER BY r.receipt_date ASC, r.id ASC`,
    ids,
  )
  if (receipts.length !== ids.length) {
    return { ok: false as const, error: 'Mindestens ein ausgewählter Beleg existiert nicht mehr.' }
  }

  const positions = await query<PositionRow[]>(
    `SELECT rp.receipt_id, rp.cost_centre AS cost_centre_id, s.code AS sphere_code, s.name AS sphere_name,
            cc.code AS cost_centre_code, cc.name AS cost_centre_name, rp.amount, rp.tax
     FROM receipt_positions rp
     LEFT JOIN spheres s ON s.id = rp.sphere
     LEFT JOIN cost_centres cc ON cc.id = rp.cost_centre
     WHERE rp.receipt_id IN (${placeholders})
     ORDER BY rp.id ASC`,
    ids,
  )

  const attachments = await loadLatestAttachments('receipt', ids)
  if (!attachments.ok) return attachments

  const scopeIds = scope.costCentre ? new Set(scope.costCentre.ids) : null
  const inScope = (position: PositionRow) => scopeIds !== null && scopeIds.has(Number(position.cost_centre_id))

  const items: DocumentExportItem[] = receipts.map((row) => {
    const id = Number(row.id)
    const date = String(row.receipt_date).slice(0, 10)
    const ownPositions = positions.filter(position => Number(position.receipt_id) === id)
    const amount = roundCents(ownPositions.reduce((sum, position) => sum + Number(position.amount), 0))
    const share = roundCents(ownPositions.filter(inScope).reduce((sum, position) => sum + Number(position.amount), 0))
    const highlightedRows = scopeIds ? ownPositions.flatMap((position, index) => (inScope(position) ? [index] : [])) : []
    const isSplit = scopeIds !== null && highlightedRows.length < ownPositions.length
    const status = RECEIPT_STATUS_LABELS[row.status] ?? row.status
    const attachment = attachments.attachments.get(id)

    return {
      id,
      values: {
        receipt_date: formatExportDate(date),
        receipt_number: row.receipt_number ?? '',
        company_name: row.company_name ?? '',
        description: row.description ?? '',
        status,
        amount: formatMoney(amount),
        share: formatMoney(share),
      },
      label: compactParts([
        `Beleg ${formatExportDate(date)}`,
        row.receipt_number ? `Nr. ${row.receipt_number}` : null,
        row.company_name,
      ], ' · '),
      fileNameParts: [date, row.receipt_number, row.company_name],
      amount: scopeIds ? share : amount,
      file: attachment?.file ?? null,
      fileMissing: attachment?.fileMissing ?? false,
      details: [
        { label: 'Belegdatum', value: formatExportDate(date) },
        { label: 'Beleg-Nr.', value: row.receipt_number ?? '' },
        { label: 'Zahlungsempfänger', value: row.company_name ?? '' },
        { label: 'Status', value: status },
        { label: 'Betrag (Brutto)', value: formatMoney(amount) },
        ...(scopeIds ? [{ label: 'Anteil Kostenstelle', value: formatMoney(share) }] : []),
        { label: 'Beschreibung', value: row.description ?? '' },
      ],
      detailTable: {
        title: 'Positionen',
        columns: [
          { label: 'Sphäre', weight: 1.6 },
          { label: 'Kostenstelle', weight: 2.4 },
          { label: 'MwSt.', weight: 0.7, align: 'right' },
          { label: 'Betrag', weight: 1.1, align: 'right' },
        ],
        rows: ownPositions.map(position => [
          compactParts([position.sphere_code, position.sphere_name], ' – ') || '-',
          compactParts([position.cost_centre_code, position.cost_centre_name], ' – ') || '-',
          `${Number(position.tax ?? 0)}%`,
          formatMoney(Number(position.amount)),
        ]),
        highlightedRows: isSplit ? highlightedRows : undefined,
        note: isSplit ? `Hervorgehoben: Positionen der Kostenstelle ${scope.costCentre!.label}.` : undefined,
      },
    }
  })

  return { ok: true as const, items }
}

/** Within a cost-centre scope the overview also shows the receipt's share for it, next to its full amount. */
function receiptColumns(scope: DocumentExportScope): DocumentExportColumn[] {
  const scoped = scope.costCentre !== null
  return [
    { key: 'receipt_date', label: 'Belegdatum', pdfWeight: 1, excelWidth: 13 },
    { key: 'receipt_number', label: 'Beleg-Nr.', pdfWeight: 1.15, excelWidth: 18 },
    { key: 'company_name', label: 'Zahlungsempfänger', pdfWeight: scoped ? 1.9 : 2.3, excelWidth: 30 },
    { key: 'description', label: 'Beschreibung', excelWidth: 36 },
    { key: 'status', label: 'Status', pdfWeight: 0.85, excelWidth: 12 },
    { key: 'amount', label: 'Betrag (Brutto)', pdfWeight: 1.15, excelWidth: 16, align: 'right' },
    ...(scoped ? [{ key: 'share', label: 'Anteil Kostenstelle', pdfWeight: 1.15, excelWidth: 18, align: 'right' as const }] : []),
  ]
}

export const receiptDocumentExportSource: DocumentExportSource = {
  title: 'Belegexport',
  fileNamePrefix: 'Belege',
  noun: { one: 'Beleg', many: 'Belege' },
  columns: receiptColumns,
  amountColumn: scope => (scope.costCentre ? 'share' : 'amount'),
  primaryColumn: 'company_name',
  formatAmount: formatMoney,
  subtitle: (items) => {
    const dates = items.map(item => item.details[0]?.value).filter(Boolean) as string[]
    if (!dates.length) return null
    const first = dates[0]!
    const last = dates[dates.length - 1]!
    return first === last ? `Belegdatum: ${first}` : `Belegdatum: ${first} bis ${last}`
  },
  overviewNotes: scope => (scope.costCentre
    ? ['Belege mit Positionen auf mehreren Kostenstellen sind vollständig enthalten; „Anteil Kostenstelle“ und die Summe berücksichtigen nur die Positionen der gewählten Kostenstelle.']
    : []),
  load: loadReceipts,
}
