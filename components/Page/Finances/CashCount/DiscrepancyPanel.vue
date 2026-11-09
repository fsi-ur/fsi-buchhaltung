<template>
  <div v-if="registers.length || orphanedBooking">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold">{{ t('cashCount.discrepancies.title') }}</h2>
        <p class="text-sm text-base-600">{{ t('cashCount.discrepancies.description') }}</p>
        <p class="text-xs text-base-500">{{ t('cashCount.discrepancies.savedStateHint') }}</p>
      </div>

      <div v-if="registers.length" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-base-500">
              <th class="py-1 pr-3 font-medium">{{ t('cashCount.register') }}</th>
              <th class="py-1 px-3 text-right font-medium">{{ t('cashCount.discrepancies.expected') }}</th>
              <th class="py-1 px-3 text-right font-medium">{{ t('cashCount.discrepancies.measured') }}</th>
              <th class="py-1 pl-3 text-right font-medium">{{ t('cashCount.discrepancies.difference') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-base-100">
            <tr v-for="register in registers" :key="register.register_number">
              <td class="py-1.5 pr-3">{{ t('cashCount.discrepancies.register', { number: register.register_number }) }}</td>
              <td class="py-1.5 px-3 text-right tabular-nums">{{ formatCurrency(register.expected_amount) }}</td>
              <td class="py-1.5 px-3 text-right tabular-nums">{{ formatCurrency(register.measured_amount) }}</td>
              <td class="py-1.5 pl-3 text-right tabular-nums" :class="register.amount > 0 ? 'text-success-700' : 'text-danger-700'">
                {{ formatSigned(register.amount) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="item"
        class="rounded-xl border p-3 space-y-2"
        :class="item.status === 'confirmed' ? 'border-base-200 bg-base-50' : 'border-warning-200 bg-warning-50'"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold">
              {{ item.amount > 0 ? t('cashCount.discrepancies.netSurplus') : t('cashCount.discrepancies.netShortfall') }}
            </span>
            <span class="font-semibold tabular-nums" :class="item.amount > 0 ? 'text-success-700' : 'text-danger-700'">
              {{ formatSigned(item.amount) }}
            </span>
            <CommonStatusBadge :label="cashDiscrepancyStatusLabel(item, t)" :tone="item.status === 'confirmed' ? 'success' : 'warning'" />
          </div>

          <div v-if="canEdit" class="flex flex-wrap gap-3 text-sm">
            <button type="button" class="text-link-600 hover:underline cursor-pointer" :disabled="busy" @click="openConfirm">
              {{ item.status === 'unconfirmed'
                ? t('cashCount.discrepancies.confirm')
                : item.status === 'stale' ? t('cashCount.discrepancies.reconfirm') : t('cashCount.discrepancies.edit') }}
            </button>
            <button
              v-if="item.status !== 'unconfirmed'"
              type="button"
              class="text-danger-500 hover:underline cursor-pointer"
              :disabled="busy"
              @click="revoke"
            >
              {{ t('cashCount.discrepancies.revoke') }}
            </button>
          </div>
        </div>

        <p v-if="registers.length > 1" class="text-xs text-base-500">{{ t('cashCount.discrepancies.nettedHint') }}</p>
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

      <p v-else-if="registers.length" class="rounded-xl border border-base-200 bg-base-50 p-3 text-sm text-base-700">
        {{ t('cashCount.discrepancies.balanced') }}
      </p>

      <div
        v-if="orphanedBooking"
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-base-200 bg-base-50 p-3 text-sm"
      >
        <span>{{ t('cashCount.discrepancies.orphanedText', { amount: formatSigned(orphanedBooking.amount) }) }}</span>
        <button
          v-if="canEdit"
          type="button"
          class="text-danger-500 hover:underline cursor-pointer"
          :disabled="busy"
          @click="revoke"
        >
          {{ t('cashCount.discrepancies.remove') }}
        </button>
      </div>
    </section>

    <PageFinancesDiscrepancyConfirmModal
      v-model="modalOpen"
      :item="item"
      :busy="busy"
      @save="saveConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import type { GetCashCountDiscrepanciesResponse } from '~/server/api/cash_counts/[id]/discrepancies.get'
import {
  cashDiscrepancyAssignmentLabel,
  cashDiscrepancyStatusLabel,
} from '~/shared/cashDiscrepancyLabels'
import type { CashDiscrepancyBookingRow, SaveCashDiscrepancyBookingBody } from '~/types/cashCount'
import type { FinanceAnalysisCashDiscrepancyItem, FinanceAnalysisCashDiscrepancyRegister } from '~/types/financeAnalysis'

type DiscrepancyViewResponse =
  | {
    ok: true
    registers: FinanceAnalysisCashDiscrepancyRegister[]
    item: FinanceAnalysisCashDiscrepancyItem | null
    orphanedBooking: CashDiscrepancyBookingRow | null
  }
  | { ok: false, error: string }

const props = defineProps<{
  cashCountId: number
  canEdit: boolean
  /** The count is confirmed (locked) and the user has unlocked it in the editor (SEC-22). */
  unlock?: boolean
}>()

const emit = defineEmits<{
  /** A confirmation was saved (true — the count is booked) or withdrawn (false). */
  (e: 'lockedChange', locked: boolean): void
}>()

const { t } = useI18n()
const toast = useToast()
const { formatCurrency, formatDateTime } = useLocaleFormatters()

const registers = ref<FinanceAnalysisCashDiscrepancyRegister[]>([])
const item = ref<FinanceAnalysisCashDiscrepancyItem | null>(null)
const orphanedBooking = ref<CashDiscrepancyBookingRow | null>(null)
const busy = ref(false)

const modalOpen = ref(false)

function formatSigned(value: number) {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

function applyView(res: DiscrepancyViewResponse) {
  if (!res.ok) {
    toast.error(res.error || t('cashCount.discrepancies.failed'))
    return false
  }
  registers.value = res.registers
  item.value = res.item
  orphanedBooking.value = res.orphanedBooking
  return true
}

async function load() {
  try {
    applyView(await apiFetch<GetCashCountDiscrepanciesResponse>(`/api/cash_counts/${props.cashCountId}/discrepancies`, { method: 'GET' }))
  } catch {
    toast.error(t('cashCount.discrepancies.loadFailed'))
  }
}

function openConfirm() {
  if (item.value) modalOpen.value = true
}

function closeConfirm() {
  modalOpen.value = false
}

async function saveConfirm(body: SaveCashDiscrepancyBookingBody) {
  busy.value = true
  try {
    const res = await apiFetch<DiscrepancyViewResponse>(`/api/cash_counts/${props.cashCountId}/discrepancies`, {
      method: 'POST',
      body: { ...body, ...(props.unlock ? { unlock: true } : {}) },
    })
    if (applyView(res)) {
      toast.success(t('cashCount.discrepancies.saved'))
      closeConfirm()
      emit('lockedChange', true)
    }
  } catch {
    toast.error(t('cashCount.discrepancies.failed'))
  } finally {
    busy.value = false
  }
}

async function revoke() {
  busy.value = true
  try {
    const res = await apiFetch<DiscrepancyViewResponse>(`/api/cash_counts/${props.cashCountId}/discrepancies`, {
      method: 'DELETE',
      query: props.unlock ? { unlock: 'true' } : undefined,
    })
    if (applyView(res)) {
      toast.success(t('cashCount.discrepancies.revoked'))
      emit('lockedChange', false)
    }
  } catch {
    toast.error(t('cashCount.discrepancies.failed'))
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>
