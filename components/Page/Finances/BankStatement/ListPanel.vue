<template>
  <CommonPageTableCard
    :title="t('bankStatement.stored')"
    persist-key="bank-statements-list"
    :search-value="search"
    :search-placeholder="t('bankStatement.search')"
    :can-create="canEdit && financeAccounts.bankEnabled.value"
    :create-label="`+ ${t('bankStatement.new')}`"
    @update:search-value="search = $event"
    @create="createBankStatement"
  >
    <template #actions>
      <PageFinancesAccountSelect
        v-if="financeAccounts.accounts.value.length > 1"
        v-model="accountFilter"
        :accounts="financeAccounts.accounts.value"
        :all-label="t('bankStatement.allAccounts')"
        :aria-label="t('bankStatement.account')"
        wrapper-class="relative w-48"
      />
      <PageAuditTableHistoryButton :tables="['bank_statements', 'bank_statement_positions', 'finance_accounts']" />
    </template>

    <p
      v-if="financeAccounts.loaded.value && !financeAccounts.bankEnabled.value"
      class="mb-3 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800"
    >
      {{ t('bankStatement.bankDisabled') }}
    </p>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="bank-statements-list"
      :rows="filteredBankStatements"
      :columns="columns"
      :empty-text="t('bankStatement.none')"
      @row-open="openBankStatement($event.id)"
    />
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
import type { PageTarget } from '~/types/page'
import type { BankStatementOverview } from '~/types/bankStatement'
import { useFinanceAccounts } from '~/composables/useFinanceAccounts'

const props = defineProps<{
  returnTarget?: PageTarget | null
}>()

const { setPage } = usePage()
const { t } = useI18n()
const { formatCurrency, formatDate } = useLocaleFormatters()
const { hasPermission } = useAuth()

const canEdit = computed(() => hasPermission('bank_statements.edit'))
const resolvedReturnTarget = computed(() => cloneReturnTarget(props.returnTarget) ?? buildReturnTarget('BankStatementList'))

const bankStatements = ref<BankStatementOverview[]>([])
const loading = ref(true)
const search = ref('')
const financeAccounts = useFinanceAccounts()
/** null = all accounts. Opening/closing balances are always those of the statement's own account. */
const accountFilter = ref<number | null>(null)
const filteredBankStatements = computed(() => accountFilter.value
  ? bankStatements.value.filter(row => row.account_id === accountFilter.value)
  : bankStatements.value)

const columns = computed<AdvancedTableColumn<BankStatementOverview>[]>(() => [
  {
    key: 'statement_number',
    label: t('bankStatement.statementNumber'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.statement_number,
    cellClass: 'font-medium',
    mobile: 'title',
  },
  {
    key: 'account_name',
    label: t('bankStatement.account'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.account_name,
    mobileLabel: true,
  },
  {
    key: 'statement_date',
    label: t('bankStatement.statementDate'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.statement_date,
    format: row => formatDate(row.statement_date),
    mobileLabel: false,
  },
  {
    key: 'checked_by_name',
    label: t('bankStatement.checkedBy'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.checked_by_name,
    format: row => row.checked_by_name || t('common.notAvailable'),
    mobileLabel: true,
  },
  {
    key: 'position_count',
    label: t('bankStatement.positions'),
    filterType: 'number',
    getValue: row => row.position_count,
    headerClass: 'text-right',
    cellClass: 'text-right',
    mobileLabel: true,
  },
  {
    key: 'opening_balance',
    label: t('bankStatement.openingBalance'),
    filterType: 'number',
    getValue: row => row.opening_balance,
    format: row => formatCurrency(row.opening_balance),
    headerClass: 'text-right',
    cellClass: 'text-right font-medium',
    mobileLabel: true,
  },
  {
    key: 'closing_balance',
    label: t('bankStatement.closingBalance'),
    filterType: 'number',
    getValue: row => row.closing_balance,
    format: row => formatCurrency(row.closing_balance),
    headerClass: 'text-right',
    cellClass: 'text-right font-medium',
    mobileLabel: true,
  },
])

onMounted(async () => {
  try {
    const res = await apiFetch<ApiResponse<'/api/bank_statements'>>('/api/bank_statements')
    if (res.ok) {
      bankStatements.value = res.bankStatements
    }
  } finally {
    loading.value = false
  }
})

function openBankStatement(id: number) {
  setPage('BankStatementCreate', {
    bankStatementId: id,
    returnTarget: resolvedReturnTarget.value,
  })
}

function createBankStatement() {
  setPage('BankStatementCreate', {
    returnTarget: resolvedReturnTarget.value,
  })
}
</script>
