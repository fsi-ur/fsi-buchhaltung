import { computeTotalMoney, buildCashLedger } from '~/server/utils/cashPosition'
import {
  resolveSelectedCostCentreIds,
  roundFinanceCurrency,
  type FinanceAnalysisFilters,
} from '~/server/utils/financeAnalysis/filters'
import {
  loadFinanceAnalysisReceipts,
  loadFinanceAnalysisReceiptBreakdown,
} from '~/server/utils/financeAnalysis/receipts'
import {
  loadFinanceAnalysisInvoices,
  loadFinanceAnalysisInvoiceBreakdown,
} from '~/server/utils/financeAnalysis/invoices'
import {
  buildCashCountBreakdown,
  loadFinanceAnalysisCashCounts,
  loadFinanceAnalysisRegisterTotal,
} from '~/server/utils/financeAnalysis/cashCounts'
import {
  loadFinanceAnalysisBankStatementPositions,
  summarizeBankStatementPositions,
} from '~/server/utils/financeAnalysis/bankStatements'
import { buildLiquidityRows } from '~/server/utils/financeAnalysis/liquidity'
import type { FinanceAnalysisData } from '~/types/financeAnalysis'
import { ReceiptStatus } from '~/types/receipt'

function summarizeReceipts(receipts: FinanceAnalysisData['receipts']) {
  const summary = {
    receipt_total: 0,
    receipt_paid_count: 0,
    receipt_paid_total: 0,
    receipt_open_count: 0,
    receipt_open_total: 0,
    receipt_draft_count: 0,
    receipt_draft_total: 0,
    receipt_cancelled_count: 0,
    receipt_cancelled_total: 0,
  }

  for (const receipt of receipts) {
    summary.receipt_total += receipt.total_amount

    switch (receipt.status) {
      case ReceiptStatus.Paid:
        summary.receipt_paid_count += 1
        summary.receipt_paid_total += receipt.total_amount
        break
      case ReceiptStatus.Open:
        summary.receipt_open_count += 1
        summary.receipt_open_total += receipt.total_amount
        break
      case ReceiptStatus.Cancelled:
        summary.receipt_cancelled_count += 1
        summary.receipt_cancelled_total += receipt.total_amount
        break
      case ReceiptStatus.Draft:
      default:
        summary.receipt_draft_count += 1
        summary.receipt_draft_total += receipt.total_amount
        break
    }
  }

  return summary
}

export async function loadFinanceAnalysis(filters: FinanceAnalysisFilters): Promise<FinanceAnalysisData> {
  const { startDate, endDate } = filters
  const costCentreIds = await resolveSelectedCostCentreIds(filters.costCentreId, filters.includeChildCostCentres)
  const context = { filters, costCentreIds }

  const [
    receipts,
    receiptBreakdown,
    invoices,
    invoiceBreakdown,
    cashCounts,
    cashCountRegisterTotal,
    bankStatementPositions,
    openingPosition,
    closingPosition,
    ledgerResult,
  ] = await Promise.all([
    loadFinanceAnalysisReceipts(context),
    loadFinanceAnalysisReceiptBreakdown(context),
    loadFinanceAnalysisInvoices(context),
    loadFinanceAnalysisInvoiceBreakdown(context),
    loadFinanceAnalysisCashCounts(context),
    loadFinanceAnalysisRegisterTotal(context),
    loadFinanceAnalysisBankStatementPositions(context),
    computeTotalMoney(startDate, true),
    computeTotalMoney(endDate, false),
    buildCashLedger(endDate),
  ])

  const liquidityRows = buildLiquidityRows(
    ledgerResult.rows,
    startDate,
    endDate,
    openingPosition,
    closingPosition,
    costCentreIds.length > 0,
  )

  const discrepancyRows = liquidityRows.filter(row => (
    (row.type === 'cashCountRegister' || row.type === 'registerCheck') && row.discrepancy_amount !== null
  ))

  const receiptSummary = summarizeReceipts(receipts)
  const bankSummary = summarizeBankStatementPositions(bankStatementPositions)
  const cashCountTotalDifference = cashCounts.reduce((total, cashCount) => total + cashCount.total_difference, 0)
  const invoiceTotal = invoices.reduce((total, invoice) => total + invoice.total_amount, 0)

  return {
    summary: {
      start_date: startDate,
      end_date: endDate,
      receipt_count: receipts.length,
      receipt_total: roundFinanceCurrency(receiptSummary.receipt_total),
      receipt_paid_count: receiptSummary.receipt_paid_count,
      receipt_paid_total: roundFinanceCurrency(receiptSummary.receipt_paid_total),
      receipt_open_count: receiptSummary.receipt_open_count,
      receipt_open_total: roundFinanceCurrency(receiptSummary.receipt_open_total),
      receipt_draft_count: receiptSummary.receipt_draft_count,
      receipt_draft_total: roundFinanceCurrency(receiptSummary.receipt_draft_total),
      receipt_cancelled_count: receiptSummary.receipt_cancelled_count,
      receipt_cancelled_total: roundFinanceCurrency(receiptSummary.receipt_cancelled_total),
      cash_count_count: cashCounts.length,
      cash_count_register_total: cashCountRegisterTotal,
      cash_count_total_difference: roundFinanceCurrency(cashCountTotalDifference),
      event_bank_revenue_total: bankSummary.eventRevenueTotal,
      event_bank_revenue_count: bankSummary.eventRevenueCount,
      bank_statement_count: bankSummary.statementCount,
      bank_position_count: bankSummary.positionCount,
      bank_inflow_total: bankSummary.inflowTotal,
      bank_outflow_total: bankSummary.outflowTotal,
      invoice_count: invoices.length,
      invoice_total: roundFinanceCurrency(invoiceTotal),
      net_result: roundFinanceCurrency(
        cashCountTotalDifference + bankSummary.eventRevenueTotal + invoiceTotal - receiptSummary.receipt_total,
      ),
      money_before: openingPosition.totalMoney,
      money_after: closingPosition.totalMoney,
      bank_before: openingPosition.bankBalance,
      bank_after: closingPosition.bankBalance,
      cash_before: openingPosition.cashTotal,
      cash_after: closingPosition.cashTotal,
      period_discrepancy_total: roundFinanceCurrency(
        discrepancyRows.reduce((total, row) => total + (row.discrepancy_amount ?? 0), 0),
      ),
      period_discrepancy_count: discrepancyRows.filter(row => row.has_discrepancy).length,
    },
    receipts,
    receiptBreakdown,
    invoiceBreakdown,
    cashCounts,
    cashCountBreakdown: buildCashCountBreakdown(cashCounts),
    bankStatementPositions,
    invoices,
    liquidityRows,
  }
}
