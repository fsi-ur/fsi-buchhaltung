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

    <CommonModal
      v-if="item"
      v-model="modalOpen"
      :title="t('cashCount.discrepancies.modalTitle')"
      width-class="max-w-xl"
      @close="closeConfirm"
    >
      <p class="text-sm text-base-600">
        {{ t('cashCount.discrepancies.modalIntro', { amount: formatSigned(item.amount) }) }}
      </p>

      <div class="field">
        <label>{{ t('cashCount.discrepancies.assignmentLabel') }}</label>
        <label class="flex cursor-pointer items-start gap-3 text-sm">
          <input v-model="assignmentMode" type="radio" value="automatic" class="mt-0.5 h-4 w-4 shrink-0">
          <span>{{ automaticLabel }}</span>
        </label>
        <label class="flex cursor-pointer items-start gap-3 text-sm">
          <input v-model="assignmentMode" type="radio" value="manual" class="mt-0.5 h-4 w-4 shrink-0">
          <span>{{ t('cashCount.discrepancies.assignmentManual') }}</span>
        </label>
      </div>

      <div v-if="assignmentMode === 'manual'" class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div class="field">
          <label>{{ t('settings.cashDiscrepancyDefaults.sphere') }}</label>
          <CommonSearchSelect
            v-model="sphereQuery"
            :options="sphereOptions"
            :selected-label="selectedSphereLabel"
            :placeholder="t('settings.cashDiscrepancyDefaults.spherePlaceholder')"
            :empty-text="t('common.noResults')"
            @select="sphereId = Number($event)"
            @clear-selection="sphereId = null"
          />
        </div>
        <div class="field">
          <label>{{ t('settings.cashDiscrepancyDefaults.costCentre') }}</label>
          <CommonSearchSelect
            v-model="costCentreQuery"
            :options="costCentreOptions"
            :selected-label="selectedCostCentreLabel"
            :placeholder="t('settings.cashDiscrepancyDefaults.costCentrePlaceholder')"
            :empty-text="t('common.noResults')"
            @select="costCentreId = Number($event)"
            @clear-selection="costCentreId = null"
          />
        </div>
      </div>

      <div class="field">
        <label>{{ t('cashCount.discrepancies.notes') }}</label>
        <textarea v-model="notes" class="input min-h-20" :placeholder="t('cashCount.discrepancies.notesPlaceholder')" />
      </div>

      <template #footer>
        <button class="btn-secondary" :disabled="busy" @click="closeConfirm">
          {{ t('actions.cancel') }}
        </button>
        <button class="btn-primary" :disabled="busy" @click="saveConfirm">
          {{ busy ? t('actions.saving') : t('cashCount.discrepancies.confirm') }}
        </button>
      </template>
    </CommonModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import type { GetCashCountDiscrepanciesResponse } from '~/server/api/cash_counts/[id]/discrepancies.get'
import {
  cashDiscrepancyAssignmentLabel,
  cashDiscrepancyStatusLabel,
  formatCostCentreSplitTarget,
} from '~/shared/cashDiscrepancyLabels'
import type { CashDiscrepancyBookingRow, SaveCashDiscrepancyBookingBody } from '~/types/cashCount'
import type { CostCentreRow } from '~/types/costCentre'
import type { FinanceAnalysisCashDiscrepancyItem, FinanceAnalysisCashDiscrepancyRegister } from '~/types/financeAnalysis'
import type { SphereRow } from '~/types/sphere'

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
}>()

const { t } = useI18n()
const toast = useToast()
const { formatCurrency, formatDateTime } = useLocaleFormatters()

const registers = ref<FinanceAnalysisCashDiscrepancyRegister[]>([])
const item = ref<FinanceAnalysisCashDiscrepancyItem | null>(null)
const orphanedBooking = ref<CashDiscrepancyBookingRow | null>(null)
const busy = ref(false)

const modalOpen = ref(false)
const assignmentMode = ref<'automatic' | 'manual'>('automatic')
const sphereId = ref<number | null>(null)
const costCentreId = ref<number | null>(null)
const sphereQuery = ref('')
const costCentreQuery = ref('')
const notes = ref('')
const spheres = ref<SphereRow[]>([])
const costCentres = ref<CostCentreRow[]>([])

function formatSigned(value: number) {
  return `${value > 0 ? '+' : ''}${formatCurrency(value)}`
}

const label = (row: { code: string, name: string } | undefined) => (row ? [row.code, row.name].filter(Boolean).join(' - ') : '')
const sphereOptions = computed<SearchSelectOption[]>(() => spheres.value
  .filter(sphere => sphere.is_active)
  .map(sphere => ({ key: sphere.id, label: label(sphere), value: sphere.id })))
const costCentreOptions = computed<SearchSelectOption[]>(() => costCentres.value
  .filter(costCentre => costCentre.is_active)
  .map(costCentre => ({ key: costCentre.id, label: label(costCentre), value: costCentre.id })))
const selectedSphereLabel = computed(() => label(spheres.value.find(sphere => sphere.id === sphereId.value)))
const selectedCostCentreLabel = computed(() => label(costCentres.value.find(costCentre => costCentre.id === costCentreId.value)))

// Once overridden, the item no longer carries its automatic target — describe the rule instead.
const automaticLabel = computed(() => {
  const current = item.value
  if (!current || current.assignment === 'booking') return t('cashCount.discrepancies.assignmentAutomaticGeneric')
  if (current.assignment === 'none') return t('cashCount.discrepancies.assignmentAutomatic', { target: t('cashCount.discrepancies.assignment.none') })
  return t('cashCount.discrepancies.assignmentAutomatic', { target: formatCostCentreSplitTarget(current.cost_centres) })
})

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

async function loadOptions() {
  if (spheres.value.length && costCentres.value.length) return
  const [spheresRes, costCentresRes] = await Promise.all([
    apiFetch<{ ok: boolean, spheres?: SphereRow[] }>('/api/spheres', { method: 'GET' }),
    apiFetch<{ ok: boolean, costCentres?: CostCentreRow[] }>('/api/cost_centres', { method: 'GET' }),
  ])
  if (spheresRes.ok) spheres.value = spheresRes.spheres ?? []
  if (costCentresRes.ok) costCentres.value = costCentresRes.costCentres ?? []
}

async function openConfirm() {
  const current = item.value
  if (!current) return
  const override = current.assignment === 'booking' ? current.cost_centres[0] ?? null : null
  assignmentMode.value = override ? 'manual' : 'automatic'
  sphereId.value = override?.sphere_id ?? null
  costCentreId.value = override?.cost_centre_id ?? null
  notes.value = current.notes ?? ''
  modalOpen.value = true
  try {
    await loadOptions()
  } catch {
    // The automatic assignment still works without the lists.
  }
  sphereQuery.value = selectedSphereLabel.value
  costCentreQuery.value = selectedCostCentreLabel.value
}

function closeConfirm() {
  modalOpen.value = false
}

async function saveConfirm() {
  const manual = assignmentMode.value === 'manual'
  if (manual && (!sphereId.value || !costCentreId.value)) {
    toast.error(t('settings.cashDiscrepancyDefaults.pairRequired'))
    return
  }

  const body: SaveCashDiscrepancyBookingBody = {
    sphere_id: manual ? sphereId.value : null,
    cost_centre_id: manual ? costCentreId.value : null,
    notes: notes.value.trim() || null,
  }

  busy.value = true
  try {
    const res = await apiFetch<DiscrepancyViewResponse>(`/api/cash_counts/${props.cashCountId}/discrepancies`, { method: 'POST', body })
    if (applyView(res)) {
      toast.success(t('cashCount.discrepancies.saved'))
      closeConfirm()
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
    const res = await apiFetch<DiscrepancyViewResponse>(`/api/cash_counts/${props.cashCountId}/discrepancies`, { method: 'DELETE' })
    if (applyView(res)) toast.success(t('cashCount.discrepancies.revoked'))
  } catch {
    toast.error(t('cashCount.discrepancies.failed'))
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>
