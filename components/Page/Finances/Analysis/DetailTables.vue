<template>
  <section class="space-y-4 rounded-xl border border-base-200 p-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h3 class="font-semibold">{{ activeTab.label }}</h3>
        <p class="text-sm text-base-500">{{ activeTab.description }}</p>
      </div>

      <CommonGlobalSearchBar
        v-if="activeTab.key !== 'liquidity'"
        v-model="search"
        :placeholder="t('financeAnalysis.searchPlaceholder')"
      />
    </div>

    <CommonSegmentedControl
      :model-value="activeTabKey"
      wrap
      :options="tabOptions"
      :aria-label="t('financeAnalysis.analysisTitle')"
      @update:model-value="activeTabKey = $event as DetailTabKey"
    />

    <PageFinancesAnalysisLiquidityTable v-if="activeTabKey === 'liquidity'" :rows="analysis.liquidityRows" />

    <CommonAdvancedTable
      v-else-if="activeTabKey === 'receipts'"
      v-model:search="search"
      :rows="analysis.receipts"
      :columns="receiptColumns"
      :loading="loading"
      :empty-text="t('financeAnalysis.noReceipts')"
      table-class="min-w-3xl"
      @row-open="$emit('open', { page: 'ReceiptCreate', id: $event.id })"
    >
      <template #cell-status="{ row }">
        <CommonStatusBadge :label="receiptStatusLabels[row.status]" :tone="financeStatusTone(row.status)" />
      </template>
    </CommonAdvancedTable>

    <CommonAdvancedTable
      v-else-if="activeTabKey === 'invoices'"
      v-model:search="search"
      :rows="analysis.invoices"
      :columns="invoiceColumns"
      :loading="loading"
      :empty-text="t('financeAnalysis.noInvoices')"
      table-class="min-w-3xl"
      @row-open="$emit('open', { page: 'InvoiceCreate', id: $event.id })"
    >
      <template #cell-status="{ row }">
        <CommonStatusBadge :label="invoiceStatusLabels[row.status]" :tone="financeStatusTone(row.status)" />
      </template>
    </CommonAdvancedTable>

    <CommonAdvancedTable
      v-else-if="activeTabKey === 'cashCounts'"
      v-model:search="search"
      :rows="analysis.cashCounts"
      :columns="cashCountColumns"
      :loading="loading"
      :empty-text="t('financeAnalysis.noCashCounts')"
      table-class="min-w-4xl"
      @row-open="$emit('open', { page: 'CashCountCreate', id: $event.id })"
    />

    <CommonAdvancedTable
      v-else
      v-model:search="search"
      :rows="analysis.bankStatementPositions"
      :columns="bankStatementColumns"
      :loading="loading"
      :empty-text="t('financeAnalysis.noBankStatementPositions')"
      table-class="min-w-4xl"
      :can-open-row="canOpenBankStatement"
      @row-open="$emit('open', { page: 'BankStatementCreate', id: $event.bank_statement_id })"
    >
      <template #cell-amount="{ row }">
        <span :class="row.direction === 'out' ? 'text-danger-700' : 'text-success-700'">
          {{ formatSignedAmount(row) }}
        </span>
      </template>
    </CommonAdvancedTable>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SegmentedControlOption } from '~/components/Common/SegmentedControl.vue'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { financeStatusTone } from '~/utils/financeAnalysisStatus'
import type {
  FinanceAnalysisBankStatementPosition,
  FinanceAnalysisCashCountItem,
  FinanceAnalysisCostCentreSplit,
  FinanceAnalysisData,
  FinanceAnalysisInvoiceItem,
  FinanceAnalysisReceiptItem,
} from '~/types/financeAnalysis'
import type { InvoiceStatus } from '~/types/invoice'
import type { ReceiptStatus } from '~/types/receipt'
import type { InvoiceDateField, ReceiptDateField } from '~/composables/useFinanceAnalysisFilters'

export type DetailTabKey = 'receipts' | 'invoices' | 'cashCounts' | 'bankStatements' | 'liquidity'

const props = defineProps<{
  analysis: FinanceAnalysisData
  loading: boolean
  receiptDateField: ReceiptDateField
  invoiceDateField: InvoiceDateField
  receiptDateFieldLabel: string
  invoiceDateFieldLabel: string
  receiptStatusLabels: Record<ReceiptStatus, string>
  invoiceStatusLabels: Record<InvoiceStatus, string>
  canViewBankStatements: boolean
}>()

defineEmits<{
  (e: 'open', target: { page: string, id: number }): void
}>()

const activeTabKey = defineModel<DetailTabKey>('tab', { default: 'receipts' })

const { t } = useI18n()
const { formatCurrency, formatDate, formatDateTime } = useLocaleFormatters()

const search = ref('')

function canOpenBankStatement() {
  return props.canViewBankStatements
}

watch(activeTabKey, () => {
  search.value = ''
})

const tabs = computed(() => ([
  {
    key: 'receipts' as const,
    label: t('financeAnalysis.receiptsTableTitle'),
    description: t('financeAnalysis.receiptsSectionDescription'),
    count: props.analysis.receipts.length,
  },
  {
    key: 'invoices' as const,
    label: t('financeAnalysis.invoicesTableTitle'),
    description: t('financeAnalysis.invoicesSectionDescription'),
    count: props.analysis.invoices.length,
  },
  {
    key: 'cashCounts' as const,
    label: t('financeAnalysis.cashCountsTableTitle'),
    description: t('financeAnalysis.cashCountsSectionDescription'),
    count: props.analysis.cashCounts.length,
  },
  {
    key: 'bankStatements' as const,
    label: t('financeAnalysis.bankStatementsTableTitle'),
    description: t('financeAnalysis.bankStatementsSectionDescription'),
    count: props.analysis.bankStatementPositions.length,
  },
  {
    key: 'liquidity' as const,
    label: t('financeAnalysis.liquidity.title'),
    description: t('financeAnalysis.liquidity.subtitle'),
    count: Math.max(props.analysis.liquidityRows.length - 2, 0),
  },
]))

const activeTab = computed(() => tabs.value.find(tab => tab.key === activeTabKey.value) ?? tabs.value[0]!)

const tabOptions = computed<SegmentedControlOption[]>(() => tabs.value.map(tab => ({
  value: tab.key,
  label: tab.label,
  badge: tab.count,
})))

function formatSplits(splits: FinanceAnalysisCostCentreSplit[]) {
  if (!splits.length) return ''

  return splits
    .map((split) => {
      const sphereLabel = [split.sphere_code, split.sphere_name].filter(Boolean).join(' - ')
      const costCentreLabel = [split.code, split.name].filter(Boolean).join(' - ')
      const label = sphereLabel ? `${sphereLabel} / ${costCentreLabel}` : costCentreLabel
      return splits.length > 1 ? `${label} (${split.allocation_percentage.toFixed(2)}%)` : label
    })
    .join(', ')
}

function receiptDateValue(receipt: FinanceAnalysisReceiptItem) {
  return props.receiptDateField === 'reimbursement_submitted_at'
    ? receipt.reimbursement_submitted_at || receipt.receipt_date
    : receipt.receipt_date
}

function invoiceDateValue(invoice: FinanceAnalysisInvoiceItem) {
  if (props.invoiceDateField === 'due_date') return invoice.due_date
  if (props.invoiceDateField === 'service_date') return invoice.service_date
  if (props.invoiceDateField === 'paid_at') return invoice.paid_at
  return invoice.invoice_date
}

function formatSignedAmount(position: FinanceAnalysisBankStatementPosition) {
  const signed = position.direction === 'out' ? -position.amount : position.amount
  return `${signed > 0 ? '+' : ''}${formatCurrency(signed)}`
}

const receiptColumns = computed<AdvancedTableColumn<FinanceAnalysisReceiptItem>[]>(() => [
  {
    key: 'date',
    globalSearchable: true,
    label: props.receiptDateFieldLabel,
    filterType: 'date',
    getValue: receiptDateValue,
    format: row => formatDate(receiptDateValue(row)),
    mobile: 'meta',
    headerClass: 'w-40',
  },
  {
    key: 'receipt_number',
    globalSearchable: true,
    label: t('receipt.receiptNumber'),
    getValue: row => row.receipt_number ?? '',
    format: row => row.receipt_number || t('receipt.noNumber'),
    mobile: 'title',
  },
  {
    key: 'company_name',
    globalSearchable: true,
    label: t('receipt.company'),
    getValue: row => row.company_name ?? '',
    format: row => row.company_name || t('receipt.noCompany'),
    mobile: 'meta',
  },
  {
    key: 'status',
    globalSearchable: true,
    label: t('financeAnalysis.receiptStatusLabel'),
    getValue: row => props.receiptStatusLabels[row.status],
    mobile: 'meta',
    headerClass: 'w-32',
  },
  {
    key: 'total_amount',
    label: t('receipt.grossAmount'),
    filterType: 'number',
    getValue: row => row.total_amount,
    format: row => formatCurrency(row.total_amount),
    headerClass: 'w-36 text-right',
    cellClass: 'text-right font-medium tabular-nums',
    mobile: 'meta',
  },
])

const invoiceColumns = computed<AdvancedTableColumn<FinanceAnalysisInvoiceItem>[]>(() => [
  {
    key: 'date',
    globalSearchable: true,
    label: props.invoiceDateFieldLabel,
    filterType: 'date',
    getValue: invoiceDateValue,
    format: (row) => {
      const value = invoiceDateValue(row)
      return value ? formatDate(value) : t('common.notAvailable')
    },
    mobile: 'meta',
    headerClass: 'w-40',
  },
  {
    key: 'invoice_number',
    globalSearchable: true,
    label: t('invoice.invoiceNumber'),
    getValue: row => row.invoice_number,
    mobile: 'title',
  },
  {
    key: 'company_name',
    globalSearchable: true,
    label: t('invoice.company'),
    getValue: row => row.company_name ?? '',
    format: row => row.company_name || t('invoice.noCompany'),
    mobile: 'meta',
  },
  {
    key: 'status',
    globalSearchable: true,
    label: t('financeAnalysis.invoiceStatusLabel'),
    getValue: row => props.invoiceStatusLabels[row.status],
    mobile: 'meta',
    headerClass: 'w-32',
  },
  {
    key: 'total_amount',
    label: t('receipt.grossAmount'),
    filterType: 'number',
    getValue: row => row.total_amount,
    format: row => formatCurrency(row.total_amount),
    headerClass: 'w-36 text-right',
    cellClass: 'text-right font-medium tabular-nums',
    mobile: 'meta',
  },
])

const cashCountColumns = computed<AdvancedTableColumn<FinanceAnalysisCashCountItem>[]>(() => [
  {
    key: 'counted_after_at',
    globalSearchable: true,
    label: t('cashCount.countedAfterAt'),
    filterType: 'date',
    getValue: row => row.counted_after_at,
    format: row => formatDateTime(row.counted_after_at),
    mobile: 'meta',
    headerClass: 'w-44',
  },
  {
    key: 'event_name',
    globalSearchable: true,
    label: t('cashCount.event'),
    getValue: row => row.event_name,
    mobile: 'title',
  },
  {
    key: 'cost_centres',
    globalSearchable: true,
    label: t('financeAnalysis.sphereAndCostCentre'),
    getValue: row => formatSplits(row.cost_centres),
    format: row => formatSplits(row.cost_centres) || t('common.notAvailable'),
    mobile: 'meta',
    mobileLabel: true,
  },
  {
    key: 'register_count',
    label: t('cashCount.registerCount'),
    filterType: 'number',
    getValue: row => row.register_count,
    headerClass: 'w-24 text-right',
    cellClass: 'text-right tabular-nums',
    mobile: 'meta',
    mobileLabel: true,
  },
  {
    key: 'total_after_amount',
    label: t('cashCount.totalAfter'),
    filterType: 'number',
    getValue: row => row.total_after_amount,
    format: row => formatCurrency(row.total_after_amount),
    headerClass: 'w-32 text-right',
    cellClass: 'text-right tabular-nums',
    mobile: 'hidden',
  },
  {
    key: 'total_difference',
    label: t('cashCount.totalDifference'),
    filterType: 'number',
    getValue: row => row.total_difference,
    format: row => formatCurrency(row.total_difference),
    headerClass: 'w-32 text-right',
    cellClass: 'text-right font-medium tabular-nums',
    mobile: 'meta',
  },
])

const bankStatementColumns = computed<AdvancedTableColumn<FinanceAnalysisBankStatementPosition>[]>(() => [
  {
    key: 'position_date',
    globalSearchable: true,
    label: t('financeAnalysis.bankStatements.positionDate'),
    filterType: 'date',
    getValue: row => row.position_date,
    format: row => formatDate(row.position_date),
    mobile: 'meta',
    headerClass: 'w-36',
  },
  {
    key: 'statement_number',
    globalSearchable: true,
    label: t('financeAnalysis.bankStatements.statementNumber'),
    getValue: row => row.statement_number,
    format: row => row.statement_number || t('common.notAvailable'),
    mobile: 'meta',
    mobileLabel: true,
    headerClass: 'w-32',
  },
  {
    key: 'position_type',
    globalSearchable: true,
    label: t('financeAnalysis.bankStatements.positionType'),
    getValue: row => t(`financeAnalysis.bankStatements.types.${row.position_type}`),
    mobile: 'meta',
    headerClass: 'w-32',
  },
  {
    key: 'reference',
    globalSearchable: true,
    label: t('financeAnalysis.bankStatements.reference'),
    getValue: row => row.reference,
    format: row => row.reference || t('common.notAvailable'),
    mobile: 'title',
  },
  {
    key: 'counterparty',
    globalSearchable: true,
    label: t('financeAnalysis.bankStatements.counterparty'),
    getValue: row => row.counterparty,
    format: row => row.counterparty || t('common.notAvailable'),
    mobile: 'meta',
  },
  {
    key: 'cost_centres',
    globalSearchable: true,
    label: t('financeAnalysis.sphereAndCostCentre'),
    getValue: row => formatSplits(row.cost_centres),
    format: row => formatSplits(row.cost_centres) || t('common.notAvailable'),
    mobile: 'hidden',
  },
  {
    key: 'checked_by_name',
    globalSearchable: true,
    label: t('financeAnalysis.bankStatements.checkedBy'),
    getValue: row => row.checked_by_name,
    format: row => row.checked_by_name || t('common.notAvailable'),
    mobile: 'hidden',
    headerClass: 'w-40',
  },
  {
    key: 'amount',
    label: t('receipt.grossAmount'),
    filterType: 'number',
    getValue: row => (row.direction === 'out' ? -row.amount : row.amount),
    format: formatSignedAmount,
    headerClass: 'w-36 text-right',
    cellClass: 'text-right font-medium tabular-nums',
    mobile: 'meta',
  },
])
</script>
