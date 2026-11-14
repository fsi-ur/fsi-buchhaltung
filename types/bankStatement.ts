/**
 * - receipt / invoice / event: money booked against a record
 * - transfer: money between two own accounts. Entered on one side (`linked_position_id` null,
 *   `counter_account_id` = the other account) and confirmed on the other side by a transfer position
 *   with `linked_position_id` = the entered one, with its own date and amount.
 * - reimbursement: confirms that a reimbursement paid by bank left this account (`reimbursement_id`)
 */
export type BankStatementPositionType = 'receipt' | 'invoice' | 'event' | 'transfer' | 'reimbursement'

export interface BankStatementPositionRow {
  id: number
  bank_statement_id: number
  position_type: BankStatementPositionType
  position_date: string
  receipt_id: number | null
  invoice_id: number | null
  event_id: number | null
  /** transfer: the other own account; amount is signed from this statement's account */
  counter_account_id: number | null
  /** transfer confirmation: the transfer entered on the other account's statement */
  linked_position_id: number | null
  /** reimbursement confirmation: the reimbursement paid from this account */
  reimbursement_id: number | null
  amount: number | null
  notes: string | null
}

export interface BankStatementRow {
  id: number
  account_id: number
  account_name: string
  statement_number: string
  checked_by: number
  checked_by_name: string
  statement_date: string
}

export interface BankStatement extends BankStatementRow {
  positions: BankStatementPositionRow[]
}

/** The other side of a transfer, or the reimbursement a position confirms. Read-only context. */
export interface BankStatementPositionLink {
  /** What the other side / the reimbursement makes us expect, from this account's view */
  expected_amount: number
  /** expected date (entry date of the transfer, payout date of the reimbursement) */
  expected_date: string
  /** transfer confirmation: where it was entered; entered transfer: where it was confirmed (null = open) */
  statement_id: number | null
  statement_number: string | null
  account_name: string | null
  /** entered transfer, once confirmed: the confirmation's date and amount */
  confirmed_date: string | null
  confirmed_amount: number | null
  /** reimbursement: the member paid */
  member_name: string | null
}

export interface BankStatementPositionDetail extends BankStatementPositionRow {
  label: string
  entity_amount: number
  link: BankStatementPositionLink | null
}

/**
 * Something that moves the account but is not on any of its statements yet: a transfer entered on
 * the other account's statement, or a reimbursement paid from this account. A statement takes it
 * over with one click, adjusting date and amount to the paper statement.
 */
export interface BankOpenItem {
  key: string
  kind: 'transfer' | 'reimbursement'
  date: string
  /** From this account's view (negative = money leaves) */
  expected_amount: number
  source_position_id: number | null
  source_statement_id: number | null
  source_statement_number: string | null
  counter_account_id: number | null
  counter_account_name: string | null
  reimbursement_id: number | null
  member_name: string | null
  notes: string | null
  /** Older than OPEN_ITEM_OVERDUE_DAYS — the bank should have shown it by now */
  overdue: boolean
}

export interface BankStatementOverview extends BankStatementRow {
  position_count: number
  opening_balance: number
  closing_balance: number
}

export interface CreateBankStatementPositionBody {
  id?: number
  position_type: BankStatementPositionType
  position_date: string
  receipt_id: number | null
  invoice_id: number | null
  event_id: number | null
  counter_account_id: number | null
  linked_position_id?: number | null
  reimbursement_id?: number | null
  amount: number | null
  notes: string | null
  /** Client-side context for confirmations and entered transfers; ignored by the server */
  link?: BankStatementPositionLink | null
}

export interface CreateBankStatementBody {
  account_id: number
  statement_number: string
  checked_by: number
  statement_date: string
  positions: CreateBankStatementPositionBody[]
}

export interface BankStatementReceiptOption {
  id: number
  receipt_date: string
  receipt_number: string | null
  company_name: string | null
  total_amount: number
}

export interface BankStatementInvoiceOption {
  id: number
  invoice_date: string
  invoice_number: string
  company_name: string | null
  subject: string | null
  total_amount: number
}

export interface BankStatementEventOption {
  id: number
  name: string
  starts_at: string
}
