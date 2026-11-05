import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '~/server/utils/db'
import updateReimbursement from '~/server/api/reimbursements/[id].put'
import updateBankStatement from '~/server/api/bank_statements/[id].put'
import withdrawDiscrepancy from '~/server/api/cash_counts/[id]/discrepancies.delete'
import { RECORD_LOCKED_ERROR } from '~/server/utils/recordLocks'
import { resetDatabase } from '../helpers/db'
import { createMember, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler, multipartBody } from '../helpers/handler'
import type { PermissionKey } from '~/config/permissions'

// SEC-22: booked finance records are read-only without the domain's unlock permission.
describe('record locks', () => {
  let memberId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    memberId = await createMember()
  })

  async function disbursedReimbursement() {
    const result = await query<any>(
      `INSERT INTO reimbursements (paid_by, submitted_at, cash, disbursed_at, disbursed_by) VALUES (?, '2026-03-01', 1, '2026-03-02', ?)`,
      [memberId, memberId],
    )
    return Number(result.insertId)
  }

  async function putReimbursement(permissions: PermissionKey[], id: number) {
    const user = await signIn({ permissions })
    const body = multipartBody({ reimbursement: JSON.stringify({ paid_by: memberId, submitted_at: '2026-03-01', cash: true, positions: [] }) })
    return (await callHandler(updateReimbursement, { token: user.token, method: 'PUT', params: { id }, ...body })).result
  }

  it('a disbursed reimbursement needs reimbursements.unlock', async () => {
    const id = await disbursedReimbursement()
    expect(await putReimbursement(['reimbursements.edit'], id)).toEqual({ ok: false, error: RECORD_LOCKED_ERROR })
    expect(await putReimbursement(['reimbursements.unlock'], id)).not.toEqual({ ok: false, error: RECORD_LOCKED_ERROR })
  })

  it('a saved bank statement needs bank_statements.unlock', async () => {
    const result = await query<any>(
      `INSERT INTO bank_statements (statement_number, checked_by, statement_date) VALUES ('KA-1', ?, '2026-03-01 10:00:00')`,
      [memberId],
    )
    const id = Number(result.insertId)
    const user = await signIn({ permissions: ['bank_statements.edit'] })
    const body = multipartBody({
      bankStatement: JSON.stringify({ statement_number: 'KA-2', checked_by: memberId, statement_date: '2026-03-01 10:00:00', positions: [{ position_type: 'other', position_date: '2026-03-01', amount: 1 }] }),
    })
    const { result: response } = await callHandler(updateBankStatement, { token: user.token, method: 'PUT', params: { id }, ...body })
    expect(response).toEqual({ ok: false, error: RECORD_LOCKED_ERROR })
    const [row] = await query<any[]>('SELECT statement_number FROM bank_statements WHERE id = ?', [id])
    expect(row.statement_number).toBe('KA-1')
  })

  it('withdrawing a confirmed cash difference needs cash_counts.unlock', async () => {
    const count = await query<any>(
      `INSERT INTO cash_counts (counted_by_first, counted_by_second, checked_by, counted_after_at) VALUES (?, ?, ?, '2026-03-01 22:00:00')`,
      [memberId, memberId, memberId],
    )
    const id = Number(count.insertId)
    await query(`INSERT INTO cash_count_discrepancy_bookings (cash_count_id, amount, confirmed_at) VALUES (?, -5, '2026-03-02 10:00:00')`, [id])

    const editor = await signIn({ permissions: ['cash_counts.edit'] })
    const { result } = await callHandler(withdrawDiscrepancy, { token: editor.token, method: 'DELETE', params: { id } })
    expect(result).toEqual({ ok: false, error: RECORD_LOCKED_ERROR })

    const unlocker = await signIn({ permissions: ['cash_counts.unlock'] })
    const allowed = await callHandler(withdrawDiscrepancy, { token: unlocker.token, method: 'DELETE', params: { id } })
    expect(allowed.result.ok).toBe(true)
  })
})
