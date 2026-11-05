import { ReceiptStatus } from '~/types/receipt'
import { MAX_RECORD_POSITIONS, TOO_MANY_POSITIONS } from '~/server/utils/api/limits'

export function validateReceiptPayload(receipt: any) {
  if (!receipt.company_id || !receipt.receipt_date || !receipt.status || !Array.isArray(receipt.positions) || receipt.positions.length === 0) {
    return 'Missing required receipt fields'
  }
  if (receipt.positions.length > MAX_RECORD_POSITIONS) return TOO_MANY_POSITIONS

  if (receipt.positions.some((position: any) => !position?.sphere || !position?.cost_centre || position?.amount === null || position?.amount === undefined)) {
    return 'Each position requires sphere, cost centre and amount'
  }

  return null
}

export function receiptRequiresFile(status: ReceiptStatus | string) {
  return status === ReceiptStatus.Open || status === ReceiptStatus.Paid
}
