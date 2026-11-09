<template>
  <div class="space-y-2">
    <p class="text-2xl font-semibold text-base-900">{{ formatCurrency(data.totalMoney) }}</p>
    <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      <div v-if="data.bankEnabled">
        <dt class="text-xs uppercase tracking-wide text-base-400">{{ t('wiki.embeds.cashPositionBank') }}</dt>
        <dd class="text-base-800">{{ formatCurrency(data.bankBalance) }}</dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-base-400">{{ t('wiki.embeds.cashPositionCash') }}</dt>
        <dd class="text-base-800">{{ formatCurrency(data.cashTotal) }}</dd>
      </div>
    </dl>
    <p class="text-xs text-base-500">{{ t('wiki.embeds.asOf', { date: formatDate(data.date) }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { WikiEmbedCashPositionData } from '~/types/wiki'

defineProps<{ data: WikiEmbedCashPositionData }>()

const { t } = useI18n()
const { formatCurrency, formatDate } = useLocaleFormatters()
</script>
