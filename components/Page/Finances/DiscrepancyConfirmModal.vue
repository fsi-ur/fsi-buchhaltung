<template>
  <CommonModal
    v-if="item"
    :model-value="modelValue"
    :title="t('cashCount.discrepancies.modalTitle')"
    width-class="max-w-xl"
    @update:model-value="$emit('update:modelValue', $event)"
    @close="close"
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
      <button class="btn-secondary" :disabled="busy" @click="close">
        {{ t('actions.cancel') }}
      </button>
      <button class="btn-primary" :disabled="busy" @click="save">
        {{ busy ? t('actions.saving') : t('cashCount.discrepancies.confirm') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import { formatCostCentreSplitTarget } from '~/shared/cashDiscrepancyLabels'
import type { SaveCashDiscrepancyBookingBody } from '~/types/cashCount'
import type { CostCentreRow } from '~/types/costCentre'
import type { FinanceAnalysisCashDiscrepancyItem } from '~/types/financeAnalysis'
import type { SphereRow } from '~/types/sphere'

/**
 * Confirms a cash or bank difference: keep the automatic assignment or move it to another sphere /
 * cost centre, with a note. The parent saves; this only collects the decision.
 */
const props = defineProps<{
  modelValue: boolean
  item: FinanceAnalysisCashDiscrepancyItem | null
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'save', body: SaveCashDiscrepancyBookingBody): void
}>()

const { t } = useI18n()
const toast = useToast()
const { formatCurrency } = useLocaleFormatters()

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
  const current = props.item
  if (!current || current.assignment === 'booking') return t('cashCount.discrepancies.assignmentAutomaticGeneric')
  if (current.assignment === 'none') return t('cashCount.discrepancies.assignmentAutomatic', { target: t('cashCount.discrepancies.assignment.none') })
  return t('cashCount.discrepancies.assignmentAutomatic', { target: formatCostCentreSplitTarget(current.cost_centres) })
})

async function loadOptions() {
  if (spheres.value.length && costCentres.value.length) return
  const [spheresRes, costCentresRes] = await Promise.all([
    apiFetch<{ ok: boolean, spheres?: SphereRow[] }>('/api/spheres', { method: 'GET' }),
    apiFetch<{ ok: boolean, costCentres?: CostCentreRow[] }>('/api/cost_centres', { method: 'GET' }),
  ])
  if (spheresRes.ok) spheres.value = spheresRes.spheres ?? []
  if (costCentresRes.ok) costCentres.value = costCentresRes.costCentres ?? []
}

// Start from the item's current state each time the dialog opens.
watch(() => props.modelValue, async (open) => {
  const current = props.item
  if (!open || !current) return
  const override = current.assignment === 'booking' ? current.cost_centres[0] ?? null : null
  assignmentMode.value = override ? 'manual' : 'automatic'
  sphereId.value = override?.sphere_id ?? null
  costCentreId.value = override?.cost_centre_id ?? null
  notes.value = current.notes ?? ''
  try {
    await loadOptions()
  } catch {
    // The automatic assignment still works without the lists.
  }
  sphereQuery.value = selectedSphereLabel.value
  costCentreQuery.value = selectedCostCentreLabel.value
}, { immediate: true })

function close() {
  emit('update:modelValue', false)
}

function save() {
  const manual = assignmentMode.value === 'manual'
  if (manual && (!sphereId.value || !costCentreId.value)) {
    toast.error(t('settings.cashDiscrepancyDefaults.pairRequired'))
    return
  }
  emit('save', {
    sphere_id: manual ? sphereId.value : null,
    cost_centre_id: manual ? costCentreId.value : null,
    notes: notes.value.trim() || null,
  })
}
</script>
