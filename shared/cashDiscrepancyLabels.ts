import type {
  FinanceAnalysisCashDiscrepancyItem,
  FinanceAnalysisCostCentreSplit,
} from '~/types/financeAnalysis'

interface Translate {
  (key: string, params?: Record<string, string | number>): string
}

export function formatCostCentreSplitTarget(splits: FinanceAnalysisCostCentreSplit[]) {
  return splits
    .map((split) => {
      const sphereLabel = [split.sphere_code, split.sphere_name].filter(Boolean).join(' - ')
      const costCentreLabel = [split.code, split.name].filter(Boolean).join(' - ')
      const label = sphereLabel ? `${sphereLabel} / ${costCentreLabel}` : costCentreLabel
      return splits.length > 1 ? `${label} (${split.allocation_percentage.toFixed(2)}%)` : label
    })
    .join(', ')
}

export function cashDiscrepancyAssignmentLabel(item: FinanceAnalysisCashDiscrepancyItem, t: Translate) {
  if (item.assignment === 'none') return t('cashCount.discrepancies.assignment.none')
  return t(`cashCount.discrepancies.assignment.${item.assignment}`, { target: formatCostCentreSplitTarget(item.cost_centres) })
}

export function cashDiscrepancyStatusLabel(item: FinanceAnalysisCashDiscrepancyItem, t: Translate) {
  return t(`cashCount.discrepancies.status.${item.status}`)
}

export function cashDiscrepancyRegistersLabel(item: FinanceAnalysisCashDiscrepancyItem, t: Translate) {
  // A bank difference: the account and the statement that confirmed it.
  if (item.bank) return t('cashCount.discrepancies.bankStatementRef', { account: item.bank.account_name, number: item.bank.statement_number })
  const numbers = item.registers.map(register => register.register_number).join(', ')
  return item.registers.length === 1
    ? t('cashCount.discrepancies.register', { number: numbers })
    : t('cashCount.discrepancies.registers', { numbers })
}

/** Register checks have no event — name them for what they are. */
export function cashDiscrepancySourceLabel(item: FinanceAnalysisCashDiscrepancyItem, t: Translate) {
  if (item.bank) {
    return t(
      item.bank.kind === 'transfer' ? 'cashCount.discrepancies.bankTransfer' : 'cashCount.discrepancies.bankReimbursement',
      { counterparty: item.bank.counterparty },
    )
  }
  return item.event_id ? item.event_name : t('cashCount.registerCheck')
}
