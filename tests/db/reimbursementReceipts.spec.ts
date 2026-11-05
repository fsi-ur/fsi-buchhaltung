import { beforeEach, describe, expect, it } from 'vitest'
import { query, withTransaction } from '~/server/utils/db'
import { releaseRemovedReimbursementReceipts, validateReimbursableReceipts, REIMBURSEMENT_RECEIPT_CANCELLED } from '~/server/utils/reimbursements'
import { resetDatabase } from '../helpers/db'
import { createMember, createReceipt, resetFixtureCounter } from '../helpers/fixtures'

async function reimbursement(memberId: number) {
  const result = await query<any>(`INSERT INTO reimbursements (paid_by, submitted_at, cash) VALUES (?, '2026-03-01', 0)`, [memberId])
  return Number(result.insertId)
}

// SEC-23
describe('reimbursement receipts', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('a receipt can be part of one reimbursement only (unique key)', async () => {
    const memberId = await createMember()
    const receiptId = await createReceipt({ status: 'open' })
    await query('INSERT INTO reimbursement_positions (reimbursement_id, receipt_id) VALUES (?, ?)', [await reimbursement(memberId), receiptId])
    await expect(query('INSERT INTO reimbursement_positions (reimbursement_id, receipt_id) VALUES (?, ?)', [await reimbursement(memberId), receiptId]))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' })
  })

  it('refuses cancelled receipts and releases removed ones', async () => {
    const memberId = await createMember()
    const cancelled = await createReceipt({ status: 'cancelled' })
    const paid = await createReceipt({ status: 'paid' })
    const reimbursementId = await reimbursement(memberId)

    await withTransaction(async (conn) => {
      expect(await validateReimbursableReceipts([cancelled], conn)).toBe(REIMBURSEMENT_RECEIPT_CANCELLED)
      await releaseRemovedReimbursementReceipts(reimbursementId, [paid], conn)
    })

    const [row] = await query<any[]>('SELECT status FROM receipts WHERE id = ?', [paid])
    expect(row.status).toBe('open')
  })
})
