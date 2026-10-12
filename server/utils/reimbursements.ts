import type { CreateReimbursementBody } from '~/types/reimbursement'
import { ReceiptStatus } from '~/types/receipt'
import { isLocalDate } from '~/shared/time'

export function statusFromReimbursement(reimbursement: CreateReimbursementBody): ReceiptStatus {
  if (reimbursement.disbursed_at) return ReceiptStatus.Paid
  if (reimbursement.checked_at) return ReceiptStatus.Open
  return ReceiptStatus.Draft
}

export function validateReimbursementBody(reimbursement: CreateReimbursementBody) {
  if (!reimbursement.paid_by || !reimbursement.submitted_at || !Array.isArray(reimbursement.positions) || !reimbursement.positions.length) {
    return 'Missing required reimbursement fields'
  }
  if (typeof reimbursement.cash !== 'boolean') {
    return 'cash is required and must be boolean'
  }
  if (!reimbursement.cash) {
    if (!reimbursement.bankname?.trim()) return 'bankname is required when cash is false'
    if (!reimbursement.iban?.trim()) return 'iban is required when cash is false'
  }
  if (reimbursement.positions.some(position => !position.receipt_id)) {
    return 'Each reimbursement position requires a receipt id'
  }
  if (Boolean(reimbursement.checked_by) !== Boolean(reimbursement.checked_at)) {
    return 'checked_by and checked_at must both be set or both be empty'
  }
  if (Boolean(reimbursement.disbursed_by) !== Boolean(reimbursement.disbursed_at)) {
    return 'disbursed_by and disbursed_at must both be set or both be empty'
  }
  for (const value of [reimbursement.submitted_at, reimbursement.checked_at, reimbursement.disbursed_at]) {
    if (value && !isLocalDate(value)) return 'Dates must be given as YYYY-MM-DD'
  }

  return null
}
