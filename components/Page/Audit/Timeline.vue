<template>
  <div class="space-y-4">
    <!-- Skeleton rows instead of a bare spinner: the list keeps its shape while the first page loads. -->
    <div v-if="loading && !groups.length" class="space-y-2" aria-busy="true">
      <div v-for="n in 4" :key="n" class="flex items-center gap-3 rounded-xl border border-base-200 p-3 sm:p-4">
        <span class="h-8 w-8 shrink-0 animate-pulse rounded-full bg-base-100" />
        <span class="min-w-0 flex-1 space-y-2">
          <span class="block h-3 w-2/5 animate-pulse rounded bg-base-100" />
          <span class="block h-3 w-3/5 animate-pulse rounded bg-base-100" />
        </span>
      </div>
    </div>

    <div v-else-if="!groups.length" class="flex flex-col items-center gap-2 py-12 text-center">
      <Icon name="material-symbols:history-rounded" class="h-10 w-10 text-base-300" aria-hidden="true" />
      <p class="text-sm text-base-500">{{ filtered ? t('audit.emptyFiltered') : t('audit.empty') }}</p>
      <button v-if="filtered" type="button" class="btn-secondary mt-1 inline-flex items-center gap-1.5" @click="$emit('resetFilters')">
        <Icon name="material-symbols:filter-alt-off-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('audit.resetFilters') }}
      </button>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-base-500">
          {{ t('audit.loadedCount', { count: totalEntries }) }}<span v-if="hasMore">, {{ t('audit.moreLoadable') }}</span>
        </p>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-secondary-700 transition hover:bg-secondary-50"
          @click="toggleAll"
        >
          <Icon :name="allExpanded ? 'material-symbols:unfold-less-rounded' : 'material-symbols:unfold-more-rounded'" class="h-4 w-4" aria-hidden="true" />
          {{ allExpanded ? t('audit.collapseAll') : t('audit.expandAll') }}
        </button>
      </div>

      <!-- Dim (but keep) the current list while a filter change reloads, so the page doesn't jump. -->
      <div class="space-y-6 transition-opacity" :class="loading ? 'pointer-events-none opacity-40' : ''">
        <section v-for="day in days" :key="day.key" class="space-y-2">
          <h3 class="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 bg-white/95 px-1 py-1.5 backdrop-blur">
            <span class="text-xs font-semibold uppercase tracking-wide text-base-600">{{ day.label }}</span>
            <span class="text-xs font-normal text-base-400">{{ t('audit.entriesCount', { count: day.entryCount }) }}</span>
          </h3>

          <div class="overflow-hidden rounded-xl border border-base-200">
            <div
              v-for="group in day.groups"
              :key="group.key"
              class="border-t border-base-100 first:border-t-0"
              :class="isExpanded(group.key) ? 'bg-base-50/40' : ''"
            >
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition hover:bg-base-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-secondary-500 sm:p-4"
                :aria-expanded="isExpanded(group.key)"
                :aria-controls="panelId(group.key)"
                @click="toggle(group.key)"
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" :class="toneClass(groupTone(group))">
                  <Icon :name="toneIcon(groupTone(group))" class="h-4 w-4" aria-hidden="true" />
                </span>

                <span class="min-w-0 flex-1 space-y-0.5">
                  <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="truncate text-sm font-semibold text-base-900">{{ actorLabel(group) }}</span>
                    <span class="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium" :class="toneChipClass(groupTone(group))">
                      {{ t(`audit.operations.${groupTone(group)}`) }}
                    </span>
                    <span class="min-w-0 truncate text-sm text-base-700">
                      {{ entityLabel(group.entries[0]) }}
                      <span v-if="group.entries[0]?.description" class="text-base-500">&bdquo;{{ group.entries[0]!.description }}&ldquo;</span>
                    </span>
                    <span v-if="group.entries.length > 1" class="shrink-0 text-xs text-base-500">+{{ group.entries.length - 1 }}</span>
                  </span>
                  <span class="flex flex-wrap items-center gap-x-2 text-xs text-base-400">
                    <span>{{ formatTime(group.changedAt) }}</span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{{ formatRelativeTime(group.changedAt) }}</span>
                    <template v-if="totalFieldCount(group)">
                      <span aria-hidden="true">&middot;</span>
                      <span>{{ t('audit.changedFieldsCount', { count: totalFieldCount(group) }) }}</span>
                    </template>
                  </span>
                </span>

                <Icon
                  name="material-symbols:expand-more-rounded"
                  class="h-5 w-5 shrink-0 text-base-400 transition-transform"
                  :class="isExpanded(group.key) ? 'rotate-180' : ''"
                  aria-hidden="true"
                />
                <span class="sr-only">{{ isExpanded(group.key) ? t('audit.hideDetails') : t('audit.showDetails') }}</span>
              </button>

              <div v-if="isExpanded(group.key)" :id="panelId(group.key)" class="space-y-2 border-t border-base-100 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
                <div v-for="entry in group.entries" :key="entry.id" class="rounded-lg border border-base-200 bg-white p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-md px-1.5 py-0.5 text-[11px] font-medium" :class="toneChipClass(entry.operation)">
                      {{ t(`audit.operations.${entry.operation}`) }}
                    </span>
                    <p class="min-w-0 text-sm font-medium text-base-800">
                      {{ entityLabel(entry) }}
                      <span v-if="entry.description" class="font-normal text-base-600">&bdquo;{{ entry.description }}&ldquo;</span>
                    </p>
                  </div>

                  <div v-if="entry.operation === 'delete'" class="mt-2">
                    <button
                      v-if="hasSnapshot(entry)"
                      type="button"
                      class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-secondary-700 transition hover:bg-secondary-50"
                      :aria-expanded="snapshotExpanded.includes(entry.id)"
                      @click="toggleSnapshot(entry.id)"
                    >
                      <Icon
                        name="material-symbols:expand-more-rounded"
                        class="h-4 w-4 transition-transform"
                        :class="snapshotExpanded.includes(entry.id) ? 'rotate-180' : ''"
                        aria-hidden="true"
                      />
                      {{ snapshotExpanded.includes(entry.id) ? t('audit.deletedSnapshotHide') : t('audit.deletedSnapshotToggle') }}
                    </button>
                    <dl v-if="snapshotExpanded.includes(entry.id)" class="mt-2 divide-y divide-base-100 rounded-lg bg-base-50 px-2.5">
                      <div v-for="[column, value] in Object.entries(entry.deletedSnapshot || {})" :key="column" class="grid grid-cols-1 gap-x-3 py-1.5 text-xs sm:grid-cols-[minmax(0,11rem)_1fr]">
                        <dt class="font-medium text-base-500">{{ fieldLabel(entry.table, column) }}</dt>
                        <dd class="min-w-0 break-words text-base-700">{{ displayValue(value) }}</dd>
                      </div>
                    </dl>
                  </div>

                  <dl v-else-if="entry.fields.length" class="mt-2 divide-y divide-base-100">
                    <div v-for="field in entry.fields" :key="field.column" class="grid grid-cols-1 gap-x-3 gap-y-1 py-1.5 text-xs sm:grid-cols-[minmax(0,11rem)_1fr]">
                      <dt class="font-medium text-base-500">{{ field.labelKey ? t(field.labelKey) : field.fallbackLabel }}</dt>
                      <dd class="min-w-0 break-words text-base-800">
                        <span v-if="field.redacted" class="italic text-base-400">{{ t('audit.redacted') }}</span>
                        <template v-else>
                          <span
                            v-if="hasBefore(field)"
                            class="inline rounded bg-danger-50 px-1.5 py-0.5 text-danger-800 line-through decoration-danger-300"
                            :title="t('audit.valueBefore')"
                          >{{ fieldDisplay(field, 'before') }}</span>
                          <Icon
                            v-if="hasBefore(field)"
                            name="material-symbols:arrow-right-alt-rounded"
                            class="mx-1 inline h-4 w-4 align-[-3px] text-base-400"
                            aria-hidden="true"
                          />
                          <span
                            class="inline rounded bg-success-50 px-1.5 py-0.5 font-medium text-success-800"
                            :title="t('audit.valueAfter')"
                          >{{ fieldDisplay(field, 'after') }}</span>
                        </template>
                      </dd>
                    </div>
                  </dl>

                  <p v-else class="mt-2 text-xs italic text-base-400">{{ t('audit.noFieldChanges') }}</p>

                  <div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-base-100 pt-2">
                    <span class="text-[11px] text-base-400">
                      {{ t('audit.recordLabel', { entity: entityLabel(entry), id: String(Object.values(entry.primaryKey)[0] ?? '') }) }}
                    </span>
                    <button
                      v-if="entry.openPage && !hideOpenPage"
                      type="button"
                      class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-secondary-700 transition hover:bg-secondary-50"
                      @click="openRecord(entry)"
                    >
                      {{ t('audit.showRecord') }}
                      <Icon name="material-symbols:open-in-new-rounded" class="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <div v-if="hasMore && groups.length" class="flex justify-center pt-2">
      <button type="button" class="btn-secondary inline-flex items-center gap-1.5" :disabled="loadingMore" @click="$emit('loadMore')">
        <Icon
          :name="loadingMore ? 'material-symbols:progress-activity' : 'material-symbols:expand-more-rounded'"
          class="h-4 w-4"
          :class="loadingMore ? 'animate-spin' : ''"
          aria-hidden="true"
        />
        {{ t('audit.loadMore') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { useReturnTarget } from '~/composables/useReturnTarget'
import type { AuditEntry, AuditGroup } from '~/types/audit'
import { addDaysToLocalDate } from '~/shared/time'

const props = withDefaults(defineProps<{
  groups: AuditGroup[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  filtered?: boolean
  /** Page this timeline is shown on, used to build a return target for "open record" links. */
  returnPage?: string
  /**
   * Hides "open record" links entirely. Used inside a record's own history panel, where the link
   * would navigate to the very page it's already shown on (usually behind a modal).
   */
  hideOpenPage?: boolean
}>(), {
  loading: false,
  loadingMore: false,
  hasMore: false,
  filtered: false,
  returnPage: undefined,
  hideOpenPage: false,
})

defineEmits<{
  (e: 'loadMore'): void
  (e: 'resetFilters'): void
}>()

const { t } = useI18n()
const { formatDate, formatDateTime, formatTime, formatDayHeading, formatRelativeTime, formatCurrency, localDayKey } = useLocaleFormatters()
const { today } = useAppTimeZone()
const { setPage } = usePage()
const { returnTarget } = useReturnTarget((props.returnPage as any) ?? 'AuditLog')

const expanded = ref<string[]>([])
const snapshotExpanded = ref<number[]>([])

function isExpanded(key: string) {
  return expanded.value.includes(key)
}

function panelId(key: string) {
  return `audit-group-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function toggle(key: string) {
  expanded.value = isExpanded(key) ? expanded.value.filter(k => k !== key) : [...expanded.value, key]
}

const allExpanded = computed(() => props.groups.length > 0 && props.groups.every(g => expanded.value.includes(g.key)))

function toggleAll() {
  expanded.value = allExpanded.value ? [] : props.groups.map(g => g.key)
}

function toggleSnapshot(id: number) {
  snapshotExpanded.value = snapshotExpanded.value.includes(id) ? snapshotExpanded.value.filter(i => i !== id) : [...snapshotExpanded.value, id]
}

function totalFieldCount(group: AuditGroup) {
  return group.entries.reduce((sum, entry) => sum + entry.fields.length, 0)
}

const totalEntries = computed(() => props.groups.reduce((sum, group) => sum + group.entries.length, 0))

function hasSnapshot(entry: AuditEntry) {
  return Boolean(entry.deletedSnapshot && Object.keys(entry.deletedSnapshot).length)
}

function hasBefore(field: AuditEntry['fields'][number]) {
  return field.before !== null && field.before !== undefined
}

function groupTone(group: AuditGroup): 'insert' | 'update' | 'delete' {
  const ops = new Set(group.entries.map(e => e.operation))
  if (ops.size === 1) return group.entries[0]!.operation
  return 'update'
}

// The three operations must stay visually distinct — insert previously shared cyan with update,
// since `secondary` is aliased to cyan in the theme.
function toneClass(tone: 'insert' | 'update' | 'delete') {
  if (tone === 'insert') return 'bg-success-100 text-success-700'
  if (tone === 'delete') return 'bg-danger-100 text-danger-700'
  return 'bg-secondary-100 text-secondary-700'
}

function toneChipClass(tone: 'insert' | 'update' | 'delete') {
  if (tone === 'insert') return 'bg-success-50 text-success-700'
  if (tone === 'delete') return 'bg-danger-50 text-danger-700'
  return 'bg-secondary-50 text-secondary-700'
}

function toneIcon(tone: 'insert' | 'update' | 'delete') {
  if (tone === 'insert') return 'material-symbols:add-circle-rounded'
  if (tone === 'delete') return 'material-symbols:delete-rounded'
  return 'material-symbols:edit-rounded'
}

function actorLabel(group: AuditGroup) {
  return group.changedBy.displayName || group.changedBy.username || t('audit.systemActor')
}

function entityLabel(entry?: AuditEntry) {
  return entry ? t(entry.entityLabelKey) : ''
}

function fieldLabel(table: string, column: string) {
  const key = `audit.fields.${table}.${column}`
  const translated = t(key)
  if (translated !== key) return translated
  const common = t(`audit.fields.common.${column}`)
  if (common !== `audit.fields.common.${column}`) return common
  return column.replace(/_/g, ' ')
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return String(value)
}

function fieldDisplay(field: AuditEntry['fields'][number], which: 'before' | 'after') {
  const raw = which === 'before' ? field.before : field.after
  const label = which === 'before' ? field.beforeLabel : field.afterLabel
  if (raw === null || raw === undefined) return '—'
  if (field.kind === 'reference') {
    // Show both the human-readable name and the raw id where a name was actually resolved, so an
    // auditor can always cross-reference the exact database row even if the label looks ambiguous.
    if (label && label !== `#${raw}`) return `${label} (#${raw})`
    return label ?? `#${raw}`
  }
  if (field.kind === 'money') return formatCurrency(Number(raw))
  if (field.kind === 'date') return formatDate(String(raw))
  if (field.kind === 'datetime') return formatDateTime(String(raw))
  if (field.kind === 'bool') return raw ? '✓' : '✗'
  if (field.kind === 'json') return typeof raw === 'string' ? raw.slice(0, 200) : JSON.stringify(raw).slice(0, 200)
  const text = String(raw)
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

function openRecord(entry: AuditEntry) {
  if (!entry.openPage) return
  setPage(entry.openPage.page as any, { ...entry.openPage.meta, returnTarget: returnTarget.value })
}

function dayLabel(dayKey: string) {
  const todayKey = today()
  if (dayKey === todayKey) return t('audit.today')
  if (dayKey === addDaysToLocalDate(todayKey, -1)) return t('audit.yesterday')
  return formatDayHeading(dayKey)
}

const days = computed(() => {
  const byDay = new Map<string, AuditGroup[]>()
  for (const group of props.groups) {
    const key = localDayKey(group.changedAt)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(group)
  }
  return Array.from(byDay.entries()).map(([key, groups]) => ({
    key,
    label: dayLabel(key),
    entryCount: groups.reduce((sum, g) => sum + g.entries.length, 0),
    groups,
  }))
})
</script>
