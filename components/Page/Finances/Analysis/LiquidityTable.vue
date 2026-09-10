<template>
  <ul class="divide-y divide-base-200 overflow-hidden rounded-xl border border-base-200 bg-white">
    <li v-for="row in rows" :key="row.id" class="px-3 py-2.5" :class="rowClass(row)">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 font-medium text-base-800">
            <span
              v-if="isBoundary(row)"
              class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-base-400"
              aria-hidden="true"
            />
            <span class="min-w-0 wrap-break-word">{{ liquidityRowLabel(row, t) }}</span>
          </p>

          <p class="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-base-500">
            <span class="tabular-nums">{{ formatDate(row.date) }}</span>
            <template v-if="row.reference">
              <span class="text-base-300">·</span>
              <span class="min-w-0 truncate">{{ row.reference }}</span>
            </template>
            <template v-if="row.register_number !== null">
              <span class="text-base-300">·</span>
              <span>{{ t('financeAnalysis.liquidity.registerSuffix', { number: row.register_number }) }}</span>
            </template>
          </p>

          <p v-if="noteFor(row)" class="mt-0.5 text-xs text-base-500">{{ noteFor(row) }}</p>
        </div>

        <div class="shrink-0 text-right">
          <div class="font-medium tabular-nums" :class="amountClass(row.delta_amount)">
            {{ row.delta_amount === 0 ? '-' : formatSignedCurrency(row.delta_amount) }}
          </div>
          <div class="text-xs font-semibold text-base-700 tabular-nums">
            {{ formatCurrency(row.total_balance) }}
          </div>
        </div>
      </div>

      <div class="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-base-500 tabular-nums">
          <span>{{ t('financeAnalysis.liquidity.bank') }} {{ formatCurrency(row.bank_balance) }}</span>
          <span>{{ t('financeAnalysis.liquidity.cash') }} {{ formatCurrency(row.cash_balance) }}</span>
        </div>

        <div v-if="isCheckpoint(row)" class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="text-base-500 tabular-nums">
            {{ t('financeAnalysis.liquidity.expected') }} {{ formatCurrency(row.expected_amount ?? 0) }}
            <span class="text-base-300">·</span>
            {{ t('financeAnalysis.liquidity.measured') }} {{ formatCurrency(row.measured_amount ?? 0) }}
          </span>
          <CommonStatusBadge
            v-if="row.has_discrepancy"
            tone="warning"
            :label="`${t('financeAnalysis.liquidity.discrepancy')} ${formatSignedCurrency(row.discrepancy_amount ?? 0)}`"
          />
          <CommonStatusBadge
            v-else
            tone="success"
            :label="t('financeAnalysis.liquidity.balanceConfirmed')"
          />
        </div>
      </div>
    </li>

    <li v-if="rows.length === 0" class="px-3 py-10 text-center text-base-500">
      {{ t('financeAnalysis.liquidity.noRows') }}
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { liquidityRowLabel, liquidityRowNote } from '~/shared/financeLiquidityLabels'
import type { FinanceLiquidityRow } from '~/types/financeAnalysis'

defineProps<{
  rows: FinanceLiquidityRow[]
}>()

const { t } = useI18n()
const { formatCurrency, formatDate } = useLocaleFormatters()

function formatSignedCurrency(value: number) {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

function isBoundary(row: FinanceLiquidityRow) {
  return row.type === 'opening' || row.type === 'closing'
}

function isCheckpoint(row: FinanceLiquidityRow) {
  return row.discrepancy_amount !== null
}

function rowClass(row: FinanceLiquidityRow) {
  if (isBoundary(row)) return 'bg-base-50'
  if (row.has_discrepancy) return 'bg-warning-50'
  if (isCheckpoint(row)) return 'bg-success-50/60'
  return ''
}

function noteFor(row: FinanceLiquidityRow) {
  return liquidityRowNote(row, t)
}

function amountClass(value: number) {
  if (value > 0) return 'text-success-700'
  if (value < 0) return 'text-danger-700'
  return 'text-base-400'
}
</script>
