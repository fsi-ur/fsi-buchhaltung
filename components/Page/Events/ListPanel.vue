<template>
  <PageEventsSpotlight @open="openEvent" />

  <CommonPageTableCard
    :title="t('event.stored')"
    persist-key="events-list"
    :search-value="search"
    :search-placeholder="t('event.search')"
    :can-create="canEdit"
    :create-label="`+ ${t('event.new')}`"
    @update:search-value="search = $event"
    @create="createEvent"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['events']" />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="events-list"
      :rows="events"
      :columns="columns"
      :empty-text="t('event.none')"
      :can-open-row="entry => canOpenEvent(entry.id)"
      @row-open="openEvent($event.id)"
    />
  </CommonPageTableCard>
</template>

<script setup lang="ts">
import type { PageTarget } from '~/types/page'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget, cloneReturnTarget } from '~/composables/useReturnTarget'
import type { Event } from '~/types/event'
import type { EventPlanningTabKey } from './planning/types'

const props = defineProps<{
  returnTarget?: PageTarget | null
}>()

const { setPage } = usePage()
const { hasPermission, resolveFlag, isSimulating } = useAuth()
const { t } = useI18n()
const { formatDateTime } = useLocaleFormatters()

const canEdit = computed(() => hasPermission('events.edit'))
const resolvedReturnTarget = computed(() => cloneReturnTarget(props.returnTarget) ?? buildReturnTarget('Events'))

const events = ref<Event[]>([])
const loading = ref(true)
const canOpenAll = ref(true)
const organizerEventIds = ref(new Set<number>())
const search = ref('')

function canOpenEvent(eventId: number) {
  return canOpenAll.value || organizerEventIds.value.has(eventId)
}

const columns = computed<AdvancedTableColumn<Event>[]>(() => [
  {
    key: 'name',
    label: t('event.name'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.name,
    cellClass: 'font-medium',
    mobile: 'title',
  },
  {
    key: 'starts_at',
    label: t('event.startsOn'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.starts_at,
    format: row => formatDateTime(row.starts_at),
    mobileLabel: true,
  },
  {
    key: 'ends_at',
    label: t('event.endsOn'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.ends_at,
    format: row => formatDateTime(row.ends_at),
    mobileLabel: true,
  },
  {
    key: 'location',
    label: t('event.location'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.location,
    format: row => row.location || t('common.notAvailable'),
  },
  {
    key: 'expected_guests',
    label: t('event.expectedGuests'),
    filterType: 'number',
    getValue: row => row.expected_guests,
    mobileLabel: true,
  },
  {
    key: 'organizers',
    label: t('event.organizers'),
    filterType: 'text',
    globalSearchable: true,
    sortable: false,
    filterable: false,
    getValue: row => organizerSummary(row),
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
  {
    key: 'cost_centres',
    label: t('event.costCentres'),
    filterType: 'text',
    globalSearchable: true,
    sortable: false,
    filterable: false,
    getValue: row => costCentreSummary(row),
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
])

onMounted(async () => {
  try {
    const res = await $fetch('/api/events')
    if (res.ok) {
      events.value = res.events
      canOpenAll.value = resolveFlag(res.canOpenAll, ['events.view', 'events.edit', 'events.shifts.signup'])
      organizerEventIds.value = isSimulating() ? new Set() : new Set(res.organizerEventIds)
    }
  } finally {
    loading.value = false
  }
})

function organizerSummary(entry: Event) {
  const subdivisions = entry.subdivision_organizers.map(organizer => `${organizer.code} - ${organizer.name}`)
  const members = entry.member_organizers.map(organizer => organizer.full_name)
  const labels = [...subdivisions, ...members]

  if (!labels.length) return t('event.noOrganizersShort')
  if (labels.length <= 2) return labels.join(', ')

  return [
    ...labels.slice(0, 2),
    `+ ${labels.length - 2}`,
  ].join(', ')
}

function costCentreSummary(entry: Event) {
  if (!entry.cost_centre_splits.length) return t('event.noCostCentresShort')

  if (entry.cost_centre_splits.length === 1) {
    const split = entry.cost_centre_splits[0]
    return split
      ? `${split.code} - ${split.name} (${Number(split.allocation_percentage).toFixed(2)}%)`
      : t('event.noCostCentresShort')
  }

  const sortedSplits = [...entry.cost_centre_splits].sort((left, right) => {
    return Number(right.allocation_percentage) - Number(left.allocation_percentage)
      || left.code.localeCompare(right.code, undefined, { sensitivity: 'base' })
  })

  const labels = sortedSplits
    .slice(0, 2)
    .map(split => `${split.code} (${Number(split.allocation_percentage).toFixed(2)}%)`)

  if (sortedSplits.length <= 2) return labels.join(', ')

  return [
    ...labels,
    `+ ${sortedSplits.length - 2}`,
  ].join(', ')
}

function openEvent(id: number, tab?: EventPlanningTabKey) {
  setPage('EventCreate', {
    eventId: id,
    ...(tab ? { tab } : {}),
    returnTarget: resolvedReturnTarget.value,
  })
}

function createEvent() {
  setPage('EventCreate', {
    returnTarget: resolvedReturnTarget.value,
  })
}
</script>
