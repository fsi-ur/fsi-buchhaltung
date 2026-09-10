<template>
  <CommonCard class="self-start lg:col-span-4 xl:col-span-3" :title="t('financeAnalysis.menuTitle')">
    <template #header>
      <button type="button" class="btn-secondary px-3 py-1.5 text-xs" @click="filters.resetFilters()">
        {{ t('financeAnalysis.resetRange') }}
      </button>
    </template>

    <PageFinancesAnalysisFilterSection
      v-model:expanded="expanded.period"
      icon="material-symbols:date-range-outline-rounded"
      :title="t('financeAnalysis.periodFilters')"
      :hint="t('financeAnalysis.periodFiltersHint')"
      :summary="periodSummary"
    >
      <div class="grid grid-cols-2 gap-4">
        <div class="field">
          <label>{{ t('financeAnalysis.startDate') }}</label>
          <CommonDateInput
            :model-value="filters.startDate.value"
            @update:model-value="filters.setManualDate('start', $event)"
          />
        </div>

        <div class="field">
          <label>{{ t('financeAnalysis.endDate') }}</label>
          <CommonDateInput
            :model-value="filters.endDate.value"
            @update:model-value="filters.setManualDate('end', $event)"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <div class="field">
          <label>{{ t('financeAnalysis.quickYear') }}</label>
          <MenuDropdown v-model="openDropdown" id="quickYear">
            <template #trigger="{ styling }">
              <button type="button" :class="styling" class="cursor-pointer">
                <span class="truncate">{{ quickYearLabel }}</span>
                <Icon name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0 text-lg text-base-400" />
              </button>
            </template>

            <template #default="{ styling }">
              <button
                v-for="option in quickYearOptions"
                :key="option.value"
                type="button"
                :class="[styling, option.value === filters.quickYear.value ? 'font-medium text-link-600' : '']"
                @click="selectQuickYear(option.value)"
              >
                {{ option.label }}
              </button>
            </template>
          </MenuDropdown>
        </div>

        <div class="field">
          <label>{{ t('financeAnalysis.quickSemester') }}</label>
          <div class="grid grid-cols-2 gap-2 xl:grid-cols-1 2xl:grid-cols-2">
            <PageFinancesAnalysisToggleChip
              v-for="semester in semesterOptions"
              :key="semester.value"
              :selected="filters.quickSemester.value === semester.value"
              @click="filters.toggleSemesterShortcut(semester.value)"
            >
              {{ semester.label }}
            </PageFinancesAnalysisToggleChip>
          </div>
        </div>

        <div class="field sm:col-span-2 lg:col-span-1">
          <label>{{ t('financeAnalysis.quickMonth') }}</label>
          <div class="grid grid-cols-4 gap-2">
            <PageFinancesAnalysisToggleChip
              v-for="month in filters.monthOptions.value"
              :key="month.value"
              :selected="filters.quickMonth.value === month.value"
              :title="month.label"
              @click="filters.toggleMonthShortcut(month.value)"
            >
              {{ month.shortLabel }}
            </PageFinancesAnalysisToggleChip>
          </div>
        </div>

        <p class="text-xs text-base-500">{{ t('financeAnalysis.quickHint') }}</p>
      </div>
    </PageFinancesAnalysisFilterSection>

    <PageFinancesAnalysisFilterSection
      v-if="hasCostCentreAccess"
      v-model:expanded="expanded.costCentre"
      icon="material-symbols:account-tree-outline-rounded"
      :title="t('financeAnalysis.costCentre')"
      :hint="t('financeAnalysis.costCentreHint')"
      :summary="costCentreSummary"
    >
      <div class="field">
        <label>{{ t('financeAnalysis.costCentre') }}</label>
        <CommonSearchSelect
          v-model="filters.costCentreQuery.value"
          :options="costCentreOptions"
          :selected-label="filters.selectedCostCentreLabel.value"
          :placeholder="t('financeAnalysis.costCentrePlaceholder')"
          :empty-text="t('financeAnalysis.noCostCentres')"
          menu-width="wide"
          option-class="overflow-hidden text-ellipsis"
          @select="filters.selectCostCentre($event as CostCentreRow)"
          @clear-selection="filters.clearSelectedCostCentre()"
        />
        <label
          v-if="filters.selectedCostCentreHasChildren.value"
          class="mt-3 flex w-fit cursor-pointer items-center gap-2 text-sm text-base-700"
        >
          <input v-model="filters.includeChildCostCentres.value" type="checkbox" class="checkbox">
          <span>{{ t('financeAnalysis.includeChildCostCentres') }}</span>
        </label>
      </div>
    </PageFinancesAnalysisFilterSection>

    <PageFinancesAnalysisFilterSection
      v-model:expanded="expanded.receipt"
      icon="material-symbols:receipt-long-outline-rounded"
      :title="t('financeAnalysis.receiptStateFilters')"
      :hint="t('financeAnalysis.receiptStateHint')"
      :summary="receiptSummary"
    >
      <div class="field">
        <label>{{ t('financeAnalysis.receiptDateField') }}</label>
        <MenuDropdown v-model="openDropdown" id="receiptDateField">
          <template #trigger="{ styling }">
            <button type="button" :class="styling" class="cursor-pointer">
              <span class="truncate">{{ filters.selectedReceiptDateFieldLabel.value }}</span>
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0 text-lg text-base-400" />
            </button>
          </template>

          <template #default="{ styling }">
            <button
              v-for="option in filters.receiptDateFieldOptions.value"
              :key="option.value"
              type="button"
              :class="[styling, option.value === filters.receiptDateField.value ? 'font-medium text-link-600' : '']"
              @click="filters.receiptDateField.value = option.value; openDropdown = null"
            >
              {{ option.label }}
            </button>
          </template>
        </MenuDropdown>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        <PageFinancesAnalysisToggleChip
          v-for="option in filters.receiptStatusOptions.value"
          :key="option.value"
          :selected="filters.selectedStatuses.value.includes(option.value)"
          @click="filters.toggleReceiptStatus(option.value)"
        >
          {{ option.label }}
        </PageFinancesAnalysisToggleChip>
      </div>

      <p v-if="filters.selectedStatuses.value.length === 0" class="text-xs text-danger-700">
        {{ t('financeAnalysis.noReceiptStatesSelected') }}
      </p>
    </PageFinancesAnalysisFilterSection>

    <PageFinancesAnalysisFilterSection
      v-model:expanded="expanded.invoice"
      icon="material-symbols:request-quote-outline-rounded"
      :title="t('financeAnalysis.invoiceStateFilters')"
      :hint="t('financeAnalysis.invoiceStateHint')"
      :summary="invoiceSummary"
    >
      <div class="field">
        <label>{{ t('financeAnalysis.invoiceDateField') }}</label>
        <MenuDropdown v-model="openDropdown" id="invoiceDateField">
          <template #trigger="{ styling }">
            <button type="button" :class="styling" class="cursor-pointer">
              <span class="truncate">{{ filters.selectedInvoiceDateFieldLabel.value }}</span>
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0 text-lg text-base-400" />
            </button>
          </template>

          <template #default="{ styling }">
            <button
              v-for="option in filters.invoiceDateFieldOptions.value"
              :key="option.value"
              type="button"
              :class="[styling, option.value === filters.invoiceDateField.value ? 'font-medium text-link-600' : '']"
              @click="filters.setInvoiceDateField(option.value); openDropdown = null"
            >
              {{ option.label }}
            </button>
          </template>
        </MenuDropdown>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        <PageFinancesAnalysisToggleChip
          v-for="option in filters.invoiceStatusOptions.value"
          :key="option.value"
          :selected="filters.selectedInvoiceStatuses.value.includes(option.value)"
          :disabled="option.disabled"
          :title="option.disabled ? t('financeAnalysis.invoiceDateFieldPaidHint') : ''"
          @click="filters.toggleInvoiceStatus(option.value)"
        >
          {{ option.label }}
        </PageFinancesAnalysisToggleChip>
      </div>

      <p v-if="filters.invoiceDateField.value === 'paid_at'" class="text-xs text-base-500">
        {{ t('financeAnalysis.invoiceDateFieldPaidHint') }}
      </p>

      <p v-if="filters.selectedInvoiceStatuses.value.length === 0" class="text-xs text-danger-700">
        {{ t('financeAnalysis.noInvoiceStatesSelected') }}
      </p>
    </PageFinancesAnalysisFilterSection>

    <div class="sticky bottom-0 -mx-4 -mb-4 space-y-2 border-t border-base-100 bg-white p-4 sm:-mx-6 sm:-mb-6 sm:rounded-b-xl sm:p-6">
      <p v-if="hasUnappliedChanges" class="flex items-center gap-1.5 text-xs font-medium text-warning-700">
        <Icon name="material-symbols:sync-problem-outline-rounded" class="h-4 w-4 shrink-0" aria-hidden="true" />
        {{ t('financeAnalysis.unappliedFilters') }}
      </p>

      <button
        type="button"
        class="btn-primary w-full"
        :class="!filters.hasValidDateRange.value || loading ? 'cursor-not-allowed opacity-70' : ''"
        :disabled="!filters.hasValidDateRange.value || loading"
        @click="$emit('run')"
      >
        {{ loading ? t('financeAnalysis.loadingShort') : t('financeAnalysis.runAnalysis') }}
      </button>

      <p v-if="!filters.hasValidDateRange.value" class="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">
        {{ t('financeAnalysis.invalidRange') }}
      </p>
    </div>
  </CommonCard>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { QuickSemester, useFinanceAnalysisFilters } from '~/composables/useFinanceAnalysisFilters'
import type { CostCentreRow } from '~/types/costCentre'

const props = defineProps<{
  filters: ReturnType<typeof useFinanceAnalysisFilters>
  hasCostCentreAccess: boolean
  loading: boolean
  hasUnappliedChanges: boolean
}>()

defineEmits<{
  (e: 'run'): void
}>()

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()

const expanded = reactive({
  period: true,
  costCentre: false,
  receipt: false,
  invoice: false,
})

const openDropdown = ref<string | number | null>(null)

const semesterOptions = computed<Array<{ value: Exclude<QuickSemester, ''>, label: string }>>(() => [
  { value: 'summer', label: t('financeAnalysis.semesters.summer') },
  { value: 'winter', label: t('financeAnalysis.semesters.winter') },
])

const quickYearOptions = computed(() => [
  { value: '', label: t('financeAnalysis.customRange') },
  ...props.filters.yearOptions.value.map(year => ({ value: String(year), label: String(year) })),
])

const quickYearLabel = computed(() => (
  quickYearOptions.value.find(option => option.value === props.filters.quickYear.value)?.label
  ?? t('financeAnalysis.customRange')
))

function selectQuickYear(value: string) {
  props.filters.quickYear.value = value
  openDropdown.value = null
  props.filters.applyYearShortcut()
}

const costCentreOptions = computed<SearchSelectOption<CostCentreRow>[]>(() => (
  props.filters.costCentres.value.map(costCentre => ({
    key: costCentre.id,
    label: props.filters.costCentreOptionLabel(costCentre),
    value: costCentre,
    searchText: `${costCentre.code} ${costCentre.name}`,
  }))
))

const periodSummary = computed(() => t('financeAnalysis.periodLabel', {
  start: formatDate(props.filters.startDate.value),
  end: formatDate(props.filters.endDate.value),
}))

const costCentreSummary = computed(() => {
  if (!props.filters.selectedCostCentre.value) return ''
  const label = props.filters.selectedCostCentreLabel.value
  return props.filters.includeChildCostCentres.value
    ? `${label} ${t('financeAnalysis.includingChildrenSuffix')}`
    : label
})

function statusSummary(labels: string[], dateFieldLabel: string) {
  if (!labels.length) return ''
  return `${labels.join(', ')} · ${dateFieldLabel}`
}

const receiptSummary = computed(() => statusSummary(
  props.filters.selectedStatuses.value.map(status => props.filters.receiptStatusLabels.value[status]),
  props.filters.selectedReceiptDateFieldLabel.value,
))

const invoiceSummary = computed(() => statusSummary(
  props.filters.selectedInvoiceStatuses.value.map(status => props.filters.invoiceStatusLabels.value[status]),
  props.filters.selectedInvoiceDateFieldLabel.value,
))
</script>
