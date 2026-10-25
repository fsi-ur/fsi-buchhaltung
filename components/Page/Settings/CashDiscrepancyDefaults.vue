<template>
  <CommonCard
    :title="t('settings.cashDiscrepancyDefaults.title')"
    :description="t('settings.cashDiscrepancyDefaults.text')"
  >
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div class="field">
        <label>{{ t('settings.cashDiscrepancyDefaults.sphere') }}</label>
        <CommonSearchSelect
          v-model="sphereQuery"
          :options="sphereOptions"
          :selected-label="selectedSphereLabel"
          :placeholder="t('settings.cashDiscrepancyDefaults.spherePlaceholder')"
          :empty-text="t('common.noResults')"
          :disabled="loading || saving"
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
          :disabled="loading || saving"
          @select="costCentreId = Number($event)"
          @clear-selection="costCentreId = null"
        />
      </div>
    </div>

    <p v-if="!savedSphereId || !savedCostCentreId" class="text-xs text-base-500">
      {{ t('settings.cashDiscrepancyDefaults.noneHint') }}
    </p>

    <div class="flex justify-end">
      <button
        class="btn-primary"
        :disabled="loading || saving || !changed"
        :class="{ 'opacity-50 cursor-not-allowed': loading || saving || !changed }"
        @click="save"
      >
        {{ saving ? t('actions.saving') : t('actions.save') }}
      </button>
    </div>
  </CommonCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { GetCashDiscrepancyDefaultsResponse } from '~/server/api/settings/cash-discrepancy-defaults.get'
import type { SaveCashDiscrepancyDefaultsResponse } from '~/server/api/settings/cash-discrepancy-defaults.save.post'
import type { CostCentreRow } from '~/types/costCentre'
import type { SphereRow } from '~/types/sphere'

const { t } = useI18n()
const toast = useToast()

const loading = ref(true)
const saving = ref(false)
const spheres = ref<SphereRow[]>([])
const costCentres = ref<CostCentreRow[]>([])
const sphereId = ref<number | null>(null)
const costCentreId = ref<number | null>(null)
const savedSphereId = ref<number | null>(null)
const savedCostCentreId = ref<number | null>(null)
const sphereQuery = ref('')
const costCentreQuery = ref('')

const label = (row: { code: string, name: string } | undefined) => (row ? [row.code, row.name].filter(Boolean).join(' - ') : '')

// A deactivated entry that is still the saved default stays selectable so the field never shows blank.
const sphereOptions = computed<SearchSelectOption[]>(() => spheres.value
  .filter(sphere => sphere.is_active || sphere.id === savedSphereId.value)
  .map(sphere => ({ key: sphere.id, label: label(sphere), value: sphere.id })))
const costCentreOptions = computed<SearchSelectOption[]>(() => costCentres.value
  .filter(costCentre => costCentre.is_active || costCentre.id === savedCostCentreId.value)
  .map(costCentre => ({ key: costCentre.id, label: label(costCentre), value: costCentre.id })))

const selectedSphereLabel = computed(() => label(spheres.value.find(sphere => sphere.id === sphereId.value)))
const selectedCostCentreLabel = computed(() => label(costCentres.value.find(costCentre => costCentre.id === costCentreId.value)))
const changed = computed(() => sphereId.value !== savedSphereId.value || costCentreId.value !== savedCostCentreId.value)

onMounted(async () => {
  try {
    const [defaultsRes, spheresRes, costCentresRes] = await Promise.all([
      apiFetch<GetCashDiscrepancyDefaultsResponse>('/api/settings/cash-discrepancy-defaults', { method: 'GET' }),
      apiFetch<{ ok: boolean, spheres?: SphereRow[] }>('/api/spheres', { method: 'GET' }),
      apiFetch<{ ok: boolean, costCentres?: CostCentreRow[] }>('/api/cost_centres', { method: 'GET' }),
    ])
    if (spheresRes.ok) spheres.value = spheresRes.spheres ?? []
    if (costCentresRes.ok) costCentres.value = costCentresRes.costCentres ?? []
    if (!defaultsRes.ok) {
      toast.error(defaultsRes.error || t('settings.cashDiscrepancyDefaults.loadFailed'))
      return
    }
    sphereId.value = savedSphereId.value = defaultsRes.defaults.sphere_id
    costCentreId.value = savedCostCentreId.value = defaultsRes.defaults.cost_centre_id
    sphereQuery.value = selectedSphereLabel.value
    costCentreQuery.value = selectedCostCentreLabel.value
  } catch {
    toast.error(t('settings.cashDiscrepancyDefaults.loadFailed'))
  } finally {
    loading.value = false
  }
})

async function save() {
  if (Boolean(sphereId.value) !== Boolean(costCentreId.value)) {
    toast.error(t('settings.cashDiscrepancyDefaults.pairRequired'))
    return
  }

  saving.value = true
  try {
    const res = await apiFetch<SaveCashDiscrepancyDefaultsResponse>('/api/settings/cash-discrepancy-defaults.save', {
      method: 'POST',
      body: { sphere_id: sphereId.value, cost_centre_id: costCentreId.value },
    })
    if (!res.ok) {
      toast.error(res.error || t('settings.cashDiscrepancyDefaults.saveFailed'))
      return
    }
    savedSphereId.value = res.defaults.sphere_id
    savedCostCentreId.value = res.defaults.cost_centre_id
    toast.success(t('settings.cashDiscrepancyDefaults.saved'))
  } catch {
    toast.error(t('settings.cashDiscrepancyDefaults.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>
