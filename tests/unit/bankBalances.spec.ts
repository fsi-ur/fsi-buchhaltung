import { describe, expect, it } from 'vitest'
import {
  balancesByAccount,
  computeStatementBalances,
  sumBankMovements,
  type BankMovement,
} from '~/server/utils/bankBalances'

function movement(overrides: Partial<BankMovement>): BankMovement {
  return {
    source: 'position',
    account_id: 1,
    date: '2026-01-10',
    amount: 0,
    position_id: null,
    bank_statement_id: null,
    position_type: null,
    counter_account_id: null,
    reimbursement_id: null,
    ...overrides,
  }
}

const GIRO = 1
const SAVINGS = 2

describe('bank balances per account', () => {
  // Giro: statement 10 (Jan) with +500 income and a 200 transfer to savings; statement 11 (Feb) with -50.
  // The transfer is not confirmed on the savings side yet, so savings counts it as expected; a 30 €
  // reimbursement paid from Giro on 2026-02-01 is not on any statement yet either.
  const movements: BankMovement[] = [
    movement({ bank_statement_id: 10, position_id: 1, amount: 500, date: '2026-01-05', position_type: 'invoice' }),
    movement({ bank_statement_id: 10, position_id: 2, amount: -200, date: '2026-01-20', position_type: 'transfer', counter_account_id: SAVINGS }),
    movement({ source: 'counterTransfer', account_id: SAVINGS, bank_statement_id: 10, position_id: 2, amount: 200, date: '2026-01-20', position_type: 'transfer', counter_account_id: GIRO }),
    movement({ source: 'reimbursement', reimbursement_id: 9, amount: -30, date: '2026-02-01' }),
    movement({ bank_statement_id: 11, position_id: 3, amount: -50, date: '2026-02-15', position_type: 'receipt' }),
    movement({ account_id: SAVINGS, bank_statement_id: 20, position_id: 4, amount: 5, date: '2026-03-31', position_type: 'event' }),
  ]
  const statements = [
    { id: 10, account_id: GIRO, statement_date: '2026-01-31 00:00:00' },
    { id: 11, account_id: GIRO, statement_date: '2026-02-28 00:00:00' },
    { id: 20, account_id: SAVINGS, statement_date: '2026-03-31 00:00:00' },
  ]

  it('counts unconfirmed items in the account balances, so transfers net to zero', () => {
    expect(sumBankMovements(movements)).toBe(425)
    const balances = balancesByAccount(movements)
    expect(balances.get(GIRO)).toBe(220)
    expect(balances.get(SAVINGS)).toBe(205)
  })

  it('runs statement balances over what is booked on the statements only', () => {
    const result = computeStatementBalances(statements, movements)

    expect(result.get(10)).toEqual({ opening_balance: 0, closing_balance: 300 })
    // The unconfirmed reimbursement is not on the paper statement — it waits as an open item.
    expect(result.get(11)).toEqual({ opening_balance: 300, closing_balance: 250 })
    // Neither is the unconfirmed incoming transfer on the savings statement.
    expect(result.get(20)).toEqual({ opening_balance: 0, closing_balance: 5 })
  })

  it('includes a confirmation once the statement takes the item over', () => {
    const confirmed = [
      ...movements.filter(m => m.source !== 'counterTransfer'),
      // Savings confirms the transfer on its statement, two days later and 1 € short (bank fee).
      movement({ account_id: SAVINGS, bank_statement_id: 20, position_id: 5, amount: 199, date: '2026-01-22', position_type: 'transfer', counter_account_id: GIRO }),
    ]
    const result = computeStatementBalances(statements, confirmed)
    expect(result.get(20)).toEqual({ opening_balance: 0, closing_balance: 204 })
    // The 1 € difference shows in the total money.
    expect(sumBankMovements(confirmed)).toBe(424)
  })
})
