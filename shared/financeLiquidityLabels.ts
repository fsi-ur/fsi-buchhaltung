import type { FinanceLiquidityRow } from '~/types/financeAnalysis'

export interface LiquidityTranslate {
  (key: string, params?: Record<string, string | number>): string
}

export function liquidityRowLabel(row: FinanceLiquidityRow, t: LiquidityTranslate): string {
  const typeLabel = t(`financeAnalysis.liquidity.${row.type}`)

  if (row.type === 'opening') return t('financeAnalysis.liquidity.openingBalance')
  if (row.type === 'closing') return t('financeAnalysis.liquidity.closingBalance')
  if (row.type === 'bankStatementCheckpoint') return row.label ? `${typeLabel}: ${row.label}` : typeLabel

  let label = row.label
  if (row.type === 'reimbursementReceipt' && row.reference && label.startsWith(row.reference)) {
    label = label.slice(row.reference.length).trim()
  }

  const base = label ? `${typeLabel}: ${label}` : typeLabel
  if (
    (row.type === 'cashCountRegister' || row.type === 'cashCountRevenue' || row.type === 'registerCheck')
    && row.register_number !== null
  ) {
    return `${base} ${t('financeAnalysis.liquidity.registerSuffix', { number: row.register_number })}`
  }

  return base
}

export function liquidityRowNote(row: FinanceLiquidityRow, t: LiquidityTranslate): string {
  const note = row.note ?? ''

  if (note === 'firstCountNote') return t('financeAnalysis.liquidity.firstCountNote')
  if (note === 'eventRevenueNote') return t('financeAnalysis.liquidity.eventRevenueNote')
  if (note === 'unfilteredNote') return t('financeAnalysis.liquidity.unfilteredNote')
  if (note === 'discrepancyFound' || row.has_discrepancy) return t('financeAnalysis.liquidity.discrepancyFound')

  if (note.startsWith('reimbursementNote:')) {
    const member = note.slice('reimbursementNote:'.length)
    return t('financeAnalysis.liquidity.reimbursementNote', { member })
  }

  if (note.startsWith('bankCheckedNote:')) {
    const checkedBy = note.split(':').slice(2).join(':')
    return checkedBy ? t('financeAnalysis.liquidity.bankCheckedNote', { checkedBy }) : ''
  }

  return ''
}
