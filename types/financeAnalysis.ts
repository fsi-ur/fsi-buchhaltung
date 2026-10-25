import type { InvoiceStatus } from '~/types/invoice'
import type { ReceiptStatus } from '~/types/receipt'

export interface FinanceAnalysisReceiptItem {
  id: number
  receipt_date: string
  reimbursement_submitted_at: string | null
  receipt_number: string | null
  company_name: string | null
  status: ReceiptStatus
  total_amount: number
}

export interface FinanceAnalysisReceiptBreakdownItem {
  group_type: 'costCentre' | 'sphere'
  group_id: number | null
  group_code: string
  group_name: string
  month_key: string
  status: ReceiptStatus
  receipt_count: number
  total_amount: number
}

export interface FinanceAnalysisInvoiceBreakdownItem {
  group_type: 'costCentre' | 'sphere'
  group_id: number | null
  group_code: string
  group_name: string
  month_key: string
  status: InvoiceStatus
  invoice_count: number
  total_amount: number
}

export interface FinanceAnalysisCostCentreSplit {
  sphere_id: number
  sphere_code: string
  sphere_name: string
  cost_centre_id: number
  code: string
  name: string
  allocation_percentage: number
}

export interface FinanceAnalysisCashCountItem {
  id: number
  event_id: number
  event_name: string
  cost_centres: FinanceAnalysisCostCentreSplit[]
  counted_before_at: string
  counted_after_at: string
  counted_by_first_name: string
  counted_by_second_name: string
  checked_by_name: string
  register_count: number
  total_before_amount: number
  total_after_amount: number
  total_difference: number
}

export interface FinanceAnalysisCashCountBreakdownItem {
  group_type: 'costCentre' | 'sphere'
  group_id: number | null
  group_code: string
  group_name: string
  month_key: string
  cash_count_count: number
  register_count: number
  total_before_amount: number
  total_after_amount: number
  total_difference: number
}

/**
 * Confirmed = a booking accepted exactly this amount; stale = a booking exists but the computed
 * difference has changed since (an earlier count or cash receipt was edited); unconfirmed = no booking.
 */
export type FinanceAnalysisCashDiscrepancyStatus = 'confirmed' | 'stale' | 'unconfirmed'

/** Where the sphere/cost centre of a difference came from, in order of precedence. */
export type FinanceAnalysisCashDiscrepancyAssignment = 'booking' | 'event' | 'default' | 'none'

/** The difference (counted − book balance) of one register at one count. */
export interface FinanceAnalysisCashDiscrepancyRegister {
  register_number: number
  expected_amount: number
  measured_amount: number
  amount: number
}

/**
 * The net cash difference of one count: the sum over its registers. Netting per count keeps a
 * payment taken from two registers (booked against one of them) from turning into a surplus here
 * and a shortfall there — money only moved between registers.
 */
export interface FinanceAnalysisCashDiscrepancyItem {
  key: string
  cash_count_id: number
  event_id: number | null
  event_name: string
  date: string
  /** Every register of the count with a non-zero difference, even when they cancel out. */
  registers: FinanceAnalysisCashDiscrepancyRegister[]
  expected_amount: number
  measured_amount: number
  /** Signed net: positive = surplus (Kassenüberschuss), negative = shortfall (Kassenfehlbetrag). */
  amount: number
  status: FinanceAnalysisCashDiscrepancyStatus
  assignment: FinanceAnalysisCashDiscrepancyAssignment
  cost_centres: FinanceAnalysisCostCentreSplit[]
  booked_amount: number | null
  notes: string | null
  confirmed_by_name: string | null
  confirmed_at: string | null
}

export interface FinanceAnalysisCashDiscrepancyBreakdownItem {
  group_type: 'costCentre' | 'sphere'
  group_id: number | null
  group_code: string
  group_name: string
  month_key: string
  discrepancy_count: number
  surplus_amount: number
  shortfall_amount: number
  total_amount: number
}

export type FinanceAnalysisBankPositionType = 'receipt' | 'invoice' | 'event'

export interface FinanceAnalysisBankStatementPosition {
  id: number
  bank_statement_id: number
  statement_number: string
  statement_date: string
  checked_by_name: string
  position_type: FinanceAnalysisBankPositionType
  position_date: string
  amount: number
  direction: 'in' | 'out'
  reference: string
  counterparty: string
  receipt_id: number | null
  invoice_id: number | null
  event_id: number | null
  cost_centres: FinanceAnalysisCostCentreSplit[]
  notes: string | null
}

export interface FinanceAnalysisInvoiceItem {
  id: number
  invoice_date: string
  due_date: string | null
  paid_at: string | null
  service_date: string | null
  invoice_number: string
  company_name: string | null
  status: InvoiceStatus
  total_amount: number
}

export type FinanceLiquidityRowType =
  | 'opening'
  | 'cashReceipt'
  | 'cashInvoice'
  | 'reimbursementReceipt'
  | 'bankReceipt'
  | 'bankInvoice'
  | 'bankEvent'
  | 'bankStatementCheckpoint'
  | 'cashCountRegister'
  | 'cashCountRevenue'
  | 'registerCheck'
  | 'closing'

export interface FinanceLiquidityRow {
  id: string
  type: FinanceLiquidityRowType
  date: string
  pool: 'bank' | 'cash' | null
  label: string
  reference: string | null
  register_number: number | null
  delta_amount: number
  bank_balance: number
  cash_balance: number
  total_balance: number
  expected_amount: number | null
  measured_amount: number | null
  discrepancy_amount: number | null
  has_discrepancy: boolean
  note: string | null
}

export interface FinanceAnalysisSummary {
  start_date: string
  end_date: string
  receipt_count: number
  receipt_total: number
  receipt_paid_count: number
  receipt_paid_total: number
  receipt_open_count: number
  receipt_open_total: number
  receipt_draft_count: number
  receipt_draft_total: number
  receipt_cancelled_count: number
  receipt_cancelled_total: number
  cash_count_count: number
  cash_count_register_total: number
  cash_count_total_difference: number
  event_bank_revenue_total: number
  event_bank_revenue_count: number
  bank_statement_count: number
  bank_position_count: number
  bank_inflow_total: number
  bank_outflow_total: number
  invoice_count: number
  invoice_total: number
  net_result: number
  /** Total money (bank + all cash registers) at the very start of the period */
  money_before: number
  /** Total money (bank + all cash registers) at the end of the period */
  money_after: number
  /** Bank account balance at the start of the period */
  bank_before: number
  /** Bank account balance at the end of the period */
  bank_after: number
  /** Cash pool total at the start of the period */
  cash_before: number
  /** Cash pool total at the end of the period */
  cash_after: number
  /** Signed sum of all in-period cash differences — part of net_result as "Sonstiges: Kassendifferenzen" */
  cash_discrepancy_total: number
  cash_discrepancy_count: number
  /** The share of cash_discrepancy_total nobody has confirmed yet (unconfirmed or stale) */
  cash_discrepancy_unconfirmed_total: number
  cash_discrepancy_unconfirmed_count: number
}

/**
 * Bridge from the net result (an accounting result: booked by date and status) to the change in
 * total money (what really moved in the period). net_result + every line = money_change, exactly.
 */
export interface FinanceAnalysisReconciliation {
  net_result: number
  /** Receipts in the result that were not paid in the period, minus receipts paid now that belong elsewhere */
  receipt_timing: number
  /** Same for invoices: booked but not (yet) received, or received for another period */
  invoice_timing: number
  /** Event revenue that moved money but is not in the result (other cost centres when filtered) */
  event_difference: number
  /** Cash differences that moved money but are not in the result (other cost centres when filtered) */
  discrepancy_difference: number
  /** First counts of a register, cash movements no register could absorb, rounding */
  other: number
  money_change: number
  has_cost_centre_filter: boolean
}

export interface FinanceAnalysisData {
  summary: FinanceAnalysisSummary
  reconciliation: FinanceAnalysisReconciliation
  receipts: FinanceAnalysisReceiptItem[]
  receiptBreakdown: FinanceAnalysisReceiptBreakdownItem[]
  invoiceBreakdown: FinanceAnalysisInvoiceBreakdownItem[]
  cashCounts: FinanceAnalysisCashCountItem[]
  cashCountBreakdown: FinanceAnalysisCashCountBreakdownItem[]
  cashDiscrepancies: FinanceAnalysisCashDiscrepancyItem[]
  cashDiscrepancyBreakdown: FinanceAnalysisCashDiscrepancyBreakdownItem[]
  bankStatementPositions: FinanceAnalysisBankStatementPosition[]
  invoices: FinanceAnalysisInvoiceItem[]
  liquidityRows: FinanceLiquidityRow[]
}
