import { query } from '~/server/utils/db'
import type { FinanceLiquidityRow, FinanceLiquidityRowType } from '~/types/financeAnalysis'

export interface RegisterBalance {
  registerNumber: number
  balance: number
}

export interface CashPositionResult {
  bankBalance: number
  cashTotal: number
  totalMoney: number
  registerBalances: RegisterBalance[]
}

function rc(v: number) {
  return Number(v.toFixed(2))
}

/**
 * Bank balance at (or strictly before) dateStr.
 * Formula: Σ bank_statement_positions ≤ D − Σ bank-disbursed reimbursements ≤ D
 */
export async function computeBankBalance(dateStr: string, exclusive = false): Promise<number> {
  const op = exclusive ? '<' : '<='

  const bspRows: any[] = await query(
    `SELECT bsp.position_type, bsp.amount, bsp.receipt_id, bsp.invoice_id
     FROM bank_statement_positions bsp
     WHERE bsp.position_date ${op} ?`,
    [dateStr],
  )

  const receiptIds = bspRows.filter(r => r.position_type === 'receipt' && r.receipt_id != null).map(r => Number(r.receipt_id))
  const invoiceIds = bspRows.filter(r => r.position_type === 'invoice' && r.invoice_id != null).map(r => Number(r.invoice_id))

  const receiptTotals = new Map<number, number>()
  if (receiptIds.length) {
    const rows: any[] = await query(
      `SELECT receipt_id, IFNULL(SUM(amount), 0) AS total FROM receipt_positions WHERE receipt_id IN (${receiptIds.map(() => '?').join(',')}) GROUP BY receipt_id`,
      receiptIds,
    )
    for (const r of rows) receiptTotals.set(Number(r.receipt_id), Number(r.total))
  }

  const invoiceTotals = new Map<number, number>()
  if (invoiceIds.length) {
    const rows: any[] = await query(
      `SELECT invoice_id, IFNULL(SUM(quantity * unit_price * (1 + tax / 100)), 0) AS total FROM invoice_positions WHERE invoice_id IN (${invoiceIds.map(() => '?').join(',')}) GROUP BY invoice_id`,
      invoiceIds,
    )
    for (const r of rows) invoiceTotals.set(Number(r.invoice_id), Number(r.total))
  }

  let bank = 0
  for (const row of bspRows) {
    if (row.position_type === 'receipt') bank -= receiptTotals.get(Number(row.receipt_id)) ?? 0
    else if (row.position_type === 'invoice') bank += invoiceTotals.get(Number(row.invoice_id)) ?? 0
    else if (row.position_type === 'event') bank += Number(row.amount ?? 0)
  }

  const reimbRows: any[] = await query(
    `SELECT reimb.id, IFNULL(SUM(rp.amount), 0) AS total_amount
     FROM reimbursements reimb
     INNER JOIN reimbursement_positions rlink ON rlink.reimbursement_id = reimb.id
     INNER JOIN receipt_positions rp ON rp.receipt_id = rlink.receipt_id
     WHERE reimb.cash = 0
       AND reimb.disbursed_at IS NOT NULL
       AND DATE(reimb.disbursed_at) ${op} ?
     GROUP BY reimb.id`,
    [dateStr],
  )
  for (const r of reimbRows) bank -= Number(r.total_amount)

  return rc(bank)
}

interface CashTransaction {
  date: string   // YYYY-MM-DD
  amount: number // signed: positive = inflow, negative = outflow
}

interface RegisterAnchor {
  countedAfterDate: string  // DATE(counted_after_at)
  amountBefore: number
  amountAfter: number
}

/**
 * Load all cash transactions up to (or strictly before) dateStr.
 */
async function loadCashTransactions(dateStr: string, exclusive = false): Promise<CashTransaction[]> {
  const op = exclusive ? '<' : '<='
  const txns: CashTransaction[] = []

  const receiptRows: any[] = await query(
    `SELECT r.receipt_date AS date, IFNULL(SUM(rp.amount), 0) AS total_amount
     FROM receipts r
     INNER JOIN receipt_positions rp ON rp.receipt_id = r.id
     WHERE r.status = 'paid'
       AND r.receipt_date ${op} ?
       AND NOT EXISTS (
         SELECT 1 FROM bank_statement_positions bsp
         WHERE bsp.position_type = 'receipt' AND bsp.receipt_id = r.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM reimbursement_positions rlink
         INNER JOIN reimbursements reimb ON reimb.id = rlink.reimbursement_id
         WHERE rlink.receipt_id = r.id AND reimb.disbursed_at IS NOT NULL
       )
     GROUP BY r.id, r.receipt_date
     ORDER BY r.receipt_date ASC, r.id ASC`,
    [dateStr],
  )
  for (const r of receiptRows) txns.push({ date: String(r.date), amount: -Number(r.total_amount) })

  const invoiceRows: any[] = await query(
    `SELECT COALESCE(DATE(i.paid_at), i.due_date) AS date,
            IFNULL(SUM(ip.quantity * ip.unit_price * (1 + ip.tax / 100)), 0) AS total_amount
     FROM invoices i
     INNER JOIN invoice_positions ip ON ip.invoice_id = i.id
     WHERE i.status = 'paid'
       AND COALESCE(DATE(i.paid_at), i.due_date) ${op} ?
       AND NOT EXISTS (
         SELECT 1 FROM bank_statement_positions bsp
         WHERE bsp.position_type = 'invoice' AND bsp.invoice_id = i.id
       )
     GROUP BY i.id
     HAVING date IS NOT NULL
     ORDER BY date ASC, i.id ASC`,
    [dateStr],
  )
  for (const r of invoiceRows) txns.push({ date: String(r.date), amount: Number(r.total_amount) })

  const reimbRows: any[] = await query(
    `SELECT DATE(reimb.disbursed_at) AS date, IFNULL(SUM(rp.amount), 0) AS total_amount
     FROM reimbursements reimb
     INNER JOIN reimbursement_positions rlink ON rlink.reimbursement_id = reimb.id
     INNER JOIN receipt_positions rp ON rp.receipt_id = rlink.receipt_id
     WHERE reimb.cash = 1
       AND reimb.disbursed_at IS NOT NULL
       AND DATE(reimb.disbursed_at) ${op} ?
     GROUP BY reimb.id
     ORDER BY date ASC, reimb.id ASC`,
    [dateStr],
  )
  for (const r of reimbRows) txns.push({ date: String(r.date), amount: -Number(r.total_amount) })

  return txns.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Load per-register anchor timelines up to dateStr.
 */
async function loadRegisterAnchors(dateStr: string, exclusive = false): Promise<Map<number, RegisterAnchor[]>> {
  const op = exclusive ? '<' : '<='
  const rows: any[] = await query(
    `SELECT ccp.register_number,
            DATE(cc.counted_after_at) AS counted_after_date,
            ccp.amount_before,
            ccp.amount_after
     FROM cash_count_positions ccp
     INNER JOIN cash_counts cc ON cc.id = ccp.cash_count_id
     WHERE DATE(cc.counted_after_at) ${op} ?
     ORDER BY cc.counted_after_at ASC, cc.id ASC, ccp.register_number ASC`,
    [dateStr],
  )

  const map = new Map<number, RegisterAnchor[]>()
  for (const row of rows) {
    const reg = Number(row.register_number)
    const anchors = map.get(reg) ?? []
    anchors.push({
      countedAfterDate: String(row.counted_after_date),
      amountBefore: Number(row.amount_before),
      amountAfter: Number(row.amount_after),
    })
    map.set(reg, anchors)
  }
  return map
}

/**
 * Assign cash transactions to registers using the "least missing money" heuristic.
 * Returns assignments[i] = registerNumber for txns[i], plus pendingByRegister.
 * Transactions assigned to register -1 are unregistered (no register exists).
 */
function assignTransactions(
  txns: CashTransaction[],
  anchors: Map<number, RegisterAnchor[]>,
): { assignments: number[]; pendingByRegister: Map<number, number> } {
  const registerNumbers = Array.from(anchors.keys())

  if (!registerNumbers.length) {
    return {
      assignments: txns.map(() => -1),
      pendingByRegister: new Map(),
    }
  }

  const intervalSums = new Map<string, number>()
  const pendingByRegister = new Map<number, number>()
  for (const reg of registerNumbers) pendingByRegister.set(reg, 0)

  function intervalKey(reg: number, idx: number) { return `${reg}:${idx}` }

  function getIntervalSum(reg: number, idx: number) {
    return intervalSums.get(intervalKey(reg, idx)) ?? 0
  }

  function addToInterval(reg: number, idx: number, amount: number) {
    const key = intervalKey(reg, idx)
    intervalSums.set(key, (intervalSums.get(key) ?? 0) + amount)
  }

  function getIntervalForDate(
    reg: number,
    d: string,
    placeBefore: boolean,
  ): { type: 'leading' | 'bracketed' | 'pending'; intervalIdx: number } {
    const regAnchors = anchors.get(reg)!
    const n = regAnchors.length

    if (!n) return { type: 'pending', intervalIdx: 0 }

    const lastAnchor = regAnchors[n - 1]!
    if (d > lastAnchor.countedAfterDate || (d === lastAnchor.countedAfterDate && !placeBefore)) {
      return { type: 'pending', intervalIdx: n }
    }

    if (d < regAnchors[0]!.countedAfterDate || (d === regAnchors[0]!.countedAfterDate && placeBefore && n === 1)) {
      if (d <= regAnchors[0]!.countedAfterDate) {
        return { type: 'leading', intervalIdx: 0 }
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const after = regAnchors[i]!.countedAfterDate
      const nextAfter = regAnchors[i + 1]!.countedAfterDate
      const absorbed = d < nextAfter || (d === nextAfter && placeBefore)
      if (d > after && absorbed) {
        return { type: 'bracketed', intervalIdx: i + 1 }
      }
      if (d === after && !placeBefore) {
        continue
      }
    }

    return { type: 'leading', intervalIdx: 0 }
  }

  function measuredChange(reg: number, intervalIdx: number): number {
    const regAnchors = anchors.get(reg)!
    if (intervalIdx === 0) return 0
    const prev = regAnchors[intervalIdx - 1]!
    const curr = regAnchors[intervalIdx]!
    return rc(curr.amountBefore - prev.amountAfter)
  }

  function discrepancyDelta(reg: number, intervalIdx: number, amount: number, assignedSumBefore: number): number {
    const mc = measuredChange(reg, intervalIdx)
    const before = Math.abs(mc - assignedSumBefore)
    const after = Math.abs(mc - (assignedSumBefore + amount))
    return after - before
  }

  const assignments: number[] = new Array(txns.length).fill(-1)

  for (let ti = 0; ti < txns.length; ti++) {
    const txn = txns[ti]!
    const d = txn.date
    const amount = txn.amount

    if (registerNumbers.length === 1) {
      const reg = registerNumbers[0]!
      const regAnchors = anchors.get(reg)!
      const n = regAnchors.length
      if (!n || d > regAnchors[n - 1]!.countedAfterDate) {
        pendingByRegister.set(reg, (pendingByRegister.get(reg) ?? 0) + amount)
        assignments[ti] = reg
      } else if (d === regAnchors[n - 1]!.countedAfterDate) {
        const lastIntervalIdx = n - 1
        const sumBefore = getIntervalSum(reg, lastIntervalIdx)
        const deltaAbsorb = discrepancyDelta(reg, lastIntervalIdx, amount, sumBefore)
        const deltaPending = 0
        if (deltaAbsorb <= deltaPending) {
          addToInterval(reg, lastIntervalIdx, amount)
        } else {
          pendingByRegister.set(reg, (pendingByRegister.get(reg) ?? 0) + amount)
        }
        assignments[ti] = reg
      } else {
        const { type, intervalIdx } = getIntervalForDate(reg, d, true)
        if (type === 'leading' || type === 'bracketed') {
          addToInterval(reg, intervalIdx, amount)
        } else {
          pendingByRegister.set(reg, (pendingByRegister.get(reg) ?? 0) + amount)
        }
        assignments[ti] = reg
      }
      continue
    }

    let bestReg = -1
    let bestDelta = Infinity

    for (const reg of registerNumbers) {
      const regAnchors = anchors.get(reg)!
      const n = regAnchors.length

      if (!n) {
        const delta = 0
        if (delta < bestDelta) { bestDelta = delta; bestReg = reg }
        continue
      }

      for (const placeBefore of [true, false]) {
        const { type, intervalIdx } = getIntervalForDate(reg, d, placeBefore)

        if (type === 'pending') {
          const delta = 0
          if (delta < bestDelta || (delta === bestDelta && bestReg === -1)) {
            bestDelta = delta
            bestReg = reg
          }
        } else if (type === 'leading') {
          const delta = 0
          if (delta < bestDelta) { bestDelta = delta; bestReg = reg }
        } else {
          const sumBefore = getIntervalSum(reg, intervalIdx)
          const delta = discrepancyDelta(reg, intervalIdx, amount, sumBefore)
          if (delta < bestDelta) { bestDelta = delta; bestReg = reg }
        }

        if (d !== regAnchors[Math.min(n - 1, intervalIdx)]?.countedAfterDate) break
      }
    }

    if (bestReg === -1) bestReg = registerNumbers[0]!

    const regAnchors = anchors.get(bestReg)!
    const n = regAnchors.length
    const { type, intervalIdx } = getIntervalForDate(bestReg, d, true)

    if (type === 'pending' || (!n)) {
      pendingByRegister.set(bestReg, (pendingByRegister.get(bestReg) ?? 0) + amount)
    } else {
      addToInterval(bestReg, intervalIdx, amount)
    }
    assignments[ti] = bestReg
  }

  return { assignments, pendingByRegister }
}

/**
 * Compute the total money the association holds at the given date.
 */
export async function computeTotalMoney(dateStr: string, exclusive = false): Promise<CashPositionResult> {
  const [bankBalance, txns, anchorsByRegister] = await Promise.all([
    computeBankBalance(dateStr, exclusive),
    loadCashTransactions(dateStr, exclusive),
    loadRegisterAnchors(dateStr, exclusive),
  ])

  const { pendingByRegister } = assignTransactions(txns, anchorsByRegister)

  const registerBalances: RegisterBalance[] = []
  let cashTotal = 0

  for (const [reg, regAnchors] of anchorsByRegister) {
    const lastAnchor = regAnchors.at(-1)
    const carryForward = lastAnchor ? lastAnchor.amountAfter : 0
    const pending = pendingByRegister.get(reg) ?? 0
    const balance = rc(carryForward + pending)
    registerBalances.push({ registerNumber: reg, balance })
    cashTotal += balance
  }

  cashTotal = rc(cashTotal)

  return {
    bankBalance,
    cashTotal,
    totalMoney: rc(bankBalance + cashTotal),
    registerBalances,
  }
}

/**
 * Shared gross bank balance helper for current-balance.get.ts.
 */
export async function computeCurrentBankBalance(): Promise<number> {
  const rows: any[] = await query(
    `SELECT bsp.position_type, bsp.receipt_id, bsp.invoice_id, bsp.amount
     FROM bank_statement_positions bsp
     ORDER BY bsp.position_date ASC, bsp.id ASC`,
  )

  if (!rows.length) return 0

  const receiptIds = rows.filter(r => r.position_type === 'receipt' && r.receipt_id != null).map(r => Number(r.receipt_id))
  const invoiceIds = rows.filter(r => r.position_type === 'invoice' && r.invoice_id != null).map(r => Number(r.invoice_id))

  const receiptTotals = new Map<number, number>()
  if (receiptIds.length) {
    const res: any[] = await query(
      `SELECT receipt_id, IFNULL(SUM(amount), 0) AS total FROM receipt_positions WHERE receipt_id IN (${receiptIds.map(() => '?').join(',')}) GROUP BY receipt_id`,
      receiptIds,
    )
    for (const r of res) receiptTotals.set(Number(r.receipt_id), Number(r.total))
  }

  const invoiceTotals = new Map<number, number>()
  if (invoiceIds.length) {
    const res: any[] = await query(
      `SELECT invoice_id, IFNULL(SUM(quantity * unit_price * (1 + tax / 100)), 0) AS total FROM invoice_positions WHERE invoice_id IN (${invoiceIds.map(() => '?').join(',')}) GROUP BY invoice_id`,
      invoiceIds,
    )
    for (const r of res) invoiceTotals.set(Number(r.invoice_id), Number(r.total))
  }

  let bank = 0
  for (const row of rows) {
    if (row.position_type === 'receipt') bank -= receiptTotals.get(Number(row.receipt_id)) ?? 0
    else if (row.position_type === 'invoice') bank += invoiceTotals.get(Number(row.invoice_id)) ?? 0
    else if (row.position_type === 'event') bank += Number(row.amount ?? 0)
  }

  const reimbRows: any[] = await query(
    `SELECT reimb.id, IFNULL(SUM(rp.amount), 0) AS total_amount
     FROM reimbursements reimb
     INNER JOIN reimbursement_positions rlink ON rlink.reimbursement_id = reimb.id
     INNER JOIN receipt_positions rp ON rp.receipt_id = rlink.receipt_id
     WHERE reimb.cash = 0 AND reimb.disbursed_at IS NOT NULL
     GROUP BY reimb.id`,
  )
  for (const r of reimbRows) bank -= Number(r.total_amount)

  return rc(bank)
}

// ---------------------------------------------------------------------------
// buildCashLedger — full chronological liquidity ledger
// ---------------------------------------------------------------------------

/** A register whose counted amount differs from its book balance at a (non-first) count. */
export interface CashLedgerDiscrepancy {
  cash_count_id: number
  event_id: number | null
  event_name: string
  date: string
  register_number: number
  expected_amount: number
  measured_amount: number
  amount: number
}

export interface CashLedgerResult {
  rows: FinanceLiquidityRow[]
  finalBank: number
  finalCash: number
  finalExpected: Map<number, number>
  /** Every non-zero difference, chronologically — the books are snapped to the counted amount there. */
  discrepancies: CashLedgerDiscrepancy[]
}

function makeLedgerRow(
  id: string,
  type: FinanceLiquidityRowType,
  date: string,
  pool: 'bank' | 'cash' | null,
  label: string,
  reference: string | null,
  register_number: number | null,
  delta_amount: number,
  bank_balance: number,
  cash_balance: number,
  note: string | null,
  expected_amount: number | null = null,
  measured_amount: number | null = null,
  discrepancy_amount: number | null = null,
): FinanceLiquidityRow {
  return {
    id,
    type,
    date,
    pool,
    label,
    reference,
    register_number,
    delta_amount: rc(delta_amount),
    bank_balance: rc(bank_balance),
    cash_balance: rc(cash_balance),
    total_balance: rc(bank_balance + cash_balance),
    expected_amount: expected_amount !== null ? rc(expected_amount) : null,
    measured_amount: measured_amount !== null ? rc(measured_amount) : null,
    discrepancy_amount: discrepancy_amount !== null ? rc(discrepancy_amount) : null,
    has_discrepancy: discrepancy_amount !== null && discrepancy_amount !== 0,
    note,
  }
}

/**
 * Build the full chronological liquidity ledger from the beginning of time up to endDate.
 * Returns all rows plus the final running state.
 *
 * The caller slices to [startDate, endDate] and prepends opening/closing rows.
 */
export async function buildCashLedger(endDate: string): Promise<CashLedgerResult> {
  // -----------------------------------------------------------------------
  // 1. Load all data in parallel
  // -----------------------------------------------------------------------

  const [
    bspRows,
    bankReimbRows,
    cashReceiptRows,
    cashInvoiceRows,
    cashReimbRows,
    cashCountRows,
    bankStatementRows,
  ] = await Promise.all([
    // Bank statement positions (receipts, invoices, event positions)
    query<any>(
      `SELECT bsp.id, bsp.bank_statement_id, bsp.position_type, bsp.position_date,
              bsp.amount AS event_amount, bsp.receipt_id, bsp.invoice_id,
              r.receipt_number, cr.name AS receipt_company,
              i.invoice_number, ci.name AS invoice_company,
              e.name AS event_name,
              bs.statement_number
       FROM bank_statement_positions bsp
       INNER JOIN bank_statements bs ON bs.id = bsp.bank_statement_id
       LEFT JOIN receipts r ON r.id = bsp.receipt_id
       LEFT JOIN companies cr ON cr.id = r.company_id
       LEFT JOIN invoices i ON i.id = bsp.invoice_id
       LEFT JOIN companies ci ON ci.id = i.company_id
       LEFT JOIN events e ON e.id = bsp.event_id
       WHERE bsp.position_date <= ?
       ORDER BY bsp.position_date ASC, bsp.id ASC`,
      [endDate],
    ),
    // Bank-disbursed reimbursements — one row per receipt in the reimbursement
    query<any>(
      `SELECT reimb.id AS reimbursement_id,
              DATE(reimb.disbursed_at) AS effective_date,
              CONCAT(m.first_name, ' ', m.last_name) AS member_name,
              rlink.receipt_id,
              r.receipt_number,
              c.name AS company_name,
              IFNULL(SUM(rp.amount), 0) AS receipt_amount
       FROM reimbursements reimb
       INNER JOIN members m ON m.id = reimb.paid_by
       INNER JOIN reimbursement_positions rlink ON rlink.reimbursement_id = reimb.id
       INNER JOIN receipts r ON r.id = rlink.receipt_id
       INNER JOIN receipt_positions rp ON rp.receipt_id = rlink.receipt_id
       LEFT JOIN companies c ON c.id = r.company_id
       WHERE reimb.cash = 0
         AND reimb.disbursed_at IS NOT NULL
         AND DATE(reimb.disbursed_at) <= ?
       GROUP BY reimb.id, reimb.disbursed_at, m.first_name, m.last_name,
                rlink.receipt_id, r.receipt_number, c.name
       ORDER BY DATE(reimb.disbursed_at) ASC, reimb.id ASC, rlink.receipt_id ASC`,
      [endDate],
    ),
    // Cash receipts (not on bank statement, not in a disbursed reimbursement)
    query<any>(
      `SELECT r.id, r.receipt_date AS effective_date,
              r.receipt_number, c.name AS company_name,
              IFNULL(SUM(rp.amount), 0) AS total_amount
       FROM receipts r
       INNER JOIN receipt_positions rp ON rp.receipt_id = r.id
       LEFT JOIN companies c ON c.id = r.company_id
       WHERE r.status = 'paid'
         AND r.receipt_date <= ?
         AND NOT EXISTS (
           SELECT 1 FROM bank_statement_positions bsp
           WHERE bsp.position_type = 'receipt' AND bsp.receipt_id = r.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM reimbursement_positions rlink
           INNER JOIN reimbursements reimb ON reimb.id = rlink.reimbursement_id
           WHERE rlink.receipt_id = r.id AND reimb.disbursed_at IS NOT NULL
         )
       GROUP BY r.id, r.receipt_date, r.receipt_number, c.name
       ORDER BY r.receipt_date ASC, r.id ASC`,
      [endDate],
    ),
    // Cash invoices (not on bank statement)
    query<any>(
      `SELECT i.id, COALESCE(DATE(i.paid_at), i.due_date) AS effective_date,
              i.invoice_number, c.name AS company_name,
              IFNULL(SUM(ip.quantity * ip.unit_price * (1 + ip.tax / 100)), 0) AS total_amount
       FROM invoices i
       INNER JOIN invoice_positions ip ON ip.invoice_id = i.id
       LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.status = 'paid'
         AND NOT EXISTS (
           SELECT 1 FROM bank_statement_positions bsp
           WHERE bsp.position_type = 'invoice' AND bsp.invoice_id = i.id
         )
       GROUP BY i.id, i.paid_at, i.due_date, i.invoice_number, c.name
       HAVING effective_date IS NOT NULL AND effective_date <= ?
       ORDER BY effective_date ASC, i.id ASC`,
      [endDate],
    ),
    // Cash-disbursed reimbursements — one row per receipt
    query<any>(
      `SELECT reimb.id AS reimbursement_id,
              DATE(reimb.disbursed_at) AS effective_date,
              CONCAT(m.first_name, ' ', m.last_name) AS member_name,
              rlink.receipt_id,
              r.receipt_number,
              c.name AS company_name,
              IFNULL(SUM(rp.amount), 0) AS receipt_amount
       FROM reimbursements reimb
       INNER JOIN members m ON m.id = reimb.paid_by
       INNER JOIN reimbursement_positions rlink ON rlink.reimbursement_id = reimb.id
       INNER JOIN receipts r ON r.id = rlink.receipt_id
       INNER JOIN receipt_positions rp ON rp.receipt_id = rlink.receipt_id
       LEFT JOIN companies c ON c.id = r.company_id
       WHERE reimb.cash = 1
         AND reimb.disbursed_at IS NOT NULL
         AND DATE(reimb.disbursed_at) <= ?
       GROUP BY reimb.id, reimb.disbursed_at, m.first_name, m.last_name,
                rlink.receipt_id, r.receipt_number, c.name
       ORDER BY DATE(reimb.disbursed_at) ASC, reimb.id ASC, rlink.receipt_id ASC`,
      [endDate],
    ),
    // Cash counts with per-register positions (event counts and standalone register checks)
    query<any>(
      `SELECT cc.id, cc.event_id, e.name AS event_name,
              DATE(cc.counted_after_at) AS counted_after_date,
              ccp.register_number, ccp.amount_before, ccp.amount_after
       FROM cash_counts cc
       LEFT JOIN events e ON e.id = cc.event_id
       INNER JOIN cash_count_positions ccp ON ccp.cash_count_id = cc.id
       WHERE DATE(cc.counted_after_at) <= ?
       ORDER BY cc.counted_after_at ASC, cc.id ASC, ccp.register_number ASC`,
      [endDate],
    ),
    // Bank statements for checkpoint metadata (checked_by)
    query<any>(
      `SELECT bs.id, bs.statement_number,
              CONCAT(m.first_name, ' ', m.last_name) AS checked_by_name
       FROM bank_statements bs
       LEFT JOIN members m ON m.id = bs.checked_by`,
    ),
  ])

  // -----------------------------------------------------------------------
  // 2. Resolve bank position amounts (batch receipt/invoice totals)
  // -----------------------------------------------------------------------

  const bspReceiptIds = bspRows
    .filter((r: any) => r.position_type === 'receipt' && r.receipt_id != null)
    .map((r: any) => Number(r.receipt_id))
  const bspInvoiceIds = bspRows
    .filter((r: any) => r.position_type === 'invoice' && r.invoice_id != null)
    .map((r: any) => Number(r.invoice_id))

  const bspReceiptTotals = new Map<number, number>()
  if (bspReceiptIds.length) {
    const rows: any[] = await query(
      `SELECT receipt_id, IFNULL(SUM(amount), 0) AS total FROM receipt_positions WHERE receipt_id IN (${bspReceiptIds.map(() => '?').join(',')}) GROUP BY receipt_id`,
      bspReceiptIds,
    )
    for (const r of rows) bspReceiptTotals.set(Number(r.receipt_id), Number(r.total))
  }

  const bspInvoiceTotals = new Map<number, number>()
  if (bspInvoiceIds.length) {
    const rows: any[] = await query(
      `SELECT invoice_id, IFNULL(SUM(quantity * unit_price * (1 + tax / 100)), 0) AS total FROM invoice_positions WHERE invoice_id IN (${bspInvoiceIds.map(() => '?').join(',')}) GROUP BY invoice_id`,
      bspInvoiceIds,
    )
    for (const r of rows) bspInvoiceTotals.set(Number(r.invoice_id), Number(r.total))
  }

  // Compute signed amount for each bank statement position
  function bspSignedAmount(row: any): number {
    if (row.position_type === 'receipt') return -(bspReceiptTotals.get(Number(row.receipt_id)) ?? 0)
    if (row.position_type === 'invoice') return bspInvoiceTotals.get(Number(row.invoice_id)) ?? 0
    if (row.position_type === 'event') return Number(row.event_amount ?? 0)
    return 0
  }

  // -----------------------------------------------------------------------
  // 3. Build register anchors map (same structure as loadRegisterAnchors)
  // -----------------------------------------------------------------------

  const anchorsByRegister = new Map<number, RegisterAnchor[]>()
  const cashCountsById = new Map<number, { event_id: number | null; event_name: string; date: string; isCheck: boolean; registers: { register_number: number; amount_before: number; amount_after: number }[] }>()

  for (const row of cashCountRows) {
    const ccId = Number(row.id)
    const reg = Number(row.register_number)
    const date = String(row.counted_after_date)
    const amountBefore = Number(row.amount_before)
    const amountAfter = Number(row.amount_after)

    const existing = cashCountsById.get(ccId) ?? {
      event_id: row.event_id === null || row.event_id === undefined ? null : Number(row.event_id),
      event_name: String(row.event_name || ''),
      date,
      isCheck: row.event_id === null || row.event_id === undefined,
      registers: [],
    }
    existing.registers.push({ register_number: reg, amount_before: amountBefore, amount_after: amountAfter })
    cashCountsById.set(ccId, existing)

    const anchors = anchorsByRegister.get(reg) ?? []
    anchors.push({ countedAfterDate: date, amountBefore, amountAfter })
    anchorsByRegister.set(reg, anchors)
  }

  // -----------------------------------------------------------------------
  // 4. Build cash transaction list for register assignment
  //    Must match the order and items from loadCashTransactions.
  // -----------------------------------------------------------------------

  interface TaggedCashTxn extends CashTransaction {
    txnType: 'cashReceipt' | 'cashInvoice' | 'cashReimb'
    sourceId: number  // receipt_id or invoice_id or reimbursement_id
  }

  // Group cash reimbursement receipts by reimbursement_id to get per-reimbursement totals
  const cashReimbByReimbId = new Map<number, { effective_date: string; total: number; member_name: string; receipts: typeof cashReimbRows }>()
  for (const row of cashReimbRows) {
    const reimbId = Number(row.reimbursement_id)
    const existing = cashReimbByReimbId.get(reimbId) ?? {
      effective_date: String(row.effective_date),
      total: 0,
      member_name: String(row.member_name || ''),
      receipts: [] as typeof cashReimbRows,
    }
    existing.total = rc(existing.total + Number(row.receipt_amount))
    existing.receipts.push(row)
    cashReimbByReimbId.set(reimbId, existing)
  }

  // Group bank reimbursement receipts by reimbursement_id
  const bankReimbByReimbId = new Map<number, { effective_date: string; total: number; member_name: string; receipts: typeof bankReimbRows }>()
  for (const row of bankReimbRows) {
    const reimbId = Number(row.reimbursement_id)
    const existing = bankReimbByReimbId.get(reimbId) ?? {
      effective_date: String(row.effective_date),
      total: 0,
      member_name: String(row.member_name || ''),
      receipts: [] as typeof bankReimbRows,
    }
    existing.total = rc(existing.total + Number(row.receipt_amount))
    existing.receipts.push(row)
    bankReimbByReimbId.set(reimbId, existing)
  }

  const taggedTxns: TaggedCashTxn[] = [
    ...cashReceiptRows.map((r: any): TaggedCashTxn => ({
      date: String(r.effective_date),
      amount: -Number(r.total_amount),
      txnType: 'cashReceipt',
      sourceId: Number(r.id),
    })),
    ...cashInvoiceRows.map((r: any): TaggedCashTxn => ({
      date: String(r.effective_date),
      amount: Number(r.total_amount),
      txnType: 'cashInvoice',
      sourceId: Number(r.id),
    })),
    ...Array.from(cashReimbByReimbId.entries()).map(([reimbId, data]): TaggedCashTxn => ({
      date: data.effective_date,
      amount: -data.total,
      txnType: 'cashReimb',
      sourceId: reimbId,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  const { assignments } = assignTransactions(taggedTxns, anchorsByRegister)

  // Map (txnType, sourceId) → register
  const registerByKey = new Map<string, number>()
  for (let i = 0; i < taggedTxns.length; i++) {
    const t = taggedTxns[i]!
    registerByKey.set(`${t.txnType}:${t.sourceId}`, assignments[i] ?? -1)
  }

  // -----------------------------------------------------------------------
  // 5. Build bank statement checkpoint dates and checked_by
  // -----------------------------------------------------------------------

  // Max position_date per bank_statement_id
  const maxPositionDateByStatement = new Map<number, string>()
  for (const row of bspRows) {
    const stmtId = Number(row.bank_statement_id)
    const d = String(row.position_date)
    const current = maxPositionDateByStatement.get(stmtId)
    if (!current || d > current) maxPositionDateByStatement.set(stmtId, d)
  }

  const stmtInfoById = new Map<number, { statement_number: string; checked_by_name: string }>()
  for (const row of bankStatementRows) {
    stmtInfoById.set(Number(row.id), {
      statement_number: String(row.statement_number || ''),
      checked_by_name: String(row.checked_by_name || ''),
    })
  }

  // -----------------------------------------------------------------------
  // 6. Build sorted event list
  // -----------------------------------------------------------------------

  // Sort order within same date:
  // 1 = bank positions, 2 = bank reimbursement receipts, 3 = cash receipts,
  // 4 = cash invoices, 5 = cash reimbursement receipts, 6 = cash counts, 7 = checkpoints

  type LedgerEvent =
    | { kind: 'bankPosition'; sortDate: string; sortOrder: number; sortId: number; row: any }
    | { kind: 'bankReimbReceipt'; sortDate: string; sortOrder: number; sortId: number; reimbId: number; row: any }
    | { kind: 'cashReceipt'; sortDate: string; sortOrder: number; sortId: number; row: any }
    | { kind: 'cashInvoice'; sortDate: string; sortOrder: number; sortId: number; row: any }
    | { kind: 'cashReimbReceipt'; sortDate: string; sortOrder: number; sortId: number; reimbId: number; row: any }
    | { kind: 'cashCount'; sortDate: string; sortOrder: number; sortId: number; ccId: number }
    | { kind: 'bankStatementCheckpoint'; sortDate: string; sortOrder: number; sortId: number; stmtId: number }

  const events: LedgerEvent[] = []

  for (const row of bspRows) {
    events.push({ kind: 'bankPosition', sortDate: String(row.position_date), sortOrder: 1, sortId: Number(row.id), row })
  }

  for (const [reimbId, data] of bankReimbByReimbId) {
    for (const row of data.receipts) {
      events.push({ kind: 'bankReimbReceipt', sortDate: data.effective_date, sortOrder: 2, sortId: Number(row.receipt_id), reimbId, row })
    }
  }

  for (const row of cashReceiptRows) {
    events.push({ kind: 'cashReceipt', sortDate: String(row.effective_date), sortOrder: 3, sortId: Number(row.id), row })
  }

  for (const row of cashInvoiceRows) {
    events.push({ kind: 'cashInvoice', sortDate: String(row.effective_date), sortOrder: 4, sortId: Number(row.id), row })
  }

  for (const [reimbId, data] of cashReimbByReimbId) {
    for (const row of data.receipts) {
      events.push({ kind: 'cashReimbReceipt', sortDate: data.effective_date, sortOrder: 5, sortId: Number(row.receipt_id), reimbId, row })
    }
  }

  for (const [ccId] of cashCountsById) {
    const cc = cashCountsById.get(ccId)!
    events.push({ kind: 'cashCount', sortDate: cc.date, sortOrder: 6, sortId: ccId, ccId })
  }

  for (const [stmtId, checkpointDate] of maxPositionDateByStatement) {
    events.push({ kind: 'bankStatementCheckpoint', sortDate: checkpointDate, sortOrder: 7, sortId: stmtId, stmtId })
  }

  events.sort((a, b) => {
    if (a.sortDate !== b.sortDate) return a.sortDate.localeCompare(b.sortDate)
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.sortId - b.sortId
  })

  // -----------------------------------------------------------------------
  // 7. Walk events, build rows
  // -----------------------------------------------------------------------

  let bank = 0
  const expected = new Map<number, number>()
  const firstCountEver = new Set<number>() // register numbers ever counted (for first-count detection)
  const rows: FinanceLiquidityRow[] = []
  const discrepancies: CashLedgerDiscrepancy[] = []
  let rowSeq = 0

  function cashSum(): number {
    let s = 0
    for (const v of expected.values()) s += v
    return rc(s)
  }

  // Track which cash-reimb reimbursements have been started (first receipt emitted)
  const cashReimbStarted = new Set<number>()
  const bankReimbStarted = new Set<number>()

  for (const evt of events) {
    const seq = rowSeq++

    if (evt.kind === 'bankPosition') {
      const signed = bspSignedAmount(evt.row)
      bank = rc(bank + signed)
      const cash = cashSum()

      let type: FinanceLiquidityRowType
      let label = ''
      let reference: string | null = null

      if (evt.row.position_type === 'receipt') {
        type = 'bankReceipt'
        label = String(evt.row.receipt_company || '')
        reference = evt.row.receipt_number ? String(evt.row.receipt_number) : null
      } else if (evt.row.position_type === 'invoice') {
        type = 'bankInvoice'
        label = String(evt.row.invoice_company || '')
        reference = evt.row.invoice_number ? String(evt.row.invoice_number) : null
      } else {
        type = 'bankEvent'
        label = String(evt.row.event_name || '')
        reference = evt.row.statement_number ? String(evt.row.statement_number) : null
      }

      rows.push(makeLedgerRow(
        `${type}-${evt.row.id}-${seq}`, type,
        String(evt.row.position_date), 'bank', label, reference, null,
        signed, bank, cash, null,
      ))
      continue
    }

    if (evt.kind === 'bankReimbReceipt') {
      const amount = -Number(evt.row.receipt_amount)
      bank = rc(bank + amount)
      const cash = cashSum()
      const reimbData = bankReimbByReimbId.get(evt.reimbId)!
      const isFirst = !bankReimbStarted.has(evt.reimbId)
      if (isFirst) bankReimbStarted.add(evt.reimbId)
      const receiptLabel = [evt.row.receipt_number, evt.row.company_name].filter(Boolean).join(' ')
      const label = receiptLabel || String(reimbData.member_name)
      rows.push(makeLedgerRow(
        `reimbursementReceipt-bank-${evt.reimbId}-${evt.row.receipt_id}-${seq}`,
        'reimbursementReceipt',
        reimbData.effective_date, 'bank', label,
        evt.row.receipt_number ? String(evt.row.receipt_number) : null,
        null, amount, bank, cash,
        `reimbursementNote:${reimbData.member_name}`,
      ))
      continue
    }

    if (evt.kind === 'cashReceipt') {
      const reg = registerByKey.get(`cashReceipt:${evt.row.id}`) ?? -1
      const amount = -Number(evt.row.total_amount)
      if (reg >= 0) {
        expected.set(reg, rc((expected.get(reg) ?? 0) + amount))
      }
      const cash = cashSum()
      rows.push(makeLedgerRow(
        `cashReceipt-${evt.row.id}-${seq}`, 'cashReceipt',
        String(evt.row.effective_date), 'cash',
        String(evt.row.company_name || ''),
        evt.row.receipt_number ? String(evt.row.receipt_number) : null,
        reg >= 0 ? reg : null,
        amount, bank, cash, null,
      ))
      continue
    }

    if (evt.kind === 'cashInvoice') {
      const reg = registerByKey.get(`cashInvoice:${evt.row.id}`) ?? -1
      const amount = Number(evt.row.total_amount)
      if (reg >= 0) {
        expected.set(reg, rc((expected.get(reg) ?? 0) + amount))
      }
      const cash = cashSum()
      rows.push(makeLedgerRow(
        `cashInvoice-${evt.row.id}-${seq}`, 'cashInvoice',
        String(evt.row.effective_date), 'cash',
        String(evt.row.company_name || ''),
        evt.row.invoice_number ? String(evt.row.invoice_number) : null,
        reg >= 0 ? reg : null,
        amount, bank, cash, null,
      ))
      continue
    }

    if (evt.kind === 'cashReimbReceipt') {
      const reg = registerByKey.get(`cashReimb:${evt.reimbId}`) ?? -1
      const amount = -Number(evt.row.receipt_amount)
      if (reg >= 0) {
        expected.set(reg, rc((expected.get(reg) ?? 0) + amount))
      }
      const cash = cashSum()
      const reimbData = cashReimbByReimbId.get(evt.reimbId)!
      const receiptLabel = [evt.row.receipt_number, evt.row.company_name].filter(Boolean).join(' ')
      const label = receiptLabel || String(reimbData.member_name)
      rows.push(makeLedgerRow(
        `reimbursementReceipt-cash-${evt.reimbId}-${evt.row.receipt_id}-${seq}`,
        'reimbursementReceipt',
        reimbData.effective_date, 'cash', label,
        evt.row.receipt_number ? String(evt.row.receipt_number) : null,
        reg >= 0 ? reg : null,
        amount, bank, cash,
        `reimbursementNote:${reimbData.member_name}`,
      ))
      continue
    }

    if (evt.kind === 'cashCount') {
      const cc = cashCountsById.get(evt.ccId)!
      // Process registers in ascending order
      const registers = [...cc.registers].sort((a, b) => a.register_number - b.register_number)

      for (const reg of registers) {
        const regNum = reg.register_number
        const isFirstEver = !firstCountEver.has(regNum)
        if (isFirstEver) firstCountEver.add(regNum)

        const expectedBefore = expected.get(regNum) // undefined on first-ever count

        // a) cashCountRegister row: reconciliation
        const measured = reg.amount_before
        const expectedVal = isFirstEver ? null : (expectedBefore ?? null)
        const discrepancy = expectedVal !== null ? rc(measured - expectedVal) : null

        if (expectedVal !== null && discrepancy !== null && discrepancy !== 0) {
          discrepancies.push({
            cash_count_id: evt.ccId,
            event_id: cc.event_id,
            event_name: cc.event_name,
            date: cc.date,
            register_number: regNum,
            expected_amount: rc(expectedVal),
            measured_amount: rc(measured),
            amount: discrepancy,
          })
        }

        // Snap books to measured
        expected.set(regNum, measured)
        const cashAfterSnap = cashSum()

        const rowType = cc.isCheck ? 'registerCheck' : 'cashCountRegister'
        rows.push(makeLedgerRow(
          `${rowType}-${evt.ccId}-${regNum}-${rowSeq}`,
          rowType,
          cc.date, 'cash', cc.event_name, null, regNum,
          discrepancy ?? 0,
          bank, cashAfterSnap,
          isFirstEver ? 'firstCountNote' : (discrepancy !== null && discrepancy !== 0 ? 'discrepancyFound' : null),
          expectedVal, measured, discrepancy,
        ))
        rowSeq++

        // b) cashCountRevenue row: measured event revenue (if register changed)
        if (reg.amount_after !== reg.amount_before) {
          const delta = rc(reg.amount_after - reg.amount_before)
          expected.set(regNum, reg.amount_after)
          const cashAfterRevenue = cashSum()
          rows.push(makeLedgerRow(
            `cashCountRevenue-${evt.ccId}-${regNum}-${rowSeq}`,
            'cashCountRevenue',
            cc.date, 'cash', cc.event_name, null, regNum,
            delta, bank, cashAfterRevenue, 'eventRevenueNote',
          ))
          rowSeq++
        }
      }
      continue
    }

    if (evt.kind === 'bankStatementCheckpoint') {
      const stmtInfo = stmtInfoById.get(evt.stmtId)
      const cash = cashSum()
      rows.push(makeLedgerRow(
        `bankStatementCheckpoint-${evt.stmtId}-${seq}`,
        'bankStatementCheckpoint',
        evt.sortDate, 'bank',
        stmtInfo?.statement_number ? `Nr. ${stmtInfo.statement_number}` : '',
        stmtInfo?.statement_number ? String(stmtInfo.statement_number) : null,
        null, 0, bank, cash,
        stmtInfo?.checked_by_name ? `bankCheckedNote:${evt.sortDate}:${stmtInfo.checked_by_name}` : `bankCheckedNote:${evt.sortDate}:`,
      ))
      continue
    }
  }

  return {
    rows,
    finalBank: bank,
    finalCash: cashSum(),
    finalExpected: expected,
    discrepancies,
  }
}
