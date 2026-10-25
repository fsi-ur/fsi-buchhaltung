<template>
  <details class="group rounded-xl border border-base-200 bg-white" :open="differs">
    <summary class="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
      <Icon
        name="material-symbols:info-outline-rounded"
        class="h-5 w-5 shrink-0 text-info-600"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 font-medium text-base-800">
        {{ differs
          ? t('financeAnalysis.reconciliation.summaryDiffers', { amount: formatSigned(gap) })
          : t('financeAnalysis.reconciliation.summaryMatches') }}
      </span>
      <Icon
        name="material-symbols:expand-more-rounded"
        class="h-5 w-5 shrink-0 text-base-500 transition-transform group-open:rotate-180"
        aria-hidden="true"
      />
    </summary>

    <div class="space-y-3 border-t border-base-200 px-4 py-3">
      <p class="text-sm text-base-600">{{ t('financeAnalysis.reconciliation.intro') }}</p>

      <dl class="divide-y divide-base-100 text-sm">
        <div class="flex items-baseline justify-between gap-4 py-2 font-semibold">
          <dt>{{ t('financeAnalysis.reconciliation.netResult') }}</dt>
          <dd class="tabular-nums">{{ formatCurrency(reconciliation.net_result) }}</dd>
        </div>

        <div v-for="line in lines" :key="line.key" class="flex items-baseline justify-between gap-4 py-2">
          <dt class="min-w-0">
            <div class="text-base-800">{{ line.label }}</div>
            <div class="text-xs text-base-500">{{ line.hint }}</div>
          </dt>
          <dd class="shrink-0 tabular-nums" :class="line.value < 0 ? 'text-danger-700' : 'text-success-700'">
            {{ formatSigned(line.value) }}
          </dd>
        </div>

        <div class="flex items-baseline justify-between gap-4 py-2 font-semibold">
          <dt>{{ t('financeAnalysis.reconciliation.moneyChange') }}</dt>
          <dd class="tabular-nums">{{ formatSigned(reconciliation.money_change) }}</dd>
        </div>
      </dl>

      <p v-if="reconciliation.has_cost_centre_filter" class="text-xs text-base-500">
        {{ t('financeAnalysis.reconciliation.filteredNote') }}
      </p>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { FinanceAnalysisReconciliation } from '~/types/financeAnalysis'

const props = defineProps<{
  reconciliation: FinanceAnalysisReconciliation
}>()

const { t } = useI18n()
const { formatCurrency } = useLocaleFormatters()

function formatSigned(value: number) {
  const rounded = Number(value.toFixed(2))
  return `${rounded > 0 ? '+' : ''}${formatCurrency(rounded)}`
}

const gap = computed(() => Number((props.reconciliation.money_change - props.reconciliation.net_result).toFixed(2)))
const differs = computed(() => gap.value !== 0)

// Only the lines that actually contribute — a bridge of zeros explains nothing.
const lines = computed(() => ([
  { key: 'receiptTiming', value: props.reconciliation.receipt_timing },
  { key: 'invoiceTiming', value: props.reconciliation.invoice_timing },
  { key: 'eventDifference', value: props.reconciliation.event_difference },
  { key: 'discrepancyDifference', value: props.reconciliation.discrepancy_difference },
  { key: 'other', value: props.reconciliation.other },
])
  .filter(line => line.value !== 0)
  .map(line => ({
    ...line,
    label: t(`financeAnalysis.reconciliation.${line.key}`),
    hint: t(`financeAnalysis.reconciliation.${line.key}Hint`),
  })))
</script>
