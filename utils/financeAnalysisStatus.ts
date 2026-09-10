import type { InvoiceStatus } from '~/types/invoice'
import { ReceiptStatus } from '~/types/receipt'

export type FinanceStatus = ReceiptStatus | InvoiceStatus
export type FinanceStatusTone = 'base' | 'warning' | 'success' | 'danger' | 'baseMuted'

export function financeStatusTone(status: FinanceStatus): FinanceStatusTone {
  switch (status) {
    case ReceiptStatus.Draft:
      return 'base'
    case ReceiptStatus.Open:
      return 'warning'
    case ReceiptStatus.Paid:
      return 'success'
    case ReceiptStatus.Cancelled:
      return 'danger'
    default:
      return 'baseMuted'
  }
}

export function financeStatusDotClass(status: FinanceStatus) {
  switch (financeStatusTone(status)) {
    case 'success':
      return 'bg-success-500'
    case 'warning':
      return 'bg-warning-400'
    case 'danger':
      return 'bg-danger-500'
    case 'base':
      return 'bg-base-400'
    default:
      return 'bg-base-300'
  }
}
