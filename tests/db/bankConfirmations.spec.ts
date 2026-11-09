import { beforeEach, describe, expect, it } from 'vitest'
import { getDbConnection, query } from '~/server/utils/db'
import { validateConfirmedReimbursementChange } from '~/server/utils/reimbursements'
import { loadBankDifferences, loadBankMovements, balancesByAccount, loadOpenBankItems } from '~/server/utils/bankBalances'
import { loadFinanceAnalysis } from '~/server/utils/financeAnalysis/load'
import { parseFinanceAnalysisFilters } from '~/server/utils/financeAnalysis/filters'
import createStatement from '~/server/api/bank_statements/create.post'
import updateStatement from '~/server/api/bank_statements/[id].put'
import getStatement from '~/server/api/bank_statements/[id].get'
import listStatements from '~/server/api/bank_statements/index.get'
import confirmDifference from '~/server/api/bank_statements/[id]/discrepancies.post'
import getReimbursement from '~/server/api/reimbursements/[id].get'
import { RECORD_UNLOCK_REQUIRED_ERROR } from '~/server/utils/recordLocks'
import { resetDatabase } from '../helpers/db'
import {
  createCostCentre,
  createEvent,
  createFinanceAccount,
  createMember,
  createReceipt,
  createSphere,
  resetFixtureCounter,
} from '../helpers/fixtures'
import { signIn } from '../helpers/auth'
import { callHandler, multipartBody } from '../helpers/handler'

const PDF = { name: 'file', filename: 'auszug.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 test') }

describe('bank confirmations', () => {
  let editor: Awaited<ReturnType<typeof signIn>>
  let member: number
  let giro: number
  let savings: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    editor = await signIn({ permissions: ['bank_statements.edit', 'bank_statements.unlock', 'reimbursements.edit', 'reimbursements.unlock', 'receipts.view', 'cash_counts.view', 'invoices.view'] })
    member = await createMember()
    giro = await createFinanceAccount({ name: 'Giro', isDefault: true })
    savings = await createFinanceAccount({ name: 'Sparkonto', iban: 'GB82WEST12345698765432' })
  })

  async function create(accountId: number, number: string, date: string, positions: Array<Record<string, unknown>>) {
    const { result } = await callHandler<any>(createStatement, {
      token: editor.token,
      ...multipartBody(
        { bankStatement: JSON.stringify({ account_id: accountId, statement_number: number, checked_by: member, statement_date: date, positions }) },
        [PDF],
      ),
    })
    return result
  }

  async function positionsOf(statementId: number) {
    return query<any[]>('SELECT * FROM bank_statement_positions WHERE bank_statement_id = ? ORDER BY id', [statementId])
  }

  function balances(movements: Awaited<ReturnType<typeof loadBankMovements>>) {
    const map = balancesByAccount(movements)
    return { giro: map.get(giro) ?? 0, savings: map.get(savings) ?? 0 }
  }

  it('confirms a transfer entered on the sending side, with its own date and amount', async () => {
    const event = await createEvent()
    const sent = await create(giro, 'G1', '2026-01-31 10:00', [
      { position_type: 'event', position_date: '2026-01-05', event_id: event, amount: 500 },
      { position_type: 'transfer', position_date: '2026-01-20', counter_account_id: savings, amount: -200 },
    ])
    expect(sent.ok).toBe(true)
    const [, transfer] = await positionsOf(sent.bankStatementId)

    // Not confirmed yet: savings counts the expected 200 € on the transfer's date, and lists it as open.
    expect(balances(await loadBankMovements())).toEqual({ giro: 300, savings: 200 })
    const open = await loadOpenBankItems(savings, '2026-02-05')
    expect(open).toEqual([expect.objectContaining({ kind: 'transfer', source_position_id: transfer.id, expected_amount: 200, overdue: false })])
    expect((await loadOpenBankItems(savings, '2026-03-01'))[0]!.overdue).toBe(true)

    // The savings statement takes it over: arrived two days later, 1.50 € short.
    const received = await create(savings, 'S1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-22', linked_position_id: transfer.id, counter_account_id: 9999, amount: 198.5 },
    ])
    expect(received.ok).toBe(true)
    const [confirmation] = await positionsOf(received.bankStatementId)
    // The counter account comes from the confirmed transfer, never from the client.
    expect(Number(confirmation.counter_account_id)).toBe(giro)
    expect(await loadOpenBankItems(savings, '2026-02-05')).toEqual([])

    expect(balances(await loadBankMovements())).toEqual({ giro: 300, savings: 198.5 })
    // In transit between sending and receiving
    expect(balances(await loadBankMovements({ until: '2026-01-21' }))).toEqual({ giro: 300, savings: 0 })

    expect(await loadBankDifferences()).toEqual([expect.objectContaining({
      position_id: Number(confirmation.id), kind: 'transfer', expected_amount: 200, confirmed_amount: 198.5, amount: -1.5,
    })])

    // The sending side sees where it was confirmed
    const { result: detail } = await callHandler<any>(getStatement, { token: editor.token, params: { id: sent.bankStatementId } })
    expect(detail.positions[1].link).toMatchObject({ statement_number: 'S1', account_name: 'Sparkonto', confirmed_date: '2026-01-22', confirmed_amount: 198.5 })

    // Both statements close with what is on them.
    const { result: list } = await callHandler<any>(listStatements, { token: editor.token })
    const byNumber = Object.fromEntries(list.bankStatements.map((s: any) => [s.statement_number, s]))
    expect(byNumber.G1.closing_balance).toBe(300)
    expect(byNumber.S1.closing_balance).toBe(198.5)
  })

  it('works the other way round: entered on the receiving side, confirmed by the sender', async () => {
    const received = await create(savings, 'S1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-22', counter_account_id: giro, amount: 200 },
    ])
    expect(received.ok).toBe(true)
    const [transfer] = await positionsOf(received.bankStatementId)
    expect(await loadOpenBankItems(giro, '2026-02-01')).toEqual([expect.objectContaining({ expected_amount: -200 })])

    const sent = await create(giro, 'G1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-20', linked_position_id: transfer.id, amount: -200 },
    ])
    expect(sent.ok).toBe(true)
    expect(balances(await loadBankMovements())).toEqual({ giro: -200, savings: 200 })
    expect(await loadBankDifferences()).toEqual([])
  })

  it('refuses double, foreign and self confirmations', async () => {
    const sent = await create(giro, 'G1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-20', counter_account_id: savings, amount: -200 },
    ])
    const [transfer] = await positionsOf(sent.bankStatementId)
    const third = await createFinanceAccount({ name: 'PayPal', type: 'other' })

    expect((await create(third, 'P1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-22', linked_position_id: transfer.id, amount: 200 },
    ])).error).toBe('Die Umbuchung geht nicht auf das Konto dieses Kontoauszugs.')

    expect((await create(savings, 'S1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-22', linked_position_id: transfer.id, amount: 200 },
    ])).ok).toBe(true)
    expect((await create(savings, 'S2', '2026-02-28 10:00', [
      { position_type: 'transfer', position_date: '2026-01-22', linked_position_id: transfer.id, amount: 200 },
    ])).error).toBe('Die Umbuchung ist bereits auf einem anderen Kontoauszug bestätigt.')
  })

  it('keeps a confirmed transfer from being removed or redirected on the sending statement', async () => {
    const sent = await create(giro, 'G1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-20', counter_account_id: savings, amount: -200 },
      { position_type: 'event', position_date: '2026-01-05', event_id: await createEvent(), amount: 10 },
    ])
    const [transfer, eventPosition] = await positionsOf(sent.bankStatementId)
    await create(savings, 'S1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-22', linked_position_id: transfer.id, amount: 200 },
    ])

    const put = (positions: Array<Record<string, unknown>>) => callHandler<any>(updateStatement, {
      token: editor.token,
      method: 'PUT',
      params: { id: sent.bankStatementId },
      ...multipartBody({
        unlock: 'true',
        bankStatement: JSON.stringify({ account_id: giro, statement_number: 'G1', checked_by: member, statement_date: '2026-01-31 10:00', positions }),
      }),
    })
    const eventBody = { id: eventPosition.id, position_type: 'event', position_date: '2026-01-05', event_id: eventPosition.event_id, amount: 10 }

    expect((await put([eventBody])).result.error).toMatch(/ist auf Kontoauszug Nr\. S1 des anderen Kontos bestätigt/)
    // Changing the amount is fine — it only changes the bank difference.
    const { result } = await put([eventBody, { id: transfer.id, position_type: 'transfer', position_date: '2026-01-20', counter_account_id: savings, amount: -210 }])
    expect(result).toEqual({ ok: true })
    expect(await loadBankDifferences()).toEqual([expect.objectContaining({ expected_amount: 210, confirmed_amount: 200, amount: -10 })])
  })

  describe('reimbursements', () => {
    async function bankReimbursement(amount = 30) {
      const receipt = await createReceipt({ status: 'paid', positions: [{ sphere: await createSphere(), costCentre: await createCostCentre(), amount }] })
      const id = Number((await query<any>(
        `INSERT INTO reimbursements (paid_by, cash, bankname, iban, submitted_at, disbursed_at, disbursed_by, paid_from_account_id)
         VALUES (?, 0, 'Bank', 'DE89370400440532013000', '2026-01-25', '2026-02-01', ?, ?)`,
        [member, member, giro],
      )).insertId)
      await query(`INSERT INTO reimbursement_positions (reimbursement_id, receipt_id) VALUES (?, ?)`, [id, receipt])
      return { id, receipt }
    }

    it('stays open until a statement of its account confirms it, then shows the confirmation', async () => {
      const { id } = await bankReimbursement()
      expect(await loadOpenBankItems(giro, '2026-02-05')).toEqual([expect.objectContaining({ kind: 'reimbursement', reimbursement_id: id, expected_amount: -30 })])

      expect((await create(savings, 'S1', '2026-02-28 10:00', [
        { position_type: 'reimbursement', position_date: '2026-02-03', reimbursement_id: id, amount: -30 },
      ])).error).toBe('Die Erstattung wurde von einem anderen Konto überwiesen.')

      const statement = await create(giro, 'G1', '2026-02-28 10:00', [
        { position_type: 'reimbursement', position_date: '2026-02-03', reimbursement_id: id, amount: -30.5 },
      ])
      expect(statement.ok).toBe(true)
      expect(await loadOpenBankItems(giro, '2026-02-05')).toEqual([])
      expect(balances(await loadBankMovements())).toEqual({ giro: -30.5, savings: 0 })
      expect(await loadBankDifferences()).toEqual([expect.objectContaining({ kind: 'reimbursement', amount: -0.5 })])

      const { result } = await callHandler<any>(getReimbursement, { token: editor.token, params: { id } })
      expect(result.reimbursement.bank_confirmation).toMatchObject({
        statement_number: 'G1', account_name: 'Giro', date: '2026-02-03', amount: -30.5, expected_amount: -30, difference: -0.5,
      })
    })

    it('cannot be switched to cash or another account once confirmed', async () => {
      const { id, receipt } = await bankReimbursement()
      await create(giro, 'G1', '2026-02-28 10:00', [
        { position_type: 'reimbursement', position_date: '2026-02-03', reimbursement_id: id, amount: -30 },
      ])
      const updated = {
        paid_by: member, bankname: 'Bank', account_holder: null, iban: 'DE89370400440532013000', bic: null,
        advance: 0, cash: false, submitted_at: '2026-01-25', checked_at: null, checked_by: null,
        disbursed_at: '2026-02-01', disbursed_by: member, paid_from_account_id: giro,
        positions: [{ receipt_id: receipt }],
      }
      const conn = await getDbConnection()
      try {
        expect(await validateConfirmedReimbursementChange(id, updated, giro, conn)).toBeNull()
        expect(await validateConfirmedReimbursementChange(id, { ...updated, cash: true }, null, conn)).toMatch(/auf Kontoauszug Nr\. G1 bestätigt/)
        expect(await validateConfirmedReimbursementChange(id, updated, savings, conn)).toMatch(/auf Kontoauszug Nr\. G1 bestätigt/)
        expect(await validateConfirmedReimbursementChange(id, { ...updated, disbursed_at: null }, giro, conn)).toMatch(/bestätigt/)
      } finally {
        conn.release()
      }
    })
  })

  it('lists bank differences with the cash differences, in the result and confirmable like them', async () => {
    const sent = await create(giro, 'G1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-20', counter_account_id: savings, amount: -200 },
    ])
    const [transfer] = await positionsOf(sent.bankStatementId)
    const received = await create(savings, 'S1', '2026-01-31 10:00', [
      { position_type: 'transfer', position_date: '2026-01-22', linked_position_id: transfer.id, amount: 195 },
    ])
    const [confirmation] = await positionsOf(received.bankStatementId)

    const analysis = async () => loadFinanceAnalysis(parseFinanceAnalysisFilters({ startDate: '2026-01-01', endDate: '2026-12-31' }, '2026-06-01'))
    const before = await analysis()
    expect(before.cashDiscrepancies).toEqual([expect.objectContaining({
      source: 'bank', amount: -5, status: 'unconfirmed', bank: expect.objectContaining({ bank_statement_position_id: Number(confirmation.id), kind: 'transfer' }),
    })])
    expect(before.summary.cash_discrepancy_total).toBe(-5)
    expect(before.summary.net_result).toBe(-5)
    // Total money dropped by exactly the difference, and the reconciliation explains it as such.
    expect(before.summary.money_after - before.summary.money_before).toBe(-5)
    expect(before.reconciliation.other).toBe(0)

    const confirm = (body: Record<string, unknown>) => callHandler<any>(confirmDifference, {
      token: editor.token, params: { id: received.bankStatementId }, body: { position_id: confirmation.id, ...body },
    })
    expect((await confirm({ notes: 'Bankgebühr' })).result.items[0]).toMatchObject({ status: 'confirmed', notes: 'Bankgebühr' })
    // Changing a confirmed difference is changing a booked record.
    expect((await confirm({ notes: 'anders' })).result).toEqual({ ok: false, error: RECORD_UNLOCK_REQUIRED_ERROR })

    // The amount changes afterwards: the confirmation no longer matches.
    await query('UPDATE bank_statement_positions SET amount = 190 WHERE id = ?', [confirmation.id])
    expect((await analysis()).cashDiscrepancies[0]).toMatchObject({ amount: -10, status: 'stale', booked_amount: -5 })
  })
})
