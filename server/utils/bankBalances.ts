import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { addDaysToLocalDate, type LocalDate } from '~/shared/time'
import type { BankOpenItem, BankStatementPositionType } from '~/types/bankStatement'

/**
 * Every movement on the association's own accounts, the single source for bank balances.
 *
 * - A statement position moves its statement's account: receipts out (gross), invoices in (gross),
 *   event, transfer and reimbursement positions by their signed amount.
 * - A transfer is entered on one account's statement (either side) and confirmed by a position on
 *   the other account's statement (`linked_position_id`), with its own date and amount. Until it is
 *   confirmed, the other account moves by the expected (opposite) amount on the transfer's date
 *   (`counterTransfer`), so the total never jumps.
 * - A reimbursement paid by bank leaves its `paid_from_account_id` on its payout date until a
 *   statement confirms it (`reimbursement` position) — then the confirmation's date and amount count.
 * - A confirmation that differs from what was expected leaves a bank difference (see
 *   `loadBankDifferences`) — like a cash difference, it is real money gained or lost.
 */

/** Signed amount of a statement position, from the statement account's view. Alias `bsp`. */
export const BANK_POSITION_AMOUNT_SQL = `
  CASE bsp.position_type
    WHEN 'receipt' THEN -IFNULL((SELECT SUM(rp_amt.amount) FROM receipt_positions rp_amt WHERE rp_amt.receipt_id = bsp.receipt_id), 0)
    WHEN 'invoice' THEN IFNULL((SELECT SUM(ip_amt.quantity * ip_amt.unit_price * (1 + ip_amt.tax / 100)) FROM invoice_positions ip_amt WHERE ip_amt.invoice_id = bsp.invoice_id), 0)
    ELSE IFNULL(bsp.amount, 0)
  END`

/** Total of a reimbursement (sum of its receipts) — what a bank payout is expected to be. */
export function reimbursementTotalSql(reimbursementIdColumn: string) {
  return `IFNULL((SELECT SUM(rp_tot.amount) FROM reimbursement_positions rl_tot INNER JOIN receipt_positions rp_tot ON rp_tot.receipt_id = rl_tot.receipt_id WHERE rl_tot.reimbursement_id = ${reimbursementIdColumn}), 0)`
}

export type BankMovementSource = 'position' | 'counterTransfer' | 'reimbursement'

export interface BankMovement {
  source: BankMovementSource
  account_id: number | null
  date: string
  amount: number
  /** position / counterTransfer: the position and the statement it is entered on */
  position_id: number | null
  bank_statement_id: number | null
  position_type: BankStatementPositionType | null
  /** position: transfer target/source; counterTransfer: the account whose statement holds it */
  counter_account_id: number | null
  reimbursement_id: number | null
}

function round(value: number) {
  return Number(value.toFixed(2))
}

const toId = (value: unknown) => (value === null || value === undefined ? null : Number(value))

interface LoadBankMovementsOptions {
  /** Only movements on or before (exclusive: strictly before) this date. */
  until?: string
  exclusive?: boolean
}

export async function loadBankMovements(
  options: LoadBankMovementsOptions = {},
  conn?: mariadb.PoolConnection,
): Promise<BankMovement[]> {
  // Loaded without a date filter: whether something is confirmed does not depend on the date asked for.
  const [positionRows, reimbursementRows] = await Promise.all([
    query<any[]>(
      `SELECT bsp.id, bsp.bank_statement_id, bsp.position_type, bsp.position_date,
              bsp.counter_account_id, bsp.linked_position_id, bsp.reimbursement_id, bs.account_id,
              ${BANK_POSITION_AMOUNT_SQL} AS signed_amount
       FROM bank_statement_positions bsp
       INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
       ORDER BY bsp.position_date ASC, bsp.id ASC`,
      [],
      conn,
    ),
    query<any[]>(
      `SELECT reimb.id, reimb.paid_from_account_id, DATE(reimb.disbursed_at) AS disbursed_date,
              ${reimbursementTotalSql('reimb.id')} AS total_amount
       FROM reimbursements reimb
       WHERE reimb.cash = 0 AND reimb.disbursed_at IS NOT NULL
       ORDER BY DATE(reimb.disbursed_at) ASC, reimb.id ASC`,
      [],
      conn,
    ),
  ])

  const confirmedTransfers = new Set<number>()
  const confirmedReimbursements = new Set<number>()
  for (const row of positionRows) {
    if (row.linked_position_id != null) confirmedTransfers.add(Number(row.linked_position_id))
    if (row.reimbursement_id != null) confirmedReimbursements.add(Number(row.reimbursement_id))
  }

  const movements: BankMovement[] = []

  for (const row of positionRows) {
    const amount = round(Number(row.signed_amount ?? 0))
    const date = String(row.position_date).slice(0, 10)
    const counterAccountId = toId(row.counter_account_id)
    movements.push({
      source: 'position',
      account_id: Number(row.account_id),
      date,
      amount,
      position_id: Number(row.id),
      bank_statement_id: Number(row.bank_statement_id),
      position_type: row.position_type as BankStatementPositionType,
      counter_account_id: counterAccountId,
      reimbursement_id: toId(row.reimbursement_id),
    })
    const isOpenTransfer = row.position_type === 'transfer'
      && row.linked_position_id == null
      && counterAccountId !== null
      && !confirmedTransfers.has(Number(row.id))
    if (isOpenTransfer) {
      movements.push({
        source: 'counterTransfer',
        account_id: counterAccountId,
        date,
        amount: round(-amount),
        position_id: Number(row.id),
        bank_statement_id: Number(row.bank_statement_id),
        position_type: 'transfer',
        counter_account_id: Number(row.account_id),
        reimbursement_id: null,
      })
    }
  }

  for (const row of reimbursementRows) {
    if (confirmedReimbursements.has(Number(row.id))) continue
    movements.push({
      source: 'reimbursement',
      account_id: toId(row.paid_from_account_id),
      date: String(row.disbursed_date).slice(0, 10),
      amount: round(-Number(row.total_amount ?? 0)),
      position_id: null,
      bank_statement_id: null,
      position_type: null,
      counter_account_id: null,
      reimbursement_id: Number(row.id),
    })
  }

  if (!options.until) return movements
  const until = options.until
  return movements.filter(movement => (options.exclusive ? movement.date < until : movement.date <= until))
}

export function sumBankMovements(movements: BankMovement[]) {
  return round(movements.reduce((total, movement) => total + movement.amount, 0))
}

/** Balance per account id. Movements without an account (legacy data) are left out. */
export function balancesByAccount(movements: BankMovement[]) {
  const balances = new Map<number, number>()
  for (const movement of movements) {
    if (movement.account_id === null) continue
    balances.set(movement.account_id, round((balances.get(movement.account_id) ?? 0) + movement.amount))
  }
  return balances
}

export interface StatementBalanceInput {
  id: number
  account_id: number
  statement_date: string
}

export interface StatementBalance {
  opening_balance: number
  closing_balance: number
}

/**
 * Running balance per account through its statements (by statement date), from what is booked on
 * the statements only — like the paper statements. Movements nobody has booked yet (open transfers
 * and reimbursements) are left out here; they show up as open items until a statement takes them.
 */
export function computeStatementBalances(
  statements: StatementBalanceInput[],
  movements: BankMovement[],
): Map<number, StatementBalance> {
  const ownNet = new Map<number, number>()
  for (const movement of movements) {
    if (movement.source !== 'position') continue
    const id = movement.bank_statement_id!
    ownNet.set(id, round((ownNet.get(id) ?? 0) + movement.amount))
  }

  const byAccount = new Map<number, StatementBalanceInput[]>()
  for (const statement of statements) {
    const list = byAccount.get(statement.account_id) ?? []
    list.push(statement)
    byAccount.set(statement.account_id, list)
  }

  const result = new Map<number, StatementBalance>()
  for (const accountStatements of byAccount.values()) {
    accountStatements.sort((a, b) => a.statement_date.localeCompare(b.statement_date) || a.id - b.id)
    let running = 0
    for (const statement of accountStatements) {
      const opening = running
      running = round(running + (ownNet.get(statement.id) ?? 0))
      result.set(statement.id, { opening_balance: opening, closing_balance: running })
    }
  }

  return result
}

/** Open items older than this are flagged: the bank should have shown them by now. */
export const OPEN_ITEM_OVERDUE_DAYS = 30

/**
 * What still waits for a statement of the account: transfers entered on another account's statement
 * towards/from this account, and bank reimbursements paid from it, that no statement has confirmed.
 */
export async function loadOpenBankItems(
  accountId: number,
  today: string,
  conn?: mariadb.PoolConnection,
): Promise<BankOpenItem[]> {
  const [transfers, reimbursements] = await Promise.all([
    query<any[]>(
      `SELECT bsp.id, bsp.position_date, bsp.amount, bsp.notes, bs.id AS statement_id, bs.statement_number,
              bs.account_id AS source_account_id, fa.name AS source_account_name
       FROM bank_statement_positions bsp
       INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
       LEFT JOIN finance_accounts fa ON fa.id = bs.account_id
       WHERE bsp.position_type = 'transfer'
         AND bsp.linked_position_id IS NULL
         AND bsp.counter_account_id = ?
         AND NOT EXISTS (SELECT 1 FROM bank_statement_positions c WHERE c.linked_position_id = bsp.id)
       ORDER BY bsp.position_date ASC, bsp.id ASC`,
      [accountId],
      conn,
    ),
    query<any[]>(
      `SELECT reimb.id, DATE(reimb.disbursed_at) AS disbursed_date,
              CONCAT(m.first_name, ' ', m.last_name) AS member_name,
              ${reimbursementTotalSql('reimb.id')} AS total_amount
       FROM reimbursements reimb
       LEFT JOIN members m ON m.id = reimb.paid_by
       WHERE reimb.cash = 0
         AND reimb.disbursed_at IS NOT NULL
         AND reimb.paid_from_account_id = ?
         AND NOT EXISTS (SELECT 1 FROM bank_statement_positions c WHERE c.reimbursement_id = reimb.id)
       ORDER BY DATE(reimb.disbursed_at) ASC, reimb.id ASC`,
      [accountId],
      conn,
    ),
  ])

  const overdueBefore = addDaysToLocalDate(today as LocalDate, -OPEN_ITEM_OVERDUE_DAYS)
  const items: BankOpenItem[] = [
    ...transfers.map((row): BankOpenItem => {
      const date = String(row.position_date).slice(0, 10)
      return {
        key: `transfer-${row.id}`,
        kind: 'transfer',
        date,
        // From this account's view: the opposite of what the other side booked.
        expected_amount: round(-Number(row.amount ?? 0)),
        source_position_id: Number(row.id),
        source_statement_id: Number(row.statement_id),
        source_statement_number: String(row.statement_number || ''),
        counter_account_id: Number(row.source_account_id),
        counter_account_name: String(row.source_account_name || ''),
        reimbursement_id: null,
        member_name: null,
        notes: row.notes ? String(row.notes) : null,
        overdue: date < overdueBefore,
      }
    }),
    ...reimbursements.map((row): BankOpenItem => {
      const date = String(row.disbursed_date).slice(0, 10)
      return {
        key: `reimbursement-${row.id}`,
        kind: 'reimbursement',
        date,
        expected_amount: round(-Number(row.total_amount ?? 0)),
        source_position_id: null,
        source_statement_id: null,
        source_statement_number: null,
        counter_account_id: null,
        counter_account_name: null,
        reimbursement_id: Number(row.id),
        member_name: String(row.member_name || ''),
        notes: null,
        overdue: date < overdueBefore,
      }
    }),
  ]
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
}


/**
 * A confirmation (transfer or reimbursement position) whose amount differs from what was expected.
 * Positive = more money arrived (or less left) than expected.
 */
export interface BankDifference {
  /** The confirming position — keys the confirmation of the difference */
  position_id: number
  bank_statement_id: number
  statement_number: string
  account_id: number
  account_name: string
  kind: 'transfer' | 'reimbursement'
  date: string
  expected_amount: number
  confirmed_amount: number
  amount: number
  /** transfer: the other account; reimbursement: the member paid */
  counterparty: string
  reimbursement_id: number | null
}

export async function loadBankDifferences(
  options: { from?: string, until?: string, statementId?: number } = {},
  conn?: mariadb.PoolConnection,
): Promise<BankDifference[]> {
  const where: string[] = [`(bsp.linked_position_id IS NOT NULL OR bsp.reimbursement_id IS NOT NULL)`]
  const params: unknown[] = []
  if (options.from) { where.push('bsp.position_date >= ?'); params.push(options.from) }
  if (options.until) { where.push('bsp.position_date <= ?'); params.push(options.until) }
  if (options.statementId) { where.push('bsp.bank_statement_id = ?'); params.push(options.statementId) }

  const rows = await query<any[]>(
    `SELECT bsp.id, bsp.bank_statement_id, bsp.position_type, bsp.position_date, bsp.amount, bsp.reimbursement_id,
            bs.statement_number, bs.account_id, fa.name AS account_name,
            src.amount AS source_amount, sfa.name AS source_account_name,
            CONCAT(m.first_name, ' ', m.last_name) AS member_name,
            ${reimbursementTotalSql('bsp.reimbursement_id')} AS reimbursement_total
     FROM bank_statement_positions bsp
     INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
     LEFT JOIN finance_accounts fa ON fa.id = bs.account_id
     LEFT JOIN bank_statement_positions src ON src.id = bsp.linked_position_id
     LEFT JOIN bank_statements sbs ON sbs.id = src.bank_statement_id
     LEFT JOIN finance_accounts sfa ON sfa.id = sbs.account_id
     LEFT JOIN reimbursements reimb ON reimb.id = bsp.reimbursement_id
     LEFT JOIN members m ON m.id = reimb.paid_by
     WHERE ${where.join(' AND ')}
     ORDER BY bsp.position_date ASC, bsp.id ASC`,
    params,
    conn,
  )

  const differences: BankDifference[] = []
  for (const row of rows) {
    const isTransfer = row.position_type === 'transfer'
    const expected = round(isTransfer ? -Number(row.source_amount ?? 0) : -Number(row.reimbursement_total ?? 0))
    const confirmed = round(Number(row.amount ?? 0))
    const amount = round(confirmed - expected)
    if (amount === 0) continue
    differences.push({
      position_id: Number(row.id),
      bank_statement_id: Number(row.bank_statement_id),
      statement_number: String(row.statement_number || ''),
      account_id: Number(row.account_id),
      account_name: String(row.account_name || ''),
      kind: isTransfer ? 'transfer' : 'reimbursement',
      date: String(row.position_date).slice(0, 10),
      expected_amount: expected,
      confirmed_amount: confirmed,
      amount,
      counterparty: isTransfer ? String(row.source_account_name || '') : String(row.member_name || ''),
      reimbursement_id: toId(row.reimbursement_id),
    })
  }
  return differences
}
