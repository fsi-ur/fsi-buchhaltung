import type { Receipt } from "./receipt"

export enum ReimbursementStatus {
  Submitted = 'submitted',
  Checked = 'checked',
  Disbursed = 'disbursed',
  Cancelled = 'cancelled',
}

export interface ReimbursementPositionRow {
  id: number
  reimbursement_id: number
  receipt_id: number
}

export interface ReimbursementPosition {
  id: number
  receipt: Receipt
}

export interface CreateReimbursementPositionBody {
  receipt_id: number
  receipt?: Receipt
}

export interface ReimbursementRow {
  id: number
  paid_by: number
  submitted_at: string
  bankname: string | null
  account_holder: string | null
  iban: string | null
  bic: string | null
  advance: number
  cash: boolean
  checked_by: number | null
  checked_at: string | null
  disbursed_by: number | null
  disbursed_at: string | null
  /** Own account a bank (non-cash) reimbursement is paid from; required once disbursed */
  paid_from_account_id: number | null
}

/** The bank statement position that confirms a bank reimbursement left the account. */
export interface ReimbursementBankConfirmation {
  bank_statement_id: number
  bank_statement_position_id: number
  statement_number: string
  account_name: string
  date: string
  /** Signed from the account's view (negative = money left) */
  amount: number
  /** What the receipts make us expect (negative) */
  expected_amount: number
  /** amount − expected_amount; non-zero = bank difference */
  difference: number
}

export interface Reimbursement extends ReimbursementRow {
  positions: ReimbursementPosition[]
  /** Set once a bank statement confirmed the payout (bank reimbursements only) */
  bank_confirmation?: ReimbursementBankConfirmation | null
}

export interface ReimbursementOverview {
  id: number
  paid_by: number
  member_name: string
  submitted_at: string
  checked_at: string | null
  disbursed_at: string | null
  receipt_count: number
  total_amount: number
  /** Bank reimbursement paid out: whether a statement confirmed it; null for cash or not yet paid */
  bank_confirmed: boolean | null
}

export interface CreateReimbursementBody {
  paid_by: number,
  bankname: string | null,
  account_holder: string | null,
  iban: string | null,
  bic: string | null,
  advance: number,
  cash: boolean,
  submitted_at: string,
  checked_at: string | null,
  checked_by: number | null,
  disbursed_at: string | null,
  disbursed_by: number | null,
  paid_from_account_id?: number | null,
  positions: CreateReimbursementPositionBody[]
}
