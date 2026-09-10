<template>
  <CommonModal
    v-model="open"
    width-class="max-w-2xl"
    :title="t('financeAnalysis.exportOptionsTitle')"
  >
    <p class="-mt-2 text-sm text-base-500">{{ t('financeAnalysis.exportOptionsHint') }}</p>

    <section class="space-y-2">
      <div>
        <h4 class="text-sm font-semibold text-base-900">{{ t('financeAnalysis.exportFormatTitle') }}</h4>
        <p class="text-xs text-base-500">{{ t('financeAnalysis.exportFormatHint') }}</p>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <PageFinancesAnalysisToggleChip
          :selected="exportState.exportFormat.value === 'pdf'"
          icon="material-symbols:picture-as-pdf-rounded"
          @click="exportState.exportFormat.value = 'pdf'"
        >
          {{ t('financeAnalysis.exportFormatPdf') }}
        </PageFinancesAnalysisToggleChip>
        <PageFinancesAnalysisToggleChip
          :selected="exportState.exportFormat.value === 'excel'"
          icon="material-symbols:table-rounded"
          @click="exportState.exportFormat.value = 'excel'"
        >
          {{ t('financeAnalysis.exportFormatExcel') }}
        </PageFinancesAnalysisToggleChip>
      </div>
    </section>

    <section class="space-y-2">
      <div>
        <h4 class="text-sm font-semibold text-base-900">{{ t('financeAnalysis.exportPartsTitle') }}</h4>
        <p class="text-xs text-base-500">{{ t('financeAnalysis.exportPartsHint') }}</p>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <PageFinancesAnalysisToggleChip
          v-for="part in contentParts"
          :key="part.key"
          :selected="part.model.value"
          @click="part.model.value = !part.model.value"
        >
          {{ part.label }}
        </PageFinancesAnalysisToggleChip>
      </div>
    </section>

    <section v-if="exportState.showReportPagesExportOptions.value" class="space-y-2">
      <div>
        <h4 class="text-sm font-semibold text-base-900">{{ t('financeAnalysis.exportReportPagesTitle') }}</h4>
        <p class="text-xs text-base-500">{{ t('financeAnalysis.exportReportPagesHint') }}</p>
      </div>

      <MenuDropdown v-model="openDropdown" id="reportPages">
        <template #trigger="{ styling }">
          <button type="button" :class="styling" class="cursor-pointer">
            <span class="truncate">{{ exportState.selectedReportPagesExportLabel.value }}</span>
            <Icon name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0 text-lg text-base-400" />
          </button>
        </template>

        <template #default="{ styling }">
          <button
            v-for="option in exportState.reportPagesExportOptions.value"
            :key="option.value"
            type="button"
            :class="[
              styling,
              option.disabled ? 'cursor-not-allowed! text-base-400 hover:bg-transparent!' : '',
              option.value === exportState.reportPagesExportMode.value ? 'font-medium text-link-600' : '',
            ]"
            :disabled="option.disabled"
            @click="exportState.reportPagesExportMode.value = option.value; openDropdown = null"
          >
            {{ option.label }}
          </button>
        </template>
      </MenuDropdown>

      <p
        :class="[
          'rounded-lg px-2.5 py-1.5 text-xs',
          exportState.canCompareToBudget.value ? 'bg-success-50 text-success-800' : 'bg-base-100 text-base-600',
        ]"
      >
        {{ exportState.compareToBudgetHint.value }}
      </p>
    </section>

    <section class="space-y-2">
      <div>
        <h4 class="text-sm font-semibold text-base-900">{{ t('financeAnalysis.exportOverviewSheetsTitle') }}</h4>
        <p class="text-xs text-base-500">{{ t('financeAnalysis.exportOverviewSheetsHint') }}</p>
      </div>

      <div class="space-y-1.5 rounded-lg bg-base-50 p-2">
        <div class="text-xs font-semibold uppercase tracking-wide text-base-500">
          {{ t('financeAnalysis.exportGroupingLabel') }}
        </div>
        <div class="grid grid-cols-3 gap-2">
          <PageFinancesAnalysisToggleChip
            v-for="option in groupingOptions"
            :key="option.value"
            compact
            :selected="exportState.exportGrouping.value === option.value"
            @click="exportState.exportGrouping.value = option.value"
          >
            {{ option.label }}
          </PageFinancesAnalysisToggleChip>
        </div>
      </div>

      <div class="space-y-1.5 rounded-lg bg-base-50 p-2">
        <div class="text-xs font-semibold uppercase tracking-wide text-base-500">
          {{ t('financeAnalysis.exportSplitLabel') }}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <PageFinancesAnalysisToggleChip
            compact
            :selected="exportState.exportSplitByMonth.value"
            @click="exportState.exportSplitByMonth.value = !exportState.exportSplitByMonth.value"
          >
            {{ t('financeAnalysis.exportSplitByMonth') }}
          </PageFinancesAnalysisToggleChip>
          <PageFinancesAnalysisToggleChip
            compact
            :selected="exportState.exportSplitByPaymentStatus.value"
            @click="exportState.exportSplitByPaymentStatus.value = !exportState.exportSplitByPaymentStatus.value"
          >
            {{ t('financeAnalysis.exportSplitByPaymentStatus') }}
          </PageFinancesAnalysisToggleChip>
        </div>
      </div>
    </section>

    <section
      v-if="exportState.exportFormat.value === 'pdf'"
      class="flex items-center justify-between gap-3 rounded-lg bg-base-50 p-3"
    >
      <div class="min-w-0">
        <h4 class="text-sm font-semibold text-base-900">{{ t('financeAnalysis.exportTableOfContents') }}</h4>
        <p class="text-xs text-base-500">{{ t('financeAnalysis.exportTableOfContentsHint') }}</p>
      </div>
      <CommonToggleSwitch
        v-model="exportState.includeTableOfContents.value"
        :label="t('financeAnalysis.exportTableOfContents')"
      />
    </section>

    <section class="flex items-center justify-between gap-3 rounded-lg bg-base-50 p-3">
      <div class="min-w-0">
        <h4 class="text-sm font-semibold text-base-900">{{ t('financeAnalysis.liquidity.exportInclude') }}</h4>
        <p class="text-xs text-base-500">{{ t('financeAnalysis.liquidity.exportHint') }}</p>
      </div>
      <CommonToggleSwitch
        v-model="exportState.includeBalanceSheet.value"
        :label="t('financeAnalysis.liquidity.exportInclude')"
      />
    </section>

    <p v-if="!exportState.hasSelectedExportContent.value" class="text-xs text-danger-700">
      {{ t('financeAnalysis.exportNothingSelected') }}
    </p>

    <template #footer>
      <button type="button" class="btn-secondary" @click="open = false">
        {{ t('actions.cancel') }}
      </button>
      <button
        type="button"
        class="btn-primary"
        :class="!exportState.hasSelectedExportContent.value ? 'cursor-not-allowed opacity-70' : ''"
        :disabled="exportState.isExporting.value || !exportState.hasSelectedExportContent.value"
        @click="runExport"
      >
        {{ exportState.isExporting.value ? t('financeAnalysis.exportingReport') : t('financeAnalysis.exportNow') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { useFinanceAnalysisExport } from '~/composables/useFinanceAnalysisExport'
import type { FinanceAnalysisExportGrouping } from '~/shared/financeAnalysisGrouping'

const props = defineProps<{
  exportState: ReturnType<typeof useFinanceAnalysisExport>
}>()

const open = defineModel<boolean>({ default: false })

const { t } = useI18n()

const openDropdown = ref<string | number | null>(null)

const contentParts = computed(() => [
  { key: 'overview', label: t('financeAnalysis.exportPartOverview'), model: props.exportState.exportIncludeOverview },
  { key: 'receipts', label: t('financeAnalysis.exportPartReceipts'), model: props.exportState.exportIncludeReceiptList },
  { key: 'cashCounts', label: t('financeAnalysis.exportPartCashCounts'), model: props.exportState.exportIncludeCashCountList },
  { key: 'bankStatements', label: t('financeAnalysis.exportPartBankStatements'), model: props.exportState.exportIncludeBankStatementList },
  { key: 'invoices', label: t('financeAnalysis.exportPartInvoices'), model: props.exportState.exportIncludeInvoiceList },
])

const groupingOptions = computed<Array<{ value: FinanceAnalysisExportGrouping, label: string }>>(() => {
  const options: Array<{ value: FinanceAnalysisExportGrouping, label: string }> = [
    { value: 'none', label: t('financeAnalysis.exportGroupingNone') },
  ]

  if (props.exportState.showCostCentreGroupingOption.value) {
    options.push({ value: 'costCentres', label: t('financeAnalysis.exportGroupingCostCentres') })
  }

  options.push({ value: 'spheres', label: t('financeAnalysis.exportGroupingSpheres') })
  return options
})

async function runExport() {
  const succeeded = await props.exportState.runExport()
  if (succeeded) open.value = false
}
</script>
