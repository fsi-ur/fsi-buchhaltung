import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PoolConnection } from 'mariadb'
import { getDbConnection, query } from '~/server/utils/db'
import { BANK_FEATURES_DISABLED, hasActiveFinanceAccount } from '~/server/utils/financeAccounts'
import { normalizeBankStatementBody, validateBankStatementRelations } from '~/server/utils/bankStatements'
import { resolveReimbursementAccount } from '~/server/utils/reimbursements'
import { computeCurrentBankBalances } from '~/server/utils/cashPosition'
import { getAssociationProfileForInvoice } from '~/server/utils/invoices'
import saveAccount from '~/server/api/settings/finance-accounts.save.post'
import deleteAccount from '~/server/api/settings/finance-accounts.delete.post'
import listStatements from '~/server/api/bank_statements/index.get'
import getStatement from '~/server/api/bank_statements/[id].get'
import balancePreview from '~/server/api/bank_statements/balance-preview.get'
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
import { callHandler } from '../helpers/handler'

const VALID_IBAN = 'DE89 3704 0044 0532 0130 00'
const OTHER_IBAN = 'GB82WEST12345698765432'

async function accounts() {
  return query<any[]>('SELECT id, name, is_default, archived_at IS NOT NULL AS archived FROM finance_accounts ORDER BY id')
}

describe('finance accounts', () => {
  let admin: Awaited<ReturnType<typeof signIn>>

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    admin = await signIn({ permissions: ['settings.association.manage', 'bank_statements.view', 'bank_statements.edit'] })
  })

  async function save(body: Record<string, unknown>) {
    return (await callHandler<any>(saveAccount, {
      token: admin.token,
      body: { account_type: 'bank', is_default: false, archived: false, ...body },
    })).result
  }

  describe('settings', () => {
    it('makes the first account with an IBAN the default and validates the IBAN', async () => {
      expect(await save({ name: 'Giro', iban: 'DE00 1234' })).toEqual({ ok: false, error: 'Die IBAN ist ungültig.' })
      expect(await save({ name: 'Bank ohne IBAN', iban: null })).toMatchObject({ ok: false })

      const paypal = await save({ name: 'PayPal', account_type: 'other', identifier: 'kasse@test.invalid', iban: VALID_IBAN })
      expect(paypal.ok).toBe(true)
      // An "other" account stores no bank details and cannot be the default.
      expect((await accounts())[0]).toMatchObject({ name: 'PayPal', is_default: 0 })
      const [stored] = await query<any[]>('SELECT iban FROM finance_accounts WHERE id = ?', [paypal.id])
      expect(stored.iban).toBeNull()

      const giro = await save({ name: 'Giro', iban: VALID_IBAN })
      expect(giro.ok).toBe(true)
      const [giroRow] = await query<any[]>('SELECT iban, is_default FROM finance_accounts WHERE id = ?', [giro.id])
      expect(giroRow).toMatchObject({ iban: 'DE89370400440532013000', is_default: 1 })
    })

    it('keeps exactly one default, which can neither be archived nor lose its IBAN', async () => {
      const giro = await save({ name: 'Giro', iban: VALID_IBAN })
      const savings = await save({ name: 'Sparkonto', iban: OTHER_IBAN })
      expect((await accounts()).map(a => a.is_default)).toEqual([1, 0])

      expect((await save({ id: giro.id, name: 'Giro', iban: VALID_IBAN, archived: true })).ok).toBe(false)
      expect((await save({ id: giro.id, name: 'Giro', account_type: 'other' })).ok).toBe(false)

      expect((await save({ id: savings.id, name: 'Sparkonto', iban: OTHER_IBAN, is_default: true })).ok).toBe(true)
      expect((await accounts()).map(a => a.is_default)).toEqual([0, 1])

      // The former default can be archived now; the default stays where it is.
      expect((await save({ id: giro.id, name: 'Giro', iban: VALID_IBAN, archived: true })).ok).toBe(true)
      expect(await accounts()).toMatchObject([{ is_default: 0, archived: 1 }, { is_default: 1, archived: 0 }])
    })

    it('archives the last default account, which switches bank features off', async () => {
      const giro = await save({ name: 'Giro', iban: VALID_IBAN })
      const paypal = await save({ name: 'PayPal', account_type: 'other' })

      // No other account with an IBAN could take over: the default may be archived.
      expect(await save({ id: giro.id, name: 'Giro', iban: VALID_IBAN, is_default: true, archived: true })).toEqual({ ok: true, id: giro.id })
      expect(await accounts()).toMatchObject([{ id: giro.id, is_default: 0, archived: 1 }, { id: paypal.id, is_default: 0, archived: 0 }])
      expect(await hasActiveFinanceAccount()).toBe(true)

      expect((await save({ id: paypal.id, name: 'PayPal', account_type: 'other', archived: true })).ok).toBe(true)
      expect(await hasActiveFinanceAccount()).toBe(false)

      // Reactivating the bank account makes it the default again.
      expect((await save({ id: giro.id, name: 'Giro', iban: VALID_IBAN })).ok).toBe(true)
      expect(await accounts()).toMatchObject([{ id: giro.id, is_default: 1, archived: 0 }, { archived: 1 }])
    })

    it('rejects duplicate names', async () => {
      await save({ name: 'Giro', iban: VALID_IBAN })
      expect(await save({ name: 'Giro', iban: OTHER_IBAN })).toEqual({ ok: false, error: 'Ein Konto mit diesem Namen existiert bereits.' })
    })

    it('deletes only unused accounts and moves the default on', async () => {
      const giro = await save({ name: 'Giro', iban: VALID_IBAN })
      const savings = await save({ name: 'Sparkonto', iban: OTHER_IBAN })
      const member = await createMember()
      await query(`INSERT INTO bank_statements (account_id, statement_number, checked_by, statement_date) VALUES (?, '1', ?, '2026-01-31 10:00:00')`, [savings.id, member])

      const del = async (id: number) => (await callHandler<any>(deleteAccount, { token: admin.token, body: { id } })).result
      expect((await del(savings.id)).ok).toBe(false)
      expect(await del(giro.id)).toEqual({ ok: true })
      expect(await accounts()).toMatchObject([{ id: savings.id, is_default: 1 }])
    })

    it('prints the default account on invoices', async () => {
      await query(`INSERT INTO association_profiles (name, street, street_number, postal_code, city, email) VALUES ('FSI', 'Str', '1', '93053', 'Regensburg', 'a@test.invalid')`)
      expect((await getAssociationProfileForInvoice())!.iban).toBeNull()

      await save({ name: 'Giro', iban: VALID_IBAN, bic: 'cobadeffxxx', bankname: 'Commerzbank' })
      expect(await getAssociationProfileForInvoice()).toMatchObject({
        iban: 'DE89 3704 0044 0532 0130 00',
        bic: 'COBADEFFXXX',
        bankname: 'Commerzbank',
      })
    })
  })

  describe('without an active account', () => {
    let conn: PoolConnection
    beforeEach(async () => { conn = await getDbConnection() })
    afterEach(() => conn.release())

    it('switches bank statements and bank reimbursements off', async () => {
      const member = await createMember()
      const archived = await createFinanceAccount({ archived: true })
      const body = normalizeBankStatementBody({
        account_id: archived,
        statement_number: '1',
        checked_by: member,
        statement_date: '2026-03-01 10:00:00',
        positions: [{ position_type: 'event', position_date: '2026-03-01', event_id: await createEvent(), amount: 10 }],
      } as any)
      expect(await validateBankStatementRelations(body, conn)).toBe(BANK_FEATURES_DISABLED)

      const reimbursement = { cash: false, disbursed_at: null, paid_from_account_id: null } as any
      expect(await resolveReimbursementAccount(reimbursement, conn)).toMatchObject({ ok: false })
      expect(await resolveReimbursementAccount({ ...reimbursement, cash: true }, conn)).toEqual({ ok: true, accountId: null })
    })

    it('refuses archived accounts for new bookings but lets existing records keep them', async () => {
      await createFinanceAccount({ isDefault: true })
      const archived = await createFinanceAccount({ archived: true })
      const reimbursement = { cash: false, disbursed_at: '2026-03-01', paid_from_account_id: archived } as any

      expect(await resolveReimbursementAccount(reimbursement, conn)).toMatchObject({ ok: false })
      expect(await resolveReimbursementAccount(reimbursement, conn, { cash: 0, paid_from_account_id: archived }))
        .toEqual({ ok: true, accountId: archived })
      expect(await resolveReimbursementAccount({ ...reimbursement, paid_from_account_id: null }, conn))
        .toMatchObject({ ok: false })
    })
  })

  describe('balances with transfers and reimbursements', () => {
    it('keeps per-account balances and statement running balances consistent', async () => {
      const member = await createMember()
      const giro = await createFinanceAccount({ name: 'Giro', isDefault: true })
      const savings = await createFinanceAccount({ name: 'Sparkonto', iban: 'GB82WEST12345698765432' })
      const event = await createEvent()

      const statement = async (accountId: number, number: string, date: string) => Number((await query<any>(
        `INSERT INTO bank_statements (account_id, statement_number, checked_by, statement_date) VALUES (?, ?, ?, ?)`,
        [accountId, number, member, date],
      )).insertId)
      const giro1 = await statement(giro, 'G1', '2026-01-31 10:00:00')
      const giro2 = await statement(giro, 'G2', '2026-02-28 10:00:00')
      await statement(savings, 'S1', '2026-03-31 10:00:00')

      await query(`INSERT INTO bank_statement_positions (bank_statement_id, position_type, position_date, event_id, amount) VALUES (?, 'event', '2026-01-05', ?, 500)`, [giro1, event])
      // 200 € Giro -> Sparkonto, entered once on the Giro statement
      await query(`INSERT INTO bank_statement_positions (bank_statement_id, position_type, position_date, counter_account_id, amount) VALUES (?, 'transfer', '2026-01-20', ?, -200)`, [giro1, savings])

      // A 30 € reimbursement paid from Giro on Feb 1 — between the two Giro statements
      const receipt = await createReceipt({ status: 'paid', positions: [{ sphere: await createSphere(), costCentre: await createCostCentre(), amount: 30 }] })
      const reimbursement = Number((await query<any>(
        `INSERT INTO reimbursements (paid_by, cash, submitted_at, disbursed_at, disbursed_by, paid_from_account_id) VALUES (?, 0, '2026-01-25', '2026-02-01', ?, ?)`,
        [member, member, giro],
      )).insertId)
      await query(`INSERT INTO reimbursement_positions (reimbursement_id, receipt_id) VALUES (?, ?)`, [reimbursement, receipt])

      const current = await computeCurrentBankBalances()
      expect(current.total).toBe(470)
      expect(current.byAccount.get(giro)).toBe(270)
      expect(current.byAccount.get(savings)).toBe(200)

      const { result: list } = await callHandler<any>(listStatements, { token: admin.token })
      const byNumber = Object.fromEntries(list.bankStatements.map((s: any) => [s.statement_number, s]))
      // Statement balances hold what is booked on them; the unconfirmed transfer and reimbursement wait as open items.
      expect(byNumber.G1).toMatchObject({ account_name: 'Giro', opening_balance: 0, closing_balance: 300 })
      expect(byNumber.G2).toMatchObject({ opening_balance: 300, closing_balance: 300 })
      expect(byNumber.S1).toMatchObject({ account_name: 'Sparkonto', opening_balance: 0, closing_balance: 0 })

      const { result: savingsPreview } = await callHandler<any>(balancePreview, {
        token: admin.token,
        path: `/api/test?accountId=${savings}&statementDate=2026-04-30T10:00`,
      })
      expect(savingsPreview.open_items).toEqual([expect.objectContaining({ kind: 'transfer', expected_amount: 200, counter_account_name: 'Giro' })])

      const { result: g2 } = await callHandler<any>(getStatement, { token: admin.token, params: { id: giro2 } })
      expect(g2.bankStatement).toMatchObject({ opening_balance: 300, closing_balance: 300 })

      // A new Giro statement starts where G2 ended and offers the reimbursement to take over.
      const { result: preview } = await callHandler<any>(balancePreview, {
        token: admin.token,
        path: `/api/test?accountId=${giro}&statementDate=2026-03-31T10:00`,
      })
      expect(preview).toMatchObject({ ok: true, opening_balance: 300 })
      expect(preview.open_items).toEqual([expect.objectContaining({ kind: 'reimbursement', reimbursement_id: reimbursement, expected_amount: -30 })])
    })
  })
})
