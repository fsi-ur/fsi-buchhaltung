<template>
  <CommonPageTableCard
    :title="t('cashCount.stored')"
    persist-key="cash-counts-list"
    :search-value="search"
    :search-placeholder="t('cashCount.search')"
    :can-create="canEdit"
    :create-label="`+ ${t('cashCount.new')}`"
    @update:search-value="search = $event"
    @create="createCashCount"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['cash_counts', 'cash_count_positions']" />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="cash-counts-list"
      :rows="cashCounts"
      :columns="columns"
      :empty-text="t('cashCount.none')"
      @row-open="openCashCount($event.id)"
    >
      <template #cell-event_name="{ row }">
        <span
          v-if="!row.event_name"
          class="inline-flex rounded-md bg-base-100 px-2 py-1 text-xs font-medium text-base-700"
        >
          {{ t('cashCount.registerCheck') }}
        </span>
        <span v-else>{{ row.event_name }}</span>
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
import type { CashCountOverview } from '~/types/cashCount'

const props = defineProps<{
  returnTarget?: PageTarget | null
}>()

type CashCountListRow = CashCountOverview & {
  counters_label: string
}

const { setPage } = usePage()
const { t } = useI18n()
const { formatCurrency, formatDateTime } = useLocaleFormatters()
const { hasPermission } = useAuth()

const canEdit = computed(() => hasPermission('cash_counts.edit'))
const resolvedReturnTarget = computed(() => cloneReturnTarget(props.returnTarget) ?? buildReturnTarget('CashCountList'))

const cashCounts = ref<CashCountListRow[]>([])
const loading = ref(true)
const search = ref('')

const columns = computed<AdvancedTableColumn<CashCountListRow>[]>(() => [
  {
    key: 'counted_before_at',
    label: t('cashCount.countedBeforeAt'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.counted_before_at || '',
    format: row => row.counted_before_at ? formatDateTime(row.counted_before_at) : '-',
    mobileLabel: true,
  },
  {
    key: 'counted_after_at',
    label: t('cashCount.countedAfterAt'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.counted_after_at,
    format: row => formatDateTime(row.counted_after_at),
    mobileLabel: true,
  },
  {
    key: 'event_name',
    label: t('cashCount.event'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.event_name || t('cashCount.registerCheck'),
    mobile: 'title',
  },
  {
    key: 'counters_label',
    label: t('cashCount.counters'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.counters_label,
    mobileLabel: true,
  },
  {
    key: 'checked_by_name',
    label: t('cashCount.checkedBy'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.checked_by_name,
    format: row => row.checked_by_name || t('common.notAvailable'),
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
  {
    key: 'register_count',
    label: t('cashCount.registerCount'),
    filterType: 'number',
    getValue: row => row.register_count,
    headerClass: 'text-right',
    cellClass: 'text-right font-medium',
    mobileLabel: true,
  },
  {
    key: 'total_difference',
    label: t('cashCount.totalDifference'),
    filterType: 'number',
    getValue: row => row.total_difference,
    format: row => formatCurrency(row.total_difference),
    headerClass: 'text-right',
    cellClass: 'text-right font-medium',
    mobileLabel: true,
  },
])

onMounted(async () => {
  try {
    const res = await apiFetch<ApiResponse<'/api/cash_counts'>>('/api/cash_counts')
    if (res.ok) {
      cashCounts.value = res.cashCounts.map((entry: CashCountOverview) => ({
        ...entry,
        counters_label: [entry.counted_by_first_name, entry.counted_by_second_name].filter(Boolean).join(' / '),
      }))
    } else {
      console.log(res.error)
    }
  } finally {
    loading.value = false
  }
})

function openCashCount(id: number) {
  setPage('CashCountCreate', {
    cashCountId: id,
    returnTarget: resolvedReturnTarget.value,
  })
}

function createCashCount() {
  setPage('CashCountCreate', {
    returnTarget: resolvedReturnTarget.value,
  })
}
</script>
