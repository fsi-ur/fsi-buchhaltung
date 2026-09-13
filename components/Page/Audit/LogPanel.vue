<template>
  <CommonPageTableCard
    :title="t('audit.title')"
    :search-value="search"
    :search-placeholder="t('audit.searchPlaceholder')"
    @update:search-value="search = $event"
  >
    <template #actions>
      <button
        type="button"
        class="btn-secondary inline-flex items-center gap-1.5 lg:hidden"
        :aria-expanded="filtersOpen"
        aria-controls="audit-filter-panel"
        @click="filtersOpen = !filtersOpen"
      >
        <Icon name="material-symbols:filter-alt" class="h-4 w-4" aria-hidden="true" />
        {{ t('audit.filters.title') }}
        <span v-if="activeChips.length" class="rounded-full bg-secondary-600 px-1.5 text-[11px] font-semibold text-white">
          {{ activeChips.length }}
        </span>
      </button>
    </template>

    <div class="space-y-3">
      <div
        id="audit-filter-panel"
        class="rounded-xl border border-base-200 bg-base-50/60 p-3 sm:p-4"
        :class="filtersOpen ? 'block' : 'hidden lg:block'"
      >
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="sm:col-span-2">
            <span class="mb-1 block text-xs font-medium text-base-500">{{ t('audit.filters.range') }}</span>
            <CommonSegmentedControl
              v-model="quickRangeValue"
              :options="quickRangeOptions"
              :aria-label="t('audit.filters.range')"
            />
          </div>

          <div class="sm:col-span-2">
            <span class="mb-1 block text-xs font-medium text-base-500">{{ t('audit.filters.operation') }}</span>
            <CommonSegmentedControl
              v-model="operationFilterValue"
              :options="operationOptions"
              :aria-label="t('audit.filters.operation')"
            />
          </div>

          <div>
            <span class="mb-1 block text-xs font-medium text-base-500">{{ t('audit.filters.domain') }}</span>
            <CommonSearchSelect
              v-model="domainQuery"
              :options="domainOptions"
              :selected-label="domainLabel"
              :placeholder="t('audit.filters.allDomains')"
              :empty-text="t('audit.filters.noMatches')"
              @select="onSelectDomain"
              @clear-selection="clearDomain"
            />
          </div>

          <div class="xl:col-span-2">
            <span class="mb-1 block text-xs font-medium text-base-500">{{ t('audit.filters.table') }}</span>
            <CommonSearchSelect
              v-model="tableQuery"
              :options="tableOptions"
              :placeholder="tableFilter.length ? t('audit.filters.addTable') : t('audit.filters.allTables')"
              :empty-text="t('audit.filters.noMatches')"
              menu-width="wide"
              option-class="overflow-hidden text-ellipsis"
              @select="addTable"
            />
            <!-- Tables combine, so the picker stays empty after each pick and the current selection
                 lives below it — one removable chip per table. -->
            <div v-if="tableFilter.length" class="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                v-for="table in tableFilter"
                :key="table"
                class="inline-flex items-center gap-1 rounded-md bg-white py-1 pl-2 pr-1 text-xs font-medium text-base-700 ring-1 ring-base-200"
              >
                {{ tableLabel(table) }}
                <button
                  type="button"
                  class="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-base-400 transition hover:bg-base-100 hover:text-base-700"
                  :title="t('audit.filters.remove', { label: tableLabel(table) })"
                  :aria-label="t('audit.filters.remove', { label: tableLabel(table) })"
                  @click="removeTable(table)"
                >
                  <Icon name="material-symbols:close-rounded" class="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </div>
          </div>

          <div>
            <span class="mb-1 block text-xs font-medium text-base-500">{{ t('audit.filters.actor') }}</span>
            <CommonSearchSelect
              v-model="actorQuery"
              :options="actorOptions"
              :placeholder="userFilter.length ? t('audit.filters.addActor') : t('audit.filters.allActors')"
              :empty-text="t('audit.filters.noMatches')"
              @select="addActor"
            />
            <div v-if="userFilter.length" class="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                v-for="actor in userFilter"
                :key="String(actor)"
                class="inline-flex items-center gap-1 rounded-md bg-white py-1 pl-2 pr-1 text-xs font-medium text-base-700 ring-1 ring-base-200"
              >
                {{ actorLabel(actor) }}
                <button
                  type="button"
                  class="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-base-400 transition hover:bg-base-100 hover:text-base-700"
                  :title="t('audit.filters.remove', { label: actorLabel(actor) })"
                  :aria-label="t('audit.filters.remove', { label: actorLabel(actor) })"
                  @click="removeActor(actor)"
                >
                  <Icon name="material-symbols:close-rounded" class="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Every active filter stays visible as a removable chip, so a narrowed result set is never
           silently caused by a control that scrolled out of view (or is collapsed on mobile). -->
      <div v-if="activeChips.length" class="flex flex-wrap items-center gap-2">
        <span
          v-for="chip in activeChips"
          :key="chip.key"
          class="inline-flex items-center gap-1 rounded-md bg-secondary-50 py-1 pl-2 pr-1 text-xs font-medium text-secondary-800"
        >
          {{ chip.label }}
          <button
            type="button"
            class="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-secondary-500 transition hover:bg-secondary-100 hover:text-secondary-800"
            :title="t('audit.filters.remove', { label: chip.label })"
            :aria-label="t('audit.filters.remove', { label: chip.label })"
            @click="chip.clear()"
          >
            <Icon name="material-symbols:close-rounded" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>

        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-base-500 transition hover:bg-base-100 hover:text-base-800"
          @click="resetFilters"
        >
          <Icon name="material-symbols:filter-alt-off-rounded" class="h-4 w-4" aria-hidden="true" />
          {{ t('audit.filters.reset') }}
        </button>
      </div>

      <PageAuditTimeline
        :groups="groups"
        :loading="loading"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :filtered="isFiltered"
        return-page="AuditLog"
        @load-more="loadMore"
        @reset-filters="resetFilters"
      />
    </div>
  </CommonPageTableCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { useAuditLog } from '~/composables/useAuditLog'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { AuditFilterOptions } from '~/types/audit'
import type { GetAuditFiltersResponse } from '~/server/api/audit/filters.get'

const { t } = useI18n()
const { pageMeta } = usePage()
const {
  groups, loading, loadingMore, hasMore,
  search, quickRange, domainFilter, tableFilter, operationFilter, userFilter,
  load, loadMore,
} = useAuditLog()

const filterOptions = ref<AuditFilterOptions | null>(null)
const filtersOpen = ref(false)

// The typeahead inputs hold free text; these mirror the committed filter value and are reset
// explicitly wherever a filter is cleared from outside the input (chips, reset, domain cascade).
const domainQuery = ref('')
const tableQuery = ref('')
const actorQuery = ref('')

// Arriving from a "show everything that changed here" button pre-selects those tables; they are
// ordinary selections from here on, so each one can be removed individually.
if (Array.isArray(pageMeta.value?.tables) && pageMeta.value.tables.length) {
  tableFilter.value = [...pageMeta.value.tables]
  quickRange.value = 'all'
}

function tableLabel(table: string) {
  const option = (filterOptions.value?.tables ?? []).find(o => o.table === table)
  return option ? t(option.labelKey) : table
}

const quickRangeOptions = computed(() => [
  { value: 'today', label: t('audit.quickRange.today') },
  { value: '7d', label: t('audit.quickRange.7d') },
  { value: '30d', label: t('audit.quickRange.30d') },
  { value: 'all', label: t('audit.quickRange.all') },
])

const quickRangeValue = computed({
  get: () => quickRange.value as string,
  set: (value: string) => { quickRange.value = value as typeof quickRange.value },
})

// Only three, mutually exclusive, short labels — a segmented control shows all of them at once
// instead of hiding them behind a closed menu.
const operationOptions = computed(() => [
  { value: '', label: t('audit.filters.allOperations') },
  { value: 'insert', label: t('audit.operations.insert') },
  { value: 'update', label: t('audit.operations.update') },
  { value: 'delete', label: t('audit.operations.delete') },
])

const operationFilterValue = computed({
  get: () => operationFilter.value[0] ?? '',
  set: (value: string) => { operationFilter.value = value ? [value] : [] },
})

const domainOptions = computed<SearchSelectOption<string>[]>(() =>
  (filterOptions.value?.domains ?? []).map(d => ({
    key: d.key,
    label: t(`audit.domains.${d.key}`),
    value: d.key,
  })),
)

const domainLabel = computed(() => (domainFilter.value.length ? t(`audit.domains.${domainFilter.value[0]}`) : ''))

function tablesForDomain(domain: string) {
  return (filterOptions.value?.tables ?? []).filter(tbl => tbl.domain === domain)
}

// Picking a domain narrows the (very long) table list to that domain's tables instead of leaving
// the user to scroll past entries the domain filter already excludes.
const tableOptions = computed<SearchSelectOption<string>[]>(() => {
  const all = filterOptions.value?.tables ?? []
  const scoped = domainFilter.value.length ? all.filter(tbl => domainFilter.value.includes(tbl.domain)) : all
  return scoped.filter(tbl => !tableFilter.value.includes(tbl.table)).map(tbl => ({
    key: tbl.table,
    label: t(tbl.labelKey),
    value: tbl.table,
    // Searchable by domain and by raw table name, which is what an admin reading a schema knows.
    searchText: `${t(`audit.domains.${tbl.domain}`)} ${tbl.table}`,
  }))
})

const actorOptions = computed<SearchSelectOption<string>[]>(() =>
  (filterOptions.value?.actors ?? [])
    .map(a => ({
      key: String(a.id ?? 'system'),
      label: a.username || t('audit.systemActor'),
      value: String(a.id ?? 'system'),
    }))
    .filter(option => !userFilter.value.some(actor => String(actor) === option.key)),
)

function actorLabel(actor: number | 'system') {
  if (actor === 'system') return t('audit.systemActor')
  const match = (filterOptions.value?.actors ?? []).find(a => a.id === actor)
  return match?.username || String(actor)
}

function onSelectDomain(value: unknown) {
  domainFilter.value = [String(value)]
  domainQuery.value = domainLabel.value
  // A table from another domain would keep filtering the list while its input shows a label the
  // narrowed option list no longer offers — drop it in the same tick, so only one reload fires.
  if (tableFilter.value.length) {
    const allowed = new Set(tablesForDomain(String(value)).map(tbl => tbl.table))
    tableFilter.value = tableFilter.value.filter(table => allowed.has(table))
  }
}

function clearDomain() {
  domainFilter.value = []
  domainQuery.value = ''
}

function addTable(value: unknown) {
  const table = String(value)
  if (!tableFilter.value.includes(table)) tableFilter.value = [...tableFilter.value, table]
  // Empty the input again so the next table can be searched straight away.
  tableQuery.value = ''
}

function removeTable(table: string) {
  tableFilter.value = tableFilter.value.filter(entry => entry !== table)
}

function clearTables() {
  tableFilter.value = []
  tableQuery.value = ''
}

function addActor(value: unknown) {
  const actor: number | 'system' = value === 'system' ? 'system' : Number(value)
  if (!userFilter.value.includes(actor)) userFilter.value = [...userFilter.value, actor]
  // Empty the input again so the next person can be searched straight away.
  actorQuery.value = ''
}

function removeActor(actor: number | 'system') {
  userFilter.value = userFilter.value.filter(entry => entry !== actor)
}

function clearActors() {
  userFilter.value = []
  actorQuery.value = ''
}

const activeChips = computed(() => {
  const chips: Array<{ key: string, label: string, clear: () => void }> = []

  if (search.value.trim()) {
    chips.push({
      key: 'search',
      label: t('audit.filters.searchChip', { value: search.value.trim() }),
      clear: () => { search.value = '' },
    })
  }
  if (quickRange.value !== '30d') {
    chips.push({
      key: 'range',
      label: `${t('audit.filters.range')}: ${t(`audit.quickRange.${quickRange.value}`)}`,
      clear: () => { quickRange.value = '30d' },
    })
  }
  if (domainFilter.value.length) {
    chips.push({
      key: 'domain',
      label: `${t('audit.filters.domain')}: ${domainLabel.value}`,
      clear: clearDomain,
    })
  }
  for (const table of tableFilter.value) {
    chips.push({
      key: `table:${table}`,
      label: `${t('audit.filters.table')}: ${tableLabel(table)}`,
      clear: () => removeTable(table),
    })
  }
  if (operationFilter.value.length) {
    chips.push({
      key: 'operation',
      label: `${t('audit.filters.operation')}: ${t(`audit.operations.${operationFilter.value[0]}`)}`,
      clear: () => { operationFilter.value = [] },
    })
  }
  for (const actor of userFilter.value) {
    chips.push({
      key: `actor:${actor}`,
      label: `${t('audit.filters.actor')}: ${actorLabel(actor)}`,
      clear: () => removeActor(actor),
    })
  }

  return chips
})

const isFiltered = computed(() => activeChips.value.length > 0)

function resetFilters() {
  search.value = ''
  quickRange.value = '30d'
  operationFilter.value = []
  clearDomain()
  clearTables()
  clearActors()
}

// Typing in the search box shouldn't fire a request per keystroke.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(), 300)
})

watch([quickRange, domainFilter, tableFilter, operationFilter, userFilter], () => load(), { deep: true })

onMounted(async () => {
  load()
  const res = await $fetch<GetAuditFiltersResponse>('/api/audit/filters')
  if (res.ok) {
    filterOptions.value = res
    // Labels only resolve once the options arrive; seed the inputs for a preset/restored filter.
    domainQuery.value = domainLabel.value
  }
})

useAppRefresh().onRefresh(load)
</script>
