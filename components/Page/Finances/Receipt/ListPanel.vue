<template>
  <CommonPageTableCard
    :title="t('receipt.stored')"
    persist-key="receipts-list"
    :search-value="search"
    :search-placeholder="t('receipt.search')"
    :can-create="canEdit"
    :create-label="`+ ${t('receipt.new')}`"
    @update:search-value="search = $event"
    @create="createReceipt"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['receipts', 'receipt_positions']" />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="receipts-list"
      :rows="receipts"
      :columns="columns"
      :empty-text="t('receipt.none')"
      @row-open="openReceipt($event.id)"
    >
      <template #cell-status="{ row }">
        <CommonStatusBadge :label="statusLabels[row.status]" :tone="statusTone(row.status)" />
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
import type { PageTarget } from '~/types/page'
import { ReceiptStatus, type ReceiptRow } from '~/types/receipt'

const props = defineProps<{
  returnTarget?: PageTarget | null
}>()

const { setPage } = usePage()
const { t } = useI18n()
const { formatDate, formatCurrency } = useLocaleFormatters()
const { hasPermission } = useAuth()

const canEdit = computed(() => hasPermission('receipts.edit'))
const resolvedReturnTarget = computed(() => cloneReturnTarget(props.returnTarget) ?? buildReturnTarget('ReceiptList'))

const receipts = ref<ReceiptRow[]>([])
const loading = ref(true)
const search = ref('')

const statusLabels = computed<Record<ReceiptStatus, string>>(() => ({
  draft: t('receipt.states.draft'),
  open: t('receipt.states.open'),
  paid: t('receipt.states.paid'),
  cancelled: t('receipt.states.cancelled'),
}))

const columns = computed<AdvancedTableColumn<ReceiptRow>[]>(() => [
  {
    key: 'receipt_date',
    label: t('receipt.receiptDate'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.receipt_date,
    format: row => formatDate(row.receipt_date),
  },
  {
    key: 'receipt_number',
    label: t('receipt.receiptNumber'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.receipt_number ?? '-',
    format: row => row.receipt_number || t('receipt.noNumber'),
    mobileLabel: true,
  },
  {
    key: 'company_name',
    label: t('receipt.company'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.company_name ?? '-',
    format: row => row.company_name || t('receipt.noCompany'),
    mobile: 'title',
  },
  {
    key: 'total_amount',
    label: t('receipt.grossAmount'),
    filterType: 'number',
    getValue: row => row.total_amount,
    format: row => formatCurrency(row.total_amount),
    headerClass: 'text-right',
    cellClass: 'text-right font-medium',
    mobileLabel: true,
  },
  {
    key: 'status',
    label: t('receipt.paymentStatus'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => statusLabels.value[row.status],
    headerClass: 'text-center',
    cellClass: 'text-center',
    mobileLabel: true,
  },
])

onMounted(async () => {
  try {
    const res = await apiFetch<ApiResponse<'/api/receipts'>>('/api/receipts')
    if (res.ok) {
      receipts.value = res.receipts
    } else {
      console.log(res.error)
    }
  } finally {
    loading.value = false
  }
})

function statusTone(status: ReceiptStatus) {
  switch (status) {
    case ReceiptStatus.Draft:
      return 'base'
    case ReceiptStatus.Open:
      return 'warning'
    case ReceiptStatus.Paid:
      return 'success'
    case ReceiptStatus.Cancelled:
      return 'dangerCancelled'
    default:
      return 'baseMuted'
  }
}

function openReceipt(id: number) {
  setPage('ReceiptCreate', {
    receiptId: id,
    returnTarget: resolvedReturnTarget.value,
  })
}

function createReceipt() {
  setPage('ReceiptCreate', {
    returnTarget: resolvedReturnTarget.value,
  })
}
</script>
