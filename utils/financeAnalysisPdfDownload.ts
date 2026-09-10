import type { InvoiceStatus } from '~/types/invoice'
import type { ReceiptStatus } from '~/types/receipt'
import type {
  FinanceAnalysisExportGrouping,
  FinanceAnalysisInvoiceDateField,
  FinanceAnalysisReceiptDateField,
} from '~/utils/excel/financeAnalysisReport'

export interface FinanceAnalysisPdfExportPayload {
  startDate: string
  endDate: string
  statuses: ReceiptStatus[]
  receiptDateField: FinanceAnalysisReceiptDateField
  invoiceStatuses: InvoiceStatus[]
  invoiceDateField: FinanceAnalysisInvoiceDateField
  costCentreId: number | null
  includeChildCostCentres: boolean
  includeComparison: boolean
  annualClosing: boolean
  compareToBudget: boolean
  budgetIds: number[]
  exportGrouping: FinanceAnalysisExportGrouping
  exportSplitByMonth: boolean
  exportSplitByPaymentStatus: boolean
  includeTableOfContents: boolean
  includeBalanceSheet: boolean
  includeOverview: boolean
  includeReceiptList: boolean
  includeCashCountList: boolean
  includeBankStatementList: boolean
  includeInvoiceList: boolean
}

export async function downloadFinanceAnalysisPdf(
  payload: FinanceAnalysisPdfExportPayload,
): Promise<{ ok: true } | { ok: false, error?: string }> {
  const response = await $fetch.raw<Blob>('/api/finances/analysis/export/pdf', {
    method: 'POST',
    body: payload,
    responseType: 'blob',
  })
  const blob = response._data

  if (!blob || !blob.type.includes('application/pdf')) {
    try {
      const parsed = JSON.parse(await blob!.text())
      return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : undefined }
    } catch {
      return { ok: false }
    }
  }

  const disposition = response.headers.get('content-disposition') ?? ''
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1]
    ?? `finance-analysis_${payload.startDate}_${payload.endDate}.pdf`

  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)

  return { ok: true }
}
