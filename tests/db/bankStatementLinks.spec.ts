import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PoolConnection } from 'mariadb'
import { getDbConnection, query } from '~/server/utils/db'
import { attachFileToEntity } from '~/server/utils/files'
import { normalizeBankStatementBody, restoreUnlinkedRecordStatuses, validateBankStatementRelations } from '~/server/utils/bankStatements'
import { resetDatabase } from '../helpers/db'
import { createCompany, createMember, createReceipt, createUser, resetFixtureCounter } from '../helpers/fixtures'

let conn: PoolConnection
let memberId: number
let userId: number

async function withFile(receiptId: number) {
  const file = await query<any>(
    `INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by) VALUES ('/uploads/receipts/a.pdf', 'a.pdf', 'application/pdf', 1, ?)`,
    [userId],
  )
  await attachFileToEntity(Number(file.insertId), 'receipt', receiptId, userId)
  return receiptId
}

async function createInvoice(status: string) {
  const companyId = await createCompany()
  const result = await query<any>(
    `INSERT INTO invoices (company_id, source_type, invoice_date, due_date, invoice_number, status)
     VALUES (?, 'manual', '2026-01-01', '2026-02-01', ?, ?)`,
    [companyId, `R-${Math.random().toString(36).slice(2)}`, status],
  )
  return Number(result.insertId)
}

function body(positions: Array<Record<string, unknown>>) {
  return normalizeBankStatementBody({
    statement_number: 'KA-1',
    checked_by: memberId,
    statement_date: '2026-03-01 10:00:00',
    positions: positions.map(p => ({ position_date: '2026-03-01', amount: 10, ...p })),
  } as any)
}

// SEC-15
describe('bank statement links respect record status', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
    memberId = await createMember()
    conn = await getDbConnection()
  })
  afterEach(() => conn.release())

  it('refuses draft/cancelled receipts and receipts without a file', async () => {
    const draft = await withFile(await createReceipt({ status: 'draft' }))
    const cancelled = await withFile(await createReceipt({ status: 'cancelled' }))
    const noFile = await createReceipt({ status: 'open' })
    const ok = await withFile(await createReceipt({ status: 'open' }))

    for (const receiptId of [draft, cancelled, noFile]) {
      expect(await validateBankStatementRelations(body([{ position_type: 'receipt', receipt_id: receiptId }]), conn), String(receiptId)).toBeTruthy()
    }
    expect(await validateBankStatementRelations(body([{ position_type: 'receipt', receipt_id: ok }]), conn)).toBeNull()
  })

  it('refuses draft and cancelled invoices', async () => {
    for (const status of ['draft', 'cancelled']) {
      const invoiceId = await createInvoice(status)
      expect(await validateBankStatementRelations(body([{ position_type: 'invoice', invoice_id: invoiceId }]), conn), status).toBeTruthy()
    }
    const open = await createInvoice('open')
    expect(await validateBankStatementRelations(body([{ position_type: 'invoice', invoice_id: open }]), conn)).toBeNull()
  })

  it('unlinking sets records back to open only when nothing else pays them', async () => {
    const receiptId = await withFile(await createReceipt({ status: 'paid' }))
    const invoiceId = await createInvoice('paid')
    await query(`UPDATE invoices SET paid_at = '2026-03-01' WHERE id = ?`, [invoiceId])
    const reimbursed = await withFile(await createReceipt({ status: 'paid' }))
    const reimbursement = await query<any>(
      `INSERT INTO reimbursements (paid_by, submitted_at, cash) VALUES (?, '2026-03-01', 0)`,
      [memberId],
    )
    await query('INSERT INTO reimbursement_positions (reimbursement_id, receipt_id) VALUES (?, ?)', [Number(reimbursement.insertId), reimbursed])

    await restoreUnlinkedRecordStatuses(999, [receiptId, reimbursed], [invoiceId], conn)

    const [receipt] = await query<any[]>('SELECT status FROM receipts WHERE id = ?', [receiptId])
    const [invoice] = await query<any[]>('SELECT status, paid_at FROM invoices WHERE id = ?', [invoiceId])
    expect(receipt.status).toBe('open')
    expect(invoice).toMatchObject({ status: 'open', paid_at: null })
    const [still] = await query<any[]>('SELECT status FROM receipts WHERE id = ?', [reimbursed])
    expect(still.status).toBe('paid')
  })
})
