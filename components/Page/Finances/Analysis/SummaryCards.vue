<template>
  <div class="space-y-4">
    <div
      v-if="summary.period_discrepancy_count > 0"
      class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-warning-50 px-4 py-3 text-sm text-warning-900"
    >
      <Icon name="material-symbols:warning-outline-rounded" class="h-5 w-5 shrink-0" aria-hidden="true" />
      <span class="font-medium">
        {{ t('financeAnalysis.discrepancyWarning', {
          count: summary.period_discrepancy_count,
          amount: formatCurrency(summary.period_discrepancy_total),
        }) }}
      </span>
      <button type="button" class="cursor-pointer underline underline-offset-2" @click="$emit('show-liquidity')">
        {{ t('financeAnalysis.discrepancyWarningAction') }}
      </button>
    </div>

    <section class="space-y-3">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-base-500">
        {{ t('financeAnalysis.resultSectionTitle') }}
      </h3>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <PageFinancesAnalysisStatCard
          tone="accent"
          :label="t('financeAnalysis.cards.receiptTotal')"
          :value="formatCurrency(summary.receipt_total)"
          :caption="t('financeAnalysis.cards.receiptCount', { count: summary.receipt_count })"
        />

        <PageFinancesAnalysisStatCard
          tone="success"
          :label="t('financeAnalysis.cards.eventRevenue')"
          :value="formatCurrency(summary.cash_count_total_difference + summary.event_bank_revenue_total)"
          :caption="t('financeAnalysis.cards.eventRevenueCaption', {
            cashCounts: summary.cash_count_count,
            bankPositions: summary.event_bank_revenue_count,
          })"
        />

        <PageFinancesAnalysisStatCard
          tone="info"
          :label="t('financeAnalysis.cards.invoiceRevenue')"
          :value="formatCurrency(summary.invoice_total)"
          :caption="t('financeAnalysis.cards.invoiceCountCount', { count: summary.invoice_count })"
        />

        <PageFinancesAnalysisStatCard
          :tone="summary.net_result >= 0 ? 'success' : 'danger'"
          :label="t('financeAnalysis.cards.netResult')"
          :value="formatCurrency(summary.net_result)"
          :caption="summary.net_result >= 0 ? t('financeAnalysis.cards.positiveResult') : t('financeAnalysis.cards.negativeResult')"
        />
      </div>
    </section>

    <section class="space-y-3">
      <h3 class="text-sm font-semibold uppercase tracking-wide text-base-500">
        {{ t('financeAnalysis.assetsSectionTitle') }}
      </h3>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <PageFinancesAnalysisStatCard
          v-for="card in balanceCards"
          :key="card.key"
          :label="card.label"
          :value="formatCurrency(card.after)"
          :caption="t('financeAnalysis.cards.balanceCaption', {
            before: formatCurrency(card.before),
            change: formatSignedCurrency(card.after - card.before),
          })"
        />

        <PageFinancesAnalysisStatCard
          :label="t('financeAnalysis.cards.bankMovement')"
          :value="formatSignedCurrency(summary.bank_inflow_total - summary.bank_outflow_total)"
          :caption="t('financeAnalysis.cards.bankMovementCaption', {
            inflow: formatCurrency(summary.bank_inflow_total),
            outflow: formatCurrency(summary.bank_outflow_total),
          })"
        />
      </div>
    </section>

    <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div v-for="card in receiptStateCards" :key="card.key" class="rounded-xl bg-base-100 px-4 py-3">
        <div class="flex items-center gap-1.5 text-xs text-base-500">
          <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :class="card.dotClass" />
          <span class="min-w-0 truncate">{{ card.label }}</span>
        </div>
        <div class="mt-1 font-semibold tabular-nums">{{ formatCurrency(card.total) }}</div>
        <div class="text-xs text-base-500">{{ t('financeAnalysis.countLabel', { count: card.count }) }}</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { financeStatusDotClass } from '~/utils/financeAnalysisStatus'
import type { FinanceAnalysisSummary } from '~/types/financeAnalysis'
import { ReceiptStatus } from '~/types/receipt'

const props = defineProps<{
  summary: FinanceAnalysisSummary
  receiptStatusLabels: Record<ReceiptStatus, string>
}>()

defineEmits<{
  (e: 'show-liquidity'): void
}>()

const { t } = useI18n()
const { formatCurrency } = useLocaleFormatters()

function formatSignedCurrency(value: number) {
  const rounded = Number(value.toFixed(2))
  return `${rounded > 0 ? '+' : ''}${formatCurrency(rounded)}`
}

const balanceCards = computed(() => [
  {
    key: 'total',
    label: t('financeAnalysis.cards.totalAssets'),
    before: props.summary.money_before,
    after: props.summary.money_after,
  },
  {
    key: 'bank',
    label: t('financeAnalysis.cards.bankBalance'),
    before: props.summary.bank_before,
    after: props.summary.bank_after,
  },
  {
    key: 'cash',
    label: t('financeAnalysis.cards.cashBalance'),
    before: props.summary.cash_before,
    after: props.summary.cash_after,
  },
])

const receiptStateCards = computed(() => ([
  { key: ReceiptStatus.Paid, count: props.summary.receipt_paid_count, total: props.summary.receipt_paid_total },
  { key: ReceiptStatus.Open, count: props.summary.receipt_open_count, total: props.summary.receipt_open_total },
  { key: ReceiptStatus.Draft, count: props.summary.receipt_draft_count, total: props.summary.receipt_draft_total },
  { key: ReceiptStatus.Cancelled, count: props.summary.receipt_cancelled_count, total: props.summary.receipt_cancelled_total },
] as const).map(card => ({
  ...card,
  label: props.receiptStatusLabels[card.key],
  dotClass: financeStatusDotClass(card.key),
})))
</script>
