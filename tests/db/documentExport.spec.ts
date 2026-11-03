import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import { attachFileToEntity, detachFileAttachment } from '~/server/utils/files'
import { receiptDocumentExportSource } from '~/server/utils/documentExport/sources/receipts'
import { resolveDocumentExportScope } from '~/server/utils/documentExport/engine'
import { EMPTY_DOCUMENT_EXPORT_SCOPE } from '~/server/utils/documentExport/types'
import { parseFinanceAnalysisFilters, resolveSelectedCostCentreIds } from '~/server/utils/financeAnalysis/filters'
import { loadFinanceAnalysisReceipts } from '~/server/utils/financeAnalysis/receipts'
import { resetDatabase } from '../helpers/db'
import { createCompany, createCostCentre, createSphere, createUser, resetFixtureCounter } from '../helpers/fixtures'

let userId: number
let companyId: number
let sphereId: number
let costCentreId: number

async function createReceipt(date: string, number: string | null = null, amounts: number[] = [10]) {
  const result = await query<any>(
    `INSERT INTO receipts (company_id, receipt_date, receipt_number, description, status) VALUES (?, ?, ?, NULL, 'paid')`,
    [companyId, date, number],
  )
  const id = Number(result.insertId)
  for (const amount of amounts) {
    await query(
      'INSERT INTO receipt_positions (receipt_id, sphere, cost_centre, amount, tax) VALUES (?, ?, ?, ?, 19)',
      [id, sphereId, costCentreId, amount],
    )
  }
  return id
}

/** A file row plus its bytes under UPLOAD_DIR (a temp dir in the DB test env); `onDisk: false` leaves the bytes out. */
async function createStoredFile(name: string, content: string, options: { onDisk?: boolean } = {}) {
  const relative = `receipts/${name}`
  if (options.onDisk !== false) {
    const absolute = path.join(process.env.UPLOAD_DIR!, relative)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, content)
  }
  const result = await query<any>(
    `INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by) VALUES (?, ?, 'application/pdf', ?, ?)`,
    [`/uploads/${relative}`, name, Buffer.byteLength(content), userId],
  )
  return Number(result.insertId)
}

describe('receipt document export source', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
    companyId = await createCompany({ name: 'Getränke Müller' })
    sphereId = await createSphere({ code: 'ZB', name: 'Zweckbetrieb' })
    costCentreId = await createCostCentre({ code: '100', name: 'Feste' })
  })

  it('orders by receipt date, sums positions and resolves sphere/cost centre labels', async () => {
    const later = await createReceipt('2026-10-20', 'B', [10, 2.5])
    const earlier = await createReceipt('2026-10-01', 'A')

    const result = await receiptDocumentExportSource.load([later, earlier], EMPTY_DOCUMENT_EXPORT_SCOPE)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.items.map(item => item.id)).toEqual([earlier, later])
    expect(result.items[1]).toMatchObject({
      amount: 12.5,
      file: null,
      fileMissing: false,
      fileNameParts: ['2026-10-20', 'B', 'Getränke Müller'],
      values: { receipt_date: '20.10.2026', receipt_number: 'B', company_name: 'Getränke Müller', status: 'Bezahlt', amount: '12,50 €' },
    })
    expect(result.items[1]!.detailTable?.rows[0]).toEqual(['ZB – Zweckbetrieb', '100 – Feste', '19%', '10,00 €'])
  })

  it('uses the latest active attachment and reads its bytes', async () => {
    const id = await createReceipt('2026-10-01')
    await attachFileToEntity(await createStoredFile('alt.pdf', 'old'), 'receipt', id, userId)
    await attachFileToEntity(await createStoredFile('neu.pdf', 'new'), 'receipt', id, userId)

    const result = await receiptDocumentExportSource.load([id], EMPTY_DOCUMENT_EXPORT_SCOPE)
    expect(result.ok && result.items[0]!.file?.data.toString()).toBe('new')
    expect(result.ok && result.items[0]!.file?.original_name).toBe('neu.pdf')
  })

  it('ignores detached files and flags files missing on disk', async () => {
    const detached = await createReceipt('2026-10-01')
    const attachmentId = await attachFileToEntity(await createStoredFile('weg.pdf', 'x'), 'receipt', detached, userId)
    await detachFileAttachment(attachmentId, userId)

    const missing = await createReceipt('2026-10-02')
    await attachFileToEntity(await createStoredFile('fehlt.pdf', 'x', { onDisk: false }), 'receipt', missing, userId)

    const result = await receiptDocumentExportSource.load([detached, missing], EMPTY_DOCUMENT_EXPORT_SCOPE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0]).toMatchObject({ file: null, fileMissing: false })
    expect(result.items[1]).toMatchObject({ file: null, fileMissing: true })
  })

  it('fails when a selected receipt does not exist', async () => {
    const id = await createReceipt('2026-10-01')
    expect((await receiptDocumentExportSource.load([id, id + 999], EMPTY_DOCUMENT_EXPORT_SCOPE)).ok).toBe(false)
  })
})

describe('receipt export within a cost-centre scope', () => {
  let otherCostCentreId: number
  let childCostCentreId: number

  async function addPosition(receiptId: number, costCentre: number, amount: number) {
    await query(
      'INSERT INTO receipt_positions (receipt_id, sphere, cost_centre, amount, tax) VALUES (?, ?, ?, ?, 19)',
      [receiptId, sphereId, costCentre, amount],
    )
  }

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
    companyId = await createCompany({ name: 'Getränke Müller' })
    sphereId = await createSphere({ code: 'ZB', name: 'Zweckbetrieb' })
    costCentreId = await createCostCentre({ code: '100', name: 'Feste' })
    otherCostCentreId = await createCostCentre({ code: '200', name: 'Erstis' })
    childCostCentreId = await createCostCentre({ code: '110', name: 'Sommerfest' })
    await query('UPDATE cost_centres SET parent_id = ? WHERE id = ?', [costCentreId, childCostCentreId])
  })

  it('keeps split receipts complete but sums and highlights only the share of the cost centre', async () => {
    const split = await createReceipt('2026-10-01', 'S', [])
    await addPosition(split, costCentreId, 30)
    await addPosition(split, otherCostCentreId, 70)

    const resolved = await resolveDocumentExportScope({ id: costCentreId, includeChildren: false })
    expect(resolved.ok && resolved.scope.costCentre).toEqual({ ids: [costCentreId], label: '100 – Feste' })
    if (!resolved.ok) return

    const result = await receiptDocumentExportSource.load([split], resolved.scope)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [receipt] = result.items
    expect(receipt!.amount).toBe(30)
    expect(receipt!.values).toMatchObject({ amount: '100,00 €', share: '30,00 €' })
    expect(receipt!.detailTable?.rows).toHaveLength(2)
    expect(receipt!.detailTable?.highlightedRows).toEqual([0])
    expect(receipt!.details).toContainEqual({ label: 'Anteil Kostenstelle', value: '30,00 €' })

    const columns = typeof receiptDocumentExportSource.columns === 'function' ? receiptDocumentExportSource.columns(resolved.scope) : []
    expect(columns.map(column => column.key)).toContain('share')
  })

  it('counts positions on sub-cost-centres when they are included', async () => {
    const receipt = await createReceipt('2026-10-01', 'K', [])
    await addPosition(receipt, costCentreId, 10)
    await addPosition(receipt, childCostCentreId, 5)
    await addPosition(receipt, otherCostCentreId, 85)

    const withoutChildren = await resolveDocumentExportScope({ id: costCentreId, includeChildren: false })
    const withChildren = await resolveDocumentExportScope({ id: costCentreId, includeChildren: true })
    if (!withoutChildren.ok || !withChildren.ok) throw new Error('scope not resolved')
    expect(withChildren.scope.costCentre?.label).toBe('100 – Feste (inkl. untergeordneter Kostenstellen)')

    const only = await receiptDocumentExportSource.load([receipt], withoutChildren.scope)
    const tree = await receiptDocumentExportSource.load([receipt], withChildren.scope)
    expect(only.ok && only.items[0]!.amount).toBe(10)
    expect(tree.ok && tree.items[0]!.amount).toBe(15)
  })

  it('does not highlight anything when all positions are on the cost centre', async () => {
    const receipt = await createReceipt('2026-10-01', 'E', [20])
    const resolved = await resolveDocumentExportScope({ id: costCentreId, includeChildren: false })
    if (!resolved.ok) throw new Error('scope not resolved')
    const result = await receiptDocumentExportSource.load([receipt], resolved.scope)
    expect(result.ok && result.items[0]!.amount).toBe(20)
    expect(result.ok && result.items[0]!.detailTable?.highlightedRows).toBeUndefined()
  })

  it('rejects an unknown cost centre', async () => {
    expect((await resolveDocumentExportScope({ id: 999999, includeChildren: false })).ok).toBe(false)
  })
})

describe('cost-centre export agrees with the finance analysis', () => {
  async function addPosition(receiptId: number, costCentre: number, amount: number) {
    await query(
      'INSERT INTO receipt_positions (receipt_id, sphere, cost_centre, amount, tax) VALUES (?, ?, ?, ?, 19)',
      [receiptId, sphereId, costCentre, amount],
    )
  }

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
    companyId = await createCompany({ name: 'Getränke Müller' })
    sphereId = await createSphere({ code: 'ZB', name: 'Zweckbetrieb' })
    costCentreId = await createCostCentre({ code: '100', name: 'Feste' })
  })

  it.each([false, true])('shows the same share per receipt as the analysis table (includeChildren = %s)', async (includeChildren) => {
    const otherId = await createCostCentre({ code: '200', name: 'Erstis' })
    const childId = await createCostCentre({ code: '110', name: 'Sommerfest' })
    const grandchildId = await createCostCentre({ code: '111', name: 'Getränke' })
    await query('UPDATE cost_centres SET parent_id = ? WHERE id = ?', [costCentreId, childId])
    await query('UPDATE cost_centres SET parent_id = ? WHERE id = ?', [childId, grandchildId])

    const mixed = await createReceipt('2026-10-01', 'M', [])
    await addPosition(mixed, costCentreId, 10)
    await addPosition(mixed, childId, 5)
    await addPosition(mixed, grandchildId, 2.5)
    await addPosition(mixed, otherId, 80)
    const childOnly = await createReceipt('2026-10-02', 'C', [])
    await addPosition(childOnly, grandchildId, 7)
    await addPosition(childOnly, otherId, 3)

    const filters = parseFinanceAnalysisFilters({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      statuses: ['paid'],
      costCentreId: String(costCentreId),
      includeChildCostCentres: includeChildren ? 'true' : 'false',
    }, '2026-11-04')
    const costCentreIds = await resolveSelectedCostCentreIds(filters.costCentreId, filters.includeChildCostCentres)
    const analysisRows = await loadFinanceAnalysisReceipts({ filters, costCentreIds })

    const resolved = await resolveDocumentExportScope({ id: costCentreId, includeChildren })
    if (!resolved.ok) throw new Error('scope not resolved')
    const exported = await receiptDocumentExportSource.load(analysisRows.map(row => row.id), resolved.scope)
    if (!exported.ok) throw new Error(exported.error)

    const analysisShares = Object.fromEntries(analysisRows.map(row => [row.id, row.total_amount]))
    const exportShares = Object.fromEntries(exported.items.map(item => [item.id, item.amount]))
    expect(exportShares).toEqual(analysisShares)

    // Without children only the receipt booked directly on 100 is in the analysis; with them, both.
    expect(analysisShares).toEqual(includeChildren ? { [mixed]: 17.5, [childOnly]: 7 } : { [mixed]: 10 })
  })
})
