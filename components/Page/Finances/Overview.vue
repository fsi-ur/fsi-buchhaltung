<template>
  <Page :headline1="t('finances.title')" :flush-header-with-cards="tabs.length > 1" :help-section="currentTab" @open-menu="$emit('openMenu')">
    <template v-if="tabs.length > 1" #header="{ headerContainerRef, headlineGroupRef }">
      <CommonTabOverview
        v-model="currentTab"
        :tabs="tabs"
        :header-container-ref="headerContainerRef"
        :headline-group-ref="headlineGroupRef"
      />
    </template>

    <template #cards>
      <component
        :is="activeComponent"
        :return-target="activeReturnTarget"
      />
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget } from '~/composables/useReturnTarget'
import ReceiptListPanel from './Receipt/ListPanel.vue'
import InvoiceListPanel from './Invoice/ListPanel.vue'
import ReimbursementListPanel from './Reimbursement/ListPanel.vue'
import CashCountListPanel from './CashCount/ListPanel.vue'
import BudgetListPanel from './Budget/ListPanel.vue'
import BankStatementListPanel from './BankStatement/ListPanel.vue'
import { useFinanceAccounts } from '~/composables/useFinanceAccounts'

type FinancesTab = 'receipts' | 'invoices' | 'reimbursements' | 'cashCounts' | 'budgets' | 'bankStatements'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()
const { pageMeta, setPage } = usePage()
const financeAccounts = useFinanceAccounts()

const currentTab = useState<FinancesTab>('finances-overview-current-tab', () => 'receipts')

const tabs = computed(() => {
  const list = [
    { key: 'receipts', label: t('pages.receipts'), show: hasPermission('receipts.view') },
    { key: 'invoices', label: t('pages.invoices'), show: hasPermission('invoices.view') },
    { key: 'cashCounts', label: t('pages.cashCounts'), show: hasPermission('cash_counts.view') },
    { key: 'reimbursements', label: t('pages.reimbursements'), show: hasPermission('reimbursements.view') },
    // Hidden only when there never was an account; with archived ones the old statements stay viewable.
    { key: 'bankStatements', label: t('pages.bankStatements'), show: hasPermission('bank_statements.view') && !(financeAccounts.loaded.value && !financeAccounts.bankVisible.value) },
    { key: 'budgets', label: t('pages.budgets'), show: hasPermission('budgets.view') },
  ] as const

  return list.filter(tab => tab.show).map(({ show, ...rest }) => rest)
})

const activeComponent = computed(() => {
  switch (currentTab.value) {
    case 'receipts':
      return ReceiptListPanel
    case 'invoices':
      return InvoiceListPanel
    case 'reimbursements':
      return ReimbursementListPanel
    case 'cashCounts':
      return CashCountListPanel
    case 'budgets':
      return BudgetListPanel
    case 'bankStatements':
      return BankStatementListPanel
    default:
      return ReceiptListPanel
  }
})

const activeReturnTarget = computed(() => buildReturnTarget('Finances', { tab: currentTab.value }))

watch([tabs, () => pageMeta.value?.tab, () => pageMeta.value?.resetTabKey], ([availableTabs, requestedTab, resetTabKey]) => {
  const requested = requestedTab as FinancesTab | undefined
  if (requested && availableTabs.find(tab => tab.key === requested)) {
    currentTab.value = requested
    return
  }

  if (resetTabKey && availableTabs[0]?.key) {
    currentTab.value = availableTabs[0].key
    return
  }

  if (!availableTabs.find(tab => tab.key === currentTab.value) && availableTabs.length > 0) {
    if (availableTabs[0]?.key) currentTab.value = availableTabs[0].key
  }
}, { immediate: true })

watch(currentTab, (tab) => {
  if (pageMeta.value?.tab === tab) return
  setPage('Finances', { tab })
}, { immediate: true })
</script>
