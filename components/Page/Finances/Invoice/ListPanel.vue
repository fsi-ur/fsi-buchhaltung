<template>
  <CommonPageTableCard
    :title="t('invoice.stored')"
    persist-key="invoices-list"
    :search-value="search"
    :search-placeholder="t('invoice.search')"
    :can-create="canEdit"
    :create-label="`+ ${t('invoice.new')}`"
    @update:search-value="search = $event"
    @create="createInvoice"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['invoices', 'invoice_positions']" />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="invoices-list"
      :rows="invoices"
      :columns="columns"
      :empty-text="t('invoice.none')"
      @row-open="openInvoice($event.id)"
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
import { InvoiceSourceType, InvoiceStatus, type InvoiceRow } from '~/types/invoice'

const props = defineProps<{
  returnTarget?: PageTarget | null
}>()

const { t } = useI18n()
const { formatDate, formatCurrency } = useLocaleFormatters()
const { hasPermission } = useAuth()
const { setPage } = usePage()

const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)
const search = ref('')
const canEdit = computed(() => hasPermission('invoices.edit'))
const resolvedReturnTarget = computed(() => cloneReturnTarget(props.returnTarget) ?? buildReturnTarget('InvoiceList'))

const statusLabels = computed<Record<InvoiceStatus, string>>(() => ({
  draft: t('invoice.states.draft'),
  open: t('invoice.states.open'),
  paid: t('invoice.states.paid'),
  cancelled: t('invoice.states.cancelled'),
}))

const sourceLabels = computed<Record<InvoiceSourceType, string>>(() => ({
  upload: t('invoice.sources.upload'),
  generated: t('invoice.sources.generated'),
}))

const columns = computed<AdvancedTableColumn<InvoiceRow>[]>(() => [
  {
    key: 'invoice_date',
    label: t('invoice.invoiceDate'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.invoice_date,
    format: row => formatDate(row.invoice_date),
  },
  {
    key: 'invoice_number',
    label: t('invoice.invoiceNumber'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.invoice_number,
    mobileLabel: true,
  },
  {
    key: 'company_name',
    label: t('invoice.company'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.company_name ?? '-',
    format: row => row.company_name || t('invoice.noCompany'),
    mobile: 'title',
  },
  {
    key: 'source_type',
    label: t('invoice.sourceType'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => sourceLabels.value[row.source_type],
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
  {
    key: 'total_amount',
    label: t('invoice.total'),
    filterType: 'number',
    getValue: row => row.total_amount,
    format: row => formatCurrency(row.total_amount),
    headerClass: 'text-right',
    cellClass: 'text-right font-medium',
    mobileLabel: true,
  },
  {
    key: 'status',
    label: t('invoice.paymentStatus'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => statusLabels.value[row.status],
    headerClass: 'text-center',
    cellClass: 'text-center',
    mobileLabel: true,
  },
  {
    key: 'paid_at',
    label: t('invoice.paidAt'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.paid_at ?? '',
    format: row => row.paid_at ? formatDate(row.paid_at) : '-',
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
])

onMounted(async () => {
  try {
    const res = await apiFetch<{ ok: boolean, invoices?: InvoiceRow[], error?: string }>('/api/invoices')
    if (res.ok && res.invoices) invoices.value = res.invoices
  } finally {
    loading.value = false
  }
})

function statusTone(status: InvoiceStatus) {
  switch (status) {
    case InvoiceStatus.Draft:
      return 'base'
    case InvoiceStatus.Open:
      return 'warning'
    case InvoiceStatus.Paid:
      return 'success'
    case InvoiceStatus.Cancelled:
      return 'dangerCancelled'
  }
}

function openInvoice(id: number) {
  setPage('InvoiceCreate', {
    invoiceId: id,
    returnTarget: resolvedReturnTarget.value,
  })
}

function createInvoice() {
  setPage('InvoiceCreate', {
    returnTarget: resolvedReturnTarget.value,
  })
}
</script>
