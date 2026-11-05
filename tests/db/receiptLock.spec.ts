import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import updateReceipt from '~/server/api/receipts/[id].put'
import { attachFileToEntity } from '~/server/utils/files'
import { RECEIPT_LOCKED_ERROR } from '~/server/utils/receipts'
import { resetDatabase } from '../helpers/db'
import { createCostCentre, createMember, createReceipt, createSphere, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler, multipartBody } from '../helpers/handler'

// SEC-16: a reimbursed/booked receipt keeps its money fields.
describe('locked receipts', () => {
  let token: string
  let receiptId: number
  let base: Record<string, any>

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    const editor = await signIn({ permissions: ['receipts.edit'] })
    token = editor.token
    const sphere = await createSphere()
    const costCentre = await createCostCentre()
    receiptId = await createReceipt({ status: 'paid', positions: [{ sphere, costCentre, amount: 10 }] })
    const file = await query<any>(
      `INSERT INTO files (file_path, original_name, mime_type, file_size, uploaded_by) VALUES ('/uploads/receipts/a.pdf', 'a.pdf', 'application/pdf', 1, ?)`,
      [editor.id],
    )
    await attachFileToEntity(Number(file.insertId), 'receipt', receiptId, editor.id)
    const reimbursement = await query<any>(`INSERT INTO reimbursements (paid_by, submitted_at, cash) VALUES (?, '2026-03-01', 0)`, [await createMember()])
    await query('INSERT INTO reimbursement_positions (reimbursement_id, receipt_id) VALUES (?, ?)', [Number(reimbursement.insertId), receiptId])

    const [receipt] = await query<any[]>('SELECT * FROM receipts WHERE id = ?', [receiptId])
    const positions = await query<any[]>('SELECT id, sphere, cost_centre, amount, tax FROM receipt_positions WHERE receipt_id = ?', [receiptId])
    base = { company_id: receipt.company_id, receipt_date: receipt.receipt_date, receipt_number: null, status: 'paid', positions }
  })

  function put(receipt: Record<string, any>) {
    return callHandler(updateReceipt, { token, method: 'PUT', params: { id: receiptId }, ...multipartBody({ receipt: JSON.stringify(receipt) }) })
  }

  it('refuses changing the amount', async () => {
    const { result } = await put({ ...base, positions: [{ ...base.positions[0], amount: 99 }] })
    expect(result).toEqual({ ok: false, error: RECEIPT_LOCKED_ERROR })
    const [position] = await query<any[]>('SELECT amount FROM receipt_positions WHERE receipt_id = ?', [receiptId])
    expect(Number(position.amount)).toBe(10)
  })

  it('refuses changing the date', async () => {
    const { result } = await put({ ...base, receipt_date: '2020-01-01' })
    expect(result).toEqual({ ok: false, error: RECEIPT_LOCKED_ERROR })
  })

  it('still saves an unchanged receipt (and description changes)', async () => {
    const { result } = await put({ ...base, description: 'Notiz' })
    expect(result).toEqual({ ok: true })
  })
})
