<template>
  <CommonPageTableCard
    :title="t('reimbursement.stored')"
    persist-key="reimbursements-list"
    :search-value="search"
    :search-placeholder="t('reimbursement.search')"
    :can-create="canEdit"
    :create-label="`+ ${t('reimbursement.new')}`"
    @update:search-value="search = $event"
    @create="createReimbursement"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['reimbursements', 'reimbursement_positions']" />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="reimbursements-list"
      :rows="reimbursements"
      :columns="columns"
      :empty-text="t('reimbursement.none')"
      @row-open="openReimbursement($event.id)"
    >
      <template #cell-status="{ row }">
        <CommonStatusBadge :label="statusLabels[status(row)]" :tone="statusTone(status(row))" />
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
import { ReimbursementStatus, type ReimbursementOverview } from '~/types/reimbursement'

const props = defineProps<{
  returnTarget?: PageTarget | null
}>()

const { setPage } = usePage()
const { t } = useI18n()
const { formatDate, formatCurrency } = useLocaleFormatters()
const { hasPermission } = useAuth()

const canEdit = computed(() => hasPermission('reimbursements.edit'))
const resolvedReturnTarget = computed(() => cloneReturnTarget(props.returnTarget) ?? buildReturnTarget('ReimbursementList'))

const reimbursements = ref<ReimbursementOverview[]>([])
const loading = ref(true)
const search = ref('')

const statusLabels = computed<Record<ReimbursementStatus, string>>(() => ({
  submitted: t('reimbursement.states.submitted'),
  checked: t('reimbursement.states.checked'),
  disbursed: t('reimbursement.states.disbursed'),
  cancelled: t('reimbursement.states.cancelled'),
}))

const columns = computed<AdvancedTableColumn<ReimbursementOverview>[]>(() => [
  {
    key: 'submitted_at',
    label: t('reimbursement.submitted'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.submitted_at,
    format: row => formatDate(row.submitted_at),
    mobile: 'title',
  },
  {
    key: 'checked_at',
    label: t('reimbursement.checked'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.checked_at,
    format: row => row.checked_at ? formatDate(row.checked_at) : t('common.notAvailable'),
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
  {
    key: 'disbursed_at',
    label: t('reimbursement.disbursed'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.disbursed_at,
    format: row => row.disbursed_at ? formatDate(row.disbursed_at) : t('common.notAvailable'),
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
  {
    key: 'member_name',
    label: t('reimbursement.submittedBy'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.member_name,
    format: row => row.member_name || t('common.notAvailable'),
    mobileLabel: true,
  },
  {
    key: 'receipt_count',
    label: t('reimbursement.receiptCount'),
    filterType: 'number',
    getValue: row => row.receipt_count,
    headerClass: 'text-right',
    cellClass: 'text-right font-medium',
    mobileLabel: true,
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
    label: t('member.status'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => statusLabels.value[status(row)],
    headerClass: 'text-center',
    cellClass: 'text-center',
    mobileLabel: true,
  },
])

onMounted(async () => {
  try {
    const res = await apiFetch<ApiResponse<'/api/reimbursements'>>('/api/reimbursements')
    if (res.ok) {
      reimbursements.value = res.reimbursements
    } else {
      console.log(res.error)
    }
  } finally {
    loading.value = false
  }
})

function status(reimbursement: ReimbursementOverview): ReimbursementStatus {
  if (reimbursement.disbursed_at) return ReimbursementStatus.Disbursed
  if (reimbursement.checked_at) return ReimbursementStatus.Checked
  if (reimbursement.submitted_at) return ReimbursementStatus.Submitted
  return ReimbursementStatus.Cancelled
}

function statusTone(statusValue: ReimbursementStatus) {
  switch (statusValue) {
    case ReimbursementStatus.Submitted:
      return 'base'
    case ReimbursementStatus.Checked:
      return 'warning'
    case ReimbursementStatus.Disbursed:
      return 'success'
    case ReimbursementStatus.Cancelled:
      return 'dangerCancelled'
    default:
      return 'baseMuted'
  }
}

function openReimbursement(id: number) {
  setPage('ReimbursementCreate', {
    reimbursementId: id,
    returnTarget: resolvedReturnTarget.value,
  })
}

function createReimbursement() {
  setPage('ReimbursementCreate', {
    returnTarget: resolvedReturnTarget.value,
  })
}
</script>
