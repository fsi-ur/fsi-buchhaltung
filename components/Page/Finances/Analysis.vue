<template>
  <Page :headline1="t('financeAnalysis.title')" @open-menu="$emit('openMenu')">
    <template #cards>
      <PageFinancesAnalysisFilterPanel
        :filters="filters"
        :has-cost-centre-access="hasCostCentreAccess"
        :loading="isLoading"
        :has-unapplied-changes="hasUnappliedChanges"
        @run="loadAnalysis"
      />

      <section class="-mx-6 -mb-6 col-span-12 space-y-6 self-start bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg md:p-6 lg:col-span-8 lg:mb-0 xl:col-span-9">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0 space-y-1">
            <h2 class="text-lg font-semibold">{{ t('financeAnalysis.analysisTitle') }}</h2>
            <p class="text-sm text-base-500">{{ activePeriodLabel }}</p>
            <p v-if="appliedCostCentreLabel" class="text-xs text-base-500">{{ appliedCostCentreLabel }}</p>
          </div>

          <div class="flex flex-wrap items-center justify-end gap-3">
            <div class="flex h-11 items-center gap-3 rounded-xl border border-base-200 px-4">
              <label class="text-sm font-medium text-base-900" for="comparison-toggle">
                {{ t('financeAnalysis.compareWithPreviousYear') }}
              </label>
              <CommonToggleSwitch
                id="comparison-toggle"
                v-model="filters.compareWithPreviousYear.value"
                :label="t('financeAnalysis.compareWithPreviousYear')"
                @update:model-value="loadAnalysis"
              />
            </div>

            <button
              type="button"
              class="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
              :class="!canExportAnalysis ? 'cursor-not-allowed opacity-70 hover:bg-accent-500' : ''"
              :disabled="!canExportAnalysis"
              @click="isExportDialogOpen = true"
            >
              <Icon
                :name="exportState.isExporting.value ? 'material-symbols:hourglass-top-rounded' : 'material-symbols:download-rounded'"
                class="h-5 w-5"
                aria-hidden="true"
              />
              <span>{{ exportState.isExporting.value ? t('financeAnalysis.exportingReport') : t('financeAnalysis.exportReport') }}</span>
            </button>
          </div>
        </div>

        <div v-if="errorMessage" class="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {{ errorMessage }}
        </div>

        <div v-else-if="isLoading && !analysis" class="space-y-4">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            <div v-for="n in 5" :key="n" class="h-28 animate-pulse rounded-xl bg-base-100" />
          </div>
          <div class="h-64 animate-pulse rounded-xl bg-base-100" />
        </div>

        <template v-else-if="analysis">
          <div
            v-if="isLoading"
            class="flex items-center gap-2 rounded-xl bg-base-50 px-4 py-2 text-sm text-base-600"
            aria-live="polite"
          >
            <Icon name="material-symbols:progress-activity" class="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            {{ t('financeAnalysis.loading') }}
          </div>

          <PageFinancesAnalysisSummaryCards
            :summary="analysis.summary"
            :receipt-status-labels="filters.receiptStatusLabels.value"
            @show-liquidity="activeDetailTab = 'liquidity'"
          />

          <PageFinancesAnalysisComparisonPanel
            v-if="filters.compareWithPreviousYear.value && comparisonAnalysis"
            :summary="analysis.summary"
            :comparison="comparisonAnalysis.summary"
          />

          <PageFinancesAnalysisDetailTables
            v-model:tab="activeDetailTab"
            :analysis="analysis"
            :loading="isLoading"
            :receipt-date-field="filters.receiptDateField.value"
            :invoice-date-field="filters.invoiceDateField.value"
            :receipt-date-field-label="filters.selectedReceiptDateFieldLabel.value"
            :invoice-date-field-label="filters.selectedInvoiceDateFieldLabel.value"
            :receipt-status-labels="filters.receiptStatusLabels.value"
            :invoice-status-labels="filters.invoiceStatusLabels.value"
            :can-view-bank-statements="canViewBankStatements"
            @open="openRecord"
          />
        </template>
      </section>

      <PageFinancesAnalysisExportDialog v-model="isExportDialogOpen" :export-state="exportState" />
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget } from '~/composables/useReturnTarget'
import {
  shiftDateByYears,
  useFinanceAnalysisFilters,
  type PersistedFinanceAnalysisState,
} from '~/composables/useFinanceAnalysisFilters'
import {
  useFinanceAnalysisExport,
  type PersistedFinanceAnalysisExportState,
} from '~/composables/useFinanceAnalysisExport'
import type { DetailTabKey } from '~/components/Page/Finances/Analysis/DetailTables.vue'
import type { FinanceAnalysisData } from '~/types/financeAnalysis'

defineEmits<{
  (e: 'openMenu'): void
}>()

type FinanceAnalysisResponse =
  | { ok: true, analysis: FinanceAnalysisData }
  | { ok: false, error: string }

const { setPage, pageMeta } = usePage()
const { hasPermission } = useAuth()
const { t } = useI18n()
const { formatDate } = useLocaleFormatters()

const filters = useFinanceAnalysisFilters()

const analysis = ref<FinanceAnalysisData | null>(null)
const comparisonAnalysis = ref<FinanceAnalysisData | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const isExportDialogOpen = ref(false)
const activeDetailTab = ref<DetailTabKey>('receipts')
/** The filter snapshot the figures on screen were produced with. */
const appliedState = ref<PersistedFinanceAnalysisState | null>(null)

const hasCostCentreAccess = computed(() => hasPermission('cost_centres.view'))
const canViewBankStatements = computed(() => hasPermission('bank_statements.view'))

const exportState = useFinanceAnalysisExport({
  analysis: () => analysis.value,
  comparisonAnalysis: () => comparisonAnalysis.value,
  startDate: () => filters.startDate.value,
  endDate: () => filters.endDate.value,
  includeComparison: () => filters.compareWithPreviousYear.value,
  statuses: () => filters.selectedStatuses.value,
  receiptStatusLabels: () => filters.receiptStatusLabels.value,
  receiptDateField: () => filters.receiptDateField.value,
  invoiceStatuses: () => filters.selectedInvoiceStatuses.value,
  invoiceDateField: () => filters.invoiceDateField.value,
  costCentres: () => filters.costCentres.value,
  selectedCostCentre: () => filters.selectedCostCentre.value,
  includeChildCostCentres: () => filters.includeChildCostCentres.value,
})

const sessionAnalysisState = useState<PersistedFinanceAnalysisState | null>('finance-analysis-session-state', () => null)
const sessionExportState = useState<PersistedFinanceAnalysisExportState | null>('finance-analysis-export-session-state', () => null)

const canExportAnalysis = computed(() => Boolean(analysis.value) && !isLoading.value && !exportState.isExporting.value)

const activePeriodLabel = computed(() => t('financeAnalysis.periodLabel', {
  start: formatDate(analysis.value?.summary.start_date || filters.startDate.value),
  end: formatDate(analysis.value?.summary.end_date || filters.endDate.value),
}))

const appliedCostCentreLabel = computed(() => {
  if (!appliedState.value || typeof appliedState.value.selectedCostCentreId !== 'number') return ''

  const costCentre = filters.costCentres.value.find(row => row.id === appliedState.value?.selectedCostCentreId)
  if (!costCentre) return ''

  const label = filters.costCentreOptionLabel(costCentre)
  return appliedState.value.includeChildCostCentres
    ? `${t('financeAnalysis.costCentre')}: ${label} ${t('financeAnalysis.includingChildrenSuffix')}`
    : `${t('financeAnalysis.costCentre')}: ${label}`
})

/** Only the fields that actually change the figures — panel expansion state must not count. */
function comparableFilterState(state: PersistedFinanceAnalysisState | null) {
  if (!state) return ''

  return JSON.stringify({
    startDate: state.startDate,
    endDate: state.endDate,
    compareWithPreviousYear: state.compareWithPreviousYear,
    selectedStatuses: state.selectedStatuses,
    receiptDateField: state.receiptDateField,
    selectedInvoiceStatuses: state.selectedInvoiceStatuses,
    invoiceDateField: state.invoiceDateField,
    selectedCostCentreId: state.selectedCostCentreId,
    includeChildCostCentres: state.includeChildCostCentres,
  })
}

const hasUnappliedChanges = computed(() => (
  Boolean(analysis.value)
  && comparableFilterState(appliedState.value) !== comparableFilterState(filters.toPersistedState())
))

async function fetchAnalysisRange(periodStartDate: string, periodEndDate: string) {
  const response = await $fetch<FinanceAnalysisResponse>('/api/finances/analysis', {
    query: {
      startDate: periodStartDate,
      endDate: periodEndDate,
      ...filters.requestFilters.value,
      costCentreId: filters.requestFilters.value.costCentreId ?? undefined,
    },
  })

  if (!response.ok) throw new Error(response.error)
  return response.analysis
}

async function loadAnalysis() {
  if (!filters.hasValidDateRange.value) return

  isLoading.value = true
  errorMessage.value = ''
  comparisonAnalysis.value = null

  try {
    if (filters.compareWithPreviousYear.value) {
      const [currentAnalysis, previousAnalysis] = await Promise.all([
        fetchAnalysisRange(filters.startDate.value, filters.endDate.value),
        fetchAnalysisRange(
          shiftDateByYears(filters.startDate.value, -1),
          shiftDateByYears(filters.endDate.value, -1),
        ),
      ])

      analysis.value = currentAnalysis
      comparisonAnalysis.value = previousAnalysis
    } else {
      analysis.value = await fetchAnalysisRange(filters.startDate.value, filters.endDate.value)
    }

    appliedState.value = filters.toPersistedState()
  } catch (error: any) {
    errorMessage.value = error?.data?.error || error?.message || t('financeAnalysis.loadFailed')
  } finally {
    isLoading.value = false
  }
}

function openRecord({ page, id }: { page: string, id: number }) {
  const metaKeyByPage: Record<string, string> = {
    ReceiptCreate: 'receiptId',
    InvoiceCreate: 'invoiceId',
    CashCountCreate: 'cashCountId',
    BankStatementCreate: 'bankStatementId',
  }

  const metaKey = metaKeyByPage[page]
  if (!metaKey) return

  setPage(page, {
    [metaKey]: id,
    returnTarget: buildReturnTarget('FinanceAnalysis', {
      analysisState: { ...filters.toPersistedState(), activeDetailTab: activeDetailTab.value },
    }),
    forceReadonly: true,
  })
}

watch(() => filters.toPersistedState(), (state) => {
  sessionAnalysisState.value = { ...state, activeDetailTab: activeDetailTab.value }
}, { deep: true })

watch(activeDetailTab, (tab) => {
  sessionAnalysisState.value = { ...filters.toPersistedState(), activeDetailTab: tab }
})

watch(() => exportState.toPersistedState(), (state) => {
  sessionExportState.value = state
}, { deep: true })

onMounted(async () => {
  await Promise.all([
    hasCostCentreAccess.value ? filters.loadCostCentres() : Promise.resolve(),
    exportState.loadBudgets(),
  ])

  const restored = (pageMeta.value?.analysisState as PersistedFinanceAnalysisState | undefined)
    ?? sessionAnalysisState.value

  filters.applyPersistedState(restored)
  exportState.applyPersistedState(sessionExportState.value)

  const restoredTab = restored?.activeDetailTab
  if (restoredTab) activeDetailTab.value = restoredTab as DetailTabKey

  await loadAnalysis()
})
</script>
