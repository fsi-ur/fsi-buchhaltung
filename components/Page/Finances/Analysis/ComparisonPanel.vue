<template>
  <section class="space-y-4 rounded-xl border border-base-200 p-4">
    <div class="space-y-1">
      <h3 class="font-semibold">{{ t('financeAnalysis.comparisonTitle') }}</h3>
      <p class="text-sm text-base-500">
        {{ t('financeAnalysis.previousYearRange', {
          start: formatDate(comparison.start_date),
          end: formatDate(comparison.end_date),
        }) }}
      </p>
    </div>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      <div v-for="card in cards" :key="card.key" class="rounded-xl bg-base-50 px-4 py-4">
        <div class="text-sm text-base-700">{{ card.label }}</div>

        <div class="mt-3 space-y-1 text-sm text-base-600">
          <div class="flex items-baseline justify-between gap-2">
            <span>{{ t('financeAnalysis.currentValue') }}</span>
            <span class="font-medium tabular-nums text-base-900">{{ formatValue(card.current, card.type) }}</span>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <span>{{ t('financeAnalysis.previousValue') }}</span>
            <span class="font-medium tabular-nums text-base-900">{{ formatValue(card.previous, card.type) }}</span>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-1.5 text-sm font-semibold" :class="differenceClass(card.difference)">
          <Icon :name="differenceIcon(card.difference)" class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span class="tabular-nums">{{ formatSignedValue(card.difference, card.type) }}</span>
          <span v-if="card.percentage !== null" class="text-xs font-normal opacity-80">({{ card.percentage }})</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { FinanceAnalysisSummary } from '~/types/financeAnalysis'

type ComparisonValueType = 'currency' | 'count'

const props = defineProps<{
  summary: FinanceAnalysisSummary
  comparison: FinanceAnalysisSummary
}>()

const { t, locale } = useI18n()
const { formatCurrency, formatDate } = useLocaleFormatters()

function formatValue(value: number, type: ComparisonValueType) {
  return type === 'currency' ? formatCurrency(value) : new Intl.NumberFormat(locale.value).format(value)
}

function formatSignedValue(value: number, type: ComparisonValueType) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatValue(Math.abs(value), type)}`
}

function differenceClass(value: number) {
  if (value > 0) return 'text-success-700'
  if (value < 0) return 'text-danger-700'
  return 'text-base-600'
}

function differenceIcon(value: number) {
  if (value > 0) return 'material-symbols:trending-up-rounded'
  if (value < 0) return 'material-symbols:trending-down-rounded'
  return 'material-symbols:trending-flat-rounded'
}

/** A relative change is only meaningful against a non-zero previous value. */
function percentageOf(current: number, previous: number) {
  if (!previous) return null
  const change = ((current - previous) / Math.abs(previous)) * 100
  return `${change > 0 ? '+' : ''}${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(change)}%`
}

function entriesReviewed(summary: FinanceAnalysisSummary) {
  return summary.receipt_count + summary.cash_count_count + summary.invoice_count
}

const cards = computed(() => {
  const definitions: Array<{ key: string, label: string, type: ComparisonValueType, current: number, previous: number }> = [
    {
      key: 'receiptTotal',
      label: t('financeAnalysis.cards.receiptTotal'),
      type: 'currency',
      current: props.summary.receipt_total,
      previous: props.comparison.receipt_total,
    },
    {
      key: 'cashCountRevenue',
      label: t('financeAnalysis.cards.eventRevenue'),
      type: 'currency',
      current: props.summary.cash_count_total_difference,
      previous: props.comparison.cash_count_total_difference,
    },
    {
      key: 'invoiceRevenue',
      label: t('financeAnalysis.cards.invoiceRevenue'),
      type: 'currency',
      current: props.summary.invoice_total,
      previous: props.comparison.invoice_total,
    },
    {
      key: 'netResult',
      label: t('financeAnalysis.cards.netResult'),
      type: 'currency',
      current: props.summary.net_result,
      previous: props.comparison.net_result,
    },
    {
      key: 'entriesReviewed',
      label: t('financeAnalysis.cards.entriesReviewed'),
      type: 'count',
      current: entriesReviewed(props.summary),
      previous: entriesReviewed(props.comparison),
    },
  ]

  return definitions.map(definition => ({
    ...definition,
    difference: definition.type === 'currency'
      ? Number((definition.current - definition.previous).toFixed(2))
      : definition.current - definition.previous,
    percentage: percentageOf(definition.current, definition.previous),
  }))
})
</script>
