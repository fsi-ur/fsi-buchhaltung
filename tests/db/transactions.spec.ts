import { beforeEach, describe, expect, it } from 'vitest'
import { query, withAuditTransaction, withTransaction } from '~/server/utils/db'
import updateReceipt from '~/server/api/receipts/[id].put'
import { countRows, resetDatabase } from '../helpers/db'
import { createCostCentre, createReceipt, createSphere, createUser, resetFixtureCounter } from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler, multipartBody } from '../helpers/handler'

// SEC-06: a callback that *returns* `{ ok: false }` must roll back what it wrote before.
describe('transactions roll back on { ok: false }', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
  })

  it('withAuditTransaction discards an INSERT followed by a failure result', async () => {
    const actor = await createUser()
    const result = await withAuditTransaction(actor, async (conn) => {
      await query('INSERT INTO companies (name) VALUES (?)', ['Rollback GmbH'], conn)
      return { ok: false as const, error: 'nope' }
    })

    expect(result).toEqual({ ok: false, error: 'nope' })
    expect(await countRows('companies', 'name = ?', ['Rollback GmbH'])).toBe(0)
  })

  it('withTransaction discards an INSERT followed by a failure result', async () => {
    await withTransaction(async (conn) => {
      await query('INSERT INTO companies (name) VALUES (?)', ['Rollback AG'], conn)
      return { ok: false, error: 'nope' }
    })

    expect(await countRows('companies', 'name = ?', ['Rollback AG'])).toBe(0)
  })

  it('still commits successful and non-result callbacks', async () => {
    await withTransaction(async (conn) => {
      await query('INSERT INTO companies (name) VALUES (?)', ['Commit eG'], conn)
    })
    await withTransaction(async (conn) => {
      await query('INSERT INTO companies (name) VALUES (?)', ['Commit KG'], conn)
      return { ok: true }
    })

    expect(await countRows('companies', 'name IN (?, ?)', ['Commit eG', 'Commit KG'])).toBe(2)
  })

  it('a receipt PUT with an unknown cost centre leaves the header untouched', async () => {
    const caller = await signIn({ permissions: ['receipts.edit'] })
    const sphere = await createSphere()
    const costCentre = await createCostCentre()
    const receiptId = await createReceipt({
      status: 'draft',
      positions: [{ sphere, costCentre, amount: 10 }],
    })
    const [receipt] = await query<any[]>('SELECT * FROM receipts WHERE id = ?', [receiptId])

    const multipart = multipartBody({
      receipt: JSON.stringify({
        company_id: receipt.company_id,
        receipt_date: '2026-04-01',
        status: 'cancelled',
        description: 'geändert',
        positions: [{ sphere, cost_centre: 999_999, amount: 10, tax: 19 }],
      }),
    })

    const { result } = await callHandler(updateReceipt, {
      token: caller.token,
      method: 'PUT',
      params: { id: receiptId },
      ...multipart,
    })

    expect(result.ok).toBe(false)
    const [after] = await query<any[]>('SELECT status, description FROM receipts WHERE id = ?', [receiptId])
    expect(after.status).toBe('draft')
    expect(after.description).toBeNull()
  })
})
