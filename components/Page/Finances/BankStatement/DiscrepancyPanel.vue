<template>
  <section
    v-if="items.length || orphanedBookings.length"
    class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3"
  >
    <div class="space-y-1">
      <h2 class="text-lg font-semibold">{{ t('bankStatement.discrepancies.title') }}</h2>
      <p class="text-sm text-base-600">{{ t('bankStatement.discrepancies.description') }}</p>
      <p class="text-xs text-base-500">{{ t('cashCount.discrepancies.savedStateHint') }}</p>
    </div>

    <div
      v-for="item in items"
      :key="item.key"
      class="rounded-xl border p-3 space-y-2"
      :class="item.status === 'confirmed' ? 'border-base-200 bg-base-50' : 'border-warning-200 bg-warning-50'"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <span class="font-semibold">{{ cashDiscrepancySourceLabel(item, t) }}</span>
          <span class="font-semibold tabular-nums" :class="item.amount > 0 ? 'text-success-700' : 'text-danger-700'">
            {{ formatSigned(item.amount) }}
          </span>
          <CommonStatusBadge :label="cashDiscrepancyStatusLabel(item, t)" :tone="item.status === 'confirmed' ? 'success' : 'warning'" />
        </div>

        <div v-if="canEdit" class="flex flex-wrap gap-3 text-sm">
          <button type="button" class="text-link-600 hover:underline cursor-pointer" :disabled="busy" @click="openConfirm(item)">
            {{ item.status === 'unconfirmed'
              ? t('cashCount.discrepancies.confirm')
              : item.status === 'stale' ? t('cashCount.discrepancies.reconfirm') : t('cashCount.discrepancies.edit') }}
          </button>
          <button
            v-if="item.status !== 'unconfirmed'"
            type="button"
            class="text-danger-500 hover:underline cursor-pointer"
            :disabled="busy"
            @click="revoke(item.bank!.bank_statement_position_id)"
          >
            {{ t('cashCount.discrepancies.revoke') }}
          </button>
        </div>
      </div>

      <p class="text-sm text-base-700 tabular-nums">
        {{ t('bankStatement.discrepancies.amounts', {
          expected: formatCurrency(item.expected_amount),
          confirmed: formatCurrency(item.measured_amount),
        }) }}
      </p>
      <p class="text-sm text-base-700">{{ cashDiscrepancyAssignmentLabel(item, t) }}</p>
      <p v-if="item.status === 'stale' && item.booked_amount !== null" class="text-sm text-warning-900">
        {{ t('cashCount.discrepancies.staleHint', { amount: formatSigned(item.booked_amount) }) }}
      </p>
      <p v-if="item.confirmed_at" class="text-xs text-base-500">
        {{ t('cashCount.discrepancies.confirmedBy', {
          user: item.confirmed_by_name || t('common.notAvailable'),
          date: formatDateTime(item.confirmed_at),
        }) }}
        <template v-if="item.notes"> · {{ item.notes }}</template>
      </p>
    </div>

    <div
      v-for="booking in orphanedBookings"
      :key="booking.id"
      class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-base-200 bg-base-50 p-3 text-sm"
    >
      <span>{{ t('bankStatement.discrepancies.orphanedText', { amount: formatSigned(booking.amount) }) }}</span>
      <button
        v-if="canEdit"
        type="button"
        class="text-danger-500 hover:underline cursor-pointer"
        :disabled="busy"
        @click="revoke(booking.bank_statement_position_id)"
      >
        {{ t('cashCount.discrepancies.remove') }}
      </button>
    </div>

    <PageFinancesDiscrepancyConfirmModal
      v-model="modalOpen"
      :item="confirming"
      :busy="busy"
      @save="saveConfirm"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import {
  cashDiscrepancyAssignmentLabel,
  cashDiscrepancySourceLabel,
  cashDiscrepancyStatusLabel,
} from '~/shared/cashDiscrepancyLabels'
import type { GetBankStatementDiscrepanciesResponse } from '~/server/api/bank_statements/[id]/discrepancies.get'
import type { BankDiscrepancyBookingRow } from '~/server/utils/financeAnalysis/bankDiscrepancies'
import type { SaveCashDiscrepancyBookingBody } from '~/types/cashCount'
import type { FinanceAnalysisCashDiscrepancyItem } from '~/types/financeAnalysis'

/**
 * Bank differences of a saved statement: transfers or reimbursements it confirmed with another amount
 * than expected. Confirmed like cash differences; changing a confirmation needs the unlock (SEC-22).
 */
const props = defineProps<{
  bankStatementId: number
  canEdit: boolean
  /** The user unlocked the statement in the editor. */
  unlock?: boolean
}>()

const { t } = useI18n()
const toast = useToast()
const { formatCurrency, formatDateTime } = useLocaleFormatters()

const items = ref<FinanceAnalysisCashDiscrepancyItem[]>([])
const orphanedBookings = ref<BankDiscrepancyBookingRow[]>([])
const busy = ref(false)
const modalOpen = ref(false)
const confirming = ref<FinanceAnalysisCashDiscrepancyItem | null>(null)

function formatSigned(value: number) {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

function applyView(res: GetBankStatementDiscrepanciesResponse) {
  if (!res.ok) {
    toast.error(res.error || t('cashCount.discrepancies.failed'))
    return false
  }
  items.value = res.items
  orphanedBookings.value = res.orphanedBookings
  return true
}

async function load() {
  try {
    applyView(await apiFetch<GetBankStatementDiscrepanciesResponse>(`/api/bank_statements/${props.bankStatementId}/discrepancies`, { method: 'GET' }))
  } catch {
    toast.error(t('cashCount.discrepancies.loadFailed'))
  }
}

function openConfirm(item: FinanceAnalysisCashDiscrepancyItem) {
  confirming.value = item
  modalOpen.value = true
}

async function saveConfirm(body: SaveCashDiscrepancyBookingBody) {
  const positionId = confirming.value?.bank?.bank_statement_position_id
  if (!positionId) return
  busy.value = true
  try {
    const res = await apiFetch<GetBankStatementDiscrepanciesResponse>(`/api/bank_statements/${props.bankStatementId}/discrepancies`, {
      method: 'POST',
      body: { ...body, position_id: positionId, ...(props.unlock ? { unlock: true } : {}) },
    })
    if (applyView(res)) {
      toast.success(t('cashCount.discrepancies.saved'))
      modalOpen.value = false
    }
  } catch {
    toast.error(t('cashCount.discrepancies.failed'))
  } finally {
    busy.value = false
  }
}

async function revoke(positionId: number) {
  busy.value = true
  try {
    const res = await apiFetch<GetBankStatementDiscrepanciesResponse>(`/api/bank_statements/${props.bankStatementId}/discrepancies`, {
      method: 'DELETE',
      query: { position_id: positionId, ...(props.unlock ? { unlock: 'true' } : {}) },
    })
    if (applyView(res)) toast.success(t('cashCount.discrepancies.revoked'))
  } catch {
    toast.error(t('cashCount.discrepancies.failed'))
  } finally {
    busy.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>
