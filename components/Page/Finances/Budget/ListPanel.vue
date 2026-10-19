<template>
  <CommonPageTableCard
    :title="t('budget.listTitle')"
    persist-key="budgets-list"
    :search-value="search"
    :search-placeholder="t('budget.search')"
    :can-create="canEdit"
    :create-label="`+ ${t('budget.new')}`"
    @update:search-value="search = $event"
    @create="createBudget"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['budgets', 'budget_cost_centre_lines']" />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="budgets-list"
      :rows="budgets"
      :columns="columns"
      :empty-text="t('budget.none')"
      @row-open="openBudget($event.id)"
    >
      <template #cell-saldo="{ row }">
        <span class="font-medium" :class="saldoTextClass(row.own_saldo)">{{ formatCurrency(row.own_saldo) }}</span>
      </template>
      <template #actions="{ row }">
        <button
          class="text-link-600 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="downloadingBudgetId === row.id"
          @click="downloadBudget(row)"
        >
          {{ t('budget.downloadPdfShort') }}
        </button>
        <button class="text-link-600 hover:underline cursor-pointer" @click="openBudget(row.id)">
          {{ t('actions.open') }}
        </button>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget, cloneReturnTarget } from '~/composables/useReturnTarget'
import { useToast } from '~/composables/useToast'
import type { BudgetListItem, BudgetSemester } from '~/types/budget'
import type { PageTarget } from '~/types/page'
import { downloadBudgetPlanPdf } from '~/utils/budgetPdfDownload'

const props = defineProps<{
  returnTarget?: PageTarget | null
}>()

const { setPage } = usePage()
const { hasPermission } = useAuth()
const { t } = useI18n()
const { formatCurrency, formatDate } = useLocaleFormatters()
const toast = useToast()

const downloadingBudgetId = ref<number | null>(null)

const canEdit = computed(() => hasPermission('budgets.edit'))
const resolvedReturnTarget = computed(() => cloneReturnTarget(props.returnTarget) ?? buildReturnTarget('BudgetList'))
const budgets = ref<BudgetListItem[]>([])
const loading = ref(true)
const search = ref('')

const columns = computed<AdvancedTableColumn<BudgetListItem>[]>(() => [
  {
    key: 'period',
    label: t('budget.period'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => budgetLabel(row.year, row.semester),
    cellClass: 'font-medium text-base-900',
    mobile: 'title',
  },
  {
    key: 'range',
    label: t('budget.range'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.start_date,
    format: row => `${formatDate(row.start_date)} - ${formatDate(row.end_date)}`,
    mobileLabel: true,
  },
  {
    key: 'expense',
    label: t('budget.totalExpenses'),
    filterType: 'number',
    getValue: row => row.own_expense_total,
    format: row => formatCurrency(row.own_expense_total),
    headerClass: 'text-right',
    cellClass: 'text-right',
    mobileLabel: true,
  },
  {
    key: 'income',
    label: t('budget.totalIncome'),
    filterType: 'number',
    getValue: row => row.own_income_total,
    format: row => formatCurrency(row.own_income_total),
    headerClass: 'text-right',
    cellClass: 'text-right',
    mobileLabel: true,
  },
  {
    key: 'saldo',
    label: t('budget.totalSaldo'),
    filterType: 'number',
    getValue: row => row.own_saldo,
    format: row => formatCurrency(row.own_saldo),
    headerClass: 'text-right',
    cellClass: 'text-right',
    mobileLabel: true,
  },
])

onMounted(async () => {
  try {
    const response = await apiFetch<{ ok: boolean, budgets?: BudgetListItem[], error?: string }>('/api/finances/budgets')
    if (response.ok && response.budgets) {
      budgets.value = response.budgets
    }
  } finally {
    loading.value = false
  }
})

function budgetLabel(year: number, semester: BudgetSemester) {
  return `${year} · ${semester === 'summer' ? t('budget.semesters.summer') : t('budget.semesters.winter')}`
}

function saldoTextClass(value: number) {
  if (value > 0) return 'text-success-700'
  if (value < 0) return 'text-danger-700'
  return 'text-base-700'
}

async function downloadBudget(budget: BudgetListItem) {
  if (downloadingBudgetId.value !== null) return
  downloadingBudgetId.value = budget.id

  try {
    const result = await downloadBudgetPlanPdf(budget)
    if (!result.ok) toast.error(result.error || t('budget.downloadFailed'))
  } catch {
    toast.error(t('budget.downloadFailed'))
  } finally {
    downloadingBudgetId.value = null
  }
}

function openBudget(id: number) {
  setPage('BudgetCreate', {
    budgetId: id,
    returnTarget: resolvedReturnTarget.value,
  })
}

function createBudget() {
  setPage('BudgetCreate', {
    returnTarget: resolvedReturnTarget.value,
  })
}
</script>
