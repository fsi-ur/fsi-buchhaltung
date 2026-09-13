<template>
  <Page :headline1="t('calendar.title')" help-section="calendar" @open-menu="$emit('openMenu')">
    <template #header>
      <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
        <PageAuditTableHistoryButton
          :tables="['appointments', 'appointment_types', 'appointment_subdivisions', 'appointment_members', 'appointment_occurrence_overrides', 'appointment_responses']"
        />

        <CommonSegmentedControl
          v-model="view"
          :options="viewOptions"
          :aria-label="t('calendar.views.label')"
          class="hidden xl:inline-flex"
        />

        <button
          v-if="canCreate"
          type="button"
          class="btn-primary"
          @click="createAppointment()"
        >
          + {{ t('calendar.newAppointment') }}
        </button>
      </div>
    </template>

    <template #cards>
      <section class="col-span-12 -mx-6 isolate bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
        <div ref="headerSentinelRef" class="h-px" />
        <!-- Period stepper + source filter -->
        <div
          class="sticky top-0 z-20 border-b border-base-200 bg-white p-4 transition-[border-radius] sm:p-5"
          :class="isHeaderStuck ? '' : 'sm:rounded-t-xl'"
        >
          <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
            <!-- Unlike month/week, list is a continuous feed rather than a period the arrows step
                 through — the stepper/today controls don't apply to it. -->
            <template v-if="view !== 'list'">
              <div class="flex items-center gap-2">
                <div class="flex items-center overflow-hidden rounded-lg border border-base-200">
                  <button
                    type="button"
                    class="flex h-8 w-8 cursor-pointer items-center justify-center border-r border-base-200 text-base-500 transition hover:bg-base-100 hover:text-base-800"
                    :aria-label="t('calendar.previous')"
                    :title="t('calendar.previous')"
                    @click="step(-1)"
                  >
                    <Icon name="material-symbols:chevron-left-rounded" class="text-lg" />
                  </button>
                  <button
                    type="button"
                    class="flex h-8 w-8 cursor-pointer items-center justify-center text-base-500 transition hover:bg-base-100 hover:text-base-800"
                    :aria-label="t('calendar.next')"
                    :title="t('calendar.next')"
                    @click="step(1)"
                  >
                    <Icon name="material-symbols:chevron-right-rounded" class="text-lg" />
                  </button>
                </div>

                <!-- Disabled while the shown period already holds today, so it reads as "you are here". -->
                <button
                  type="button"
                  class="rounded-lg border border-base-200 px-3 py-1.5 text-xs font-semibold transition"
                  :class="isCurrentPeriod
                    ? 'cursor-default bg-base-50 text-base-400'
                    : 'cursor-pointer text-base-700 hover:bg-base-50 hover:text-base-900'"
                  :disabled="isCurrentPeriod"
                  @click="goToToday"
                >
                  {{ t('calendar.today') }}
                </button>
              </div>

              <h2 class="text-lg font-semibold text-base-900 sm:text-xl">{{ periodLabel }}</h2>
            </template>
            <h2 v-else class="text-lg font-semibold text-base-900 sm:text-xl">{{ t('calendar.views.list') }}</h2>

            <button
              type="button"
              class="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition xl:hidden"
              :class="activeFilterCount
                ? 'border-accent-200 bg-accent-50 text-accent-700'
                : 'border-base-200 text-base-600 hover:bg-base-50'"
              :aria-expanded="showFilters"
              @click="showFilters = !showFilters"
            >
              <Icon name="material-symbols:filter-alt" class="text-sm" />
              {{ activeFilterCount ? t('calendar.filtersActive', { count: activeFilterCount }) : t('calendar.filters') }}
              <Icon
                name="material-symbols:expand-more-rounded"
                class="text-sm transition"
                :class="showFilters ? 'rotate-180' : ''"
              />
            </button>

            <div class="hidden xl:ml-auto xl:block">
              <PageCalendarSourceFilter
                v-model="sourceFilter"
                :appointment-types="appointmentTypes"
              />
            </div>
          </div>

          <div v-if="showFilters" class="mt-3 border-t border-base-100 pt-3 xl:hidden">
            <PageCalendarSourceFilter
              v-model="sourceFilter"
              :appointment-types="appointmentTypes"
            />
          </div>
        </div>

        <div class="p-4 sm:p-5">
          <CommonValidationSummary
            v-if="loadError"
            class="mb-4"
            :errors="[loadError]"
            :title="t('calendar.validation.summaryTitle')"
          />

          <div class="xl:hidden">
            <PageCalendarAgendaList
              :entries="listEntries"
              :loading="loading"
              :is-filtered="isFiltered"
              @open="openEntry"
            />

            <div v-if="view === 'list' && !loading && canLoadMoreList" class="mt-3 text-center">
              <button
                type="button"
                class="btn-secondary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-70"
                :disabled="loadingMore"
                @click="loadMoreList"
              >
                <Icon v-if="loadingMore" name="material-symbols:progress-activity" class="animate-spin text-base" />
                {{ t('calendar.loadMore') }}
              </button>
            </div>
          </div>

          <div class="hidden xl:block">
            <PageCalendarMonthGrid
              v-if="view === 'month'"
              :anchor="anchor"
              :entries="visibleEntries"
              :loading="loading"
              :can-create="canCreate"
              @open="openEntry"
              @create="createAppointment"
              @expand-day="expandDay"
              @open-week="openWeek"
            />

            <PageCalendarWeekGrid
              v-else-if="view === 'week'"
              :anchor="anchor"
              :entries="visibleEntries"
              :loading="loading"
              :can-create="canCreate"
              @open="openEntry"
              @create="createAppointment"
            />

            <template v-else>
              <PageCalendarAgendaList
                :entries="listEntries"
                :loading="loading"
                :is-filtered="isFiltered"
                @open="openEntry"
              />

              <div v-if="!loading && canLoadMoreList" class="mt-3 text-center">
                <button
                  type="button"
                  class="btn-secondary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-70"
                  :disabled="loadingMore"
                  @click="loadMoreList"
                >
                  <Icon v-if="loadingMore" name="material-symbols:progress-activity" class="animate-spin text-base" />
                  {{ t('calendar.loadMore') }}
                </button>
              </div>
            </template>

            <p v-if="view !== 'list'" class="mt-3 text-right text-xs text-base-400">{{ t('calendar.shortcuts') }}</p>
          </div>
        </div>
      </section>
    </template>
  </Page>

  <PageCalendarOccurrenceModal
    v-model="showDetail"
    :entry="selectedEntry"
    @close="closeDetail"
    @edit="onEditRequested"
    @delete="onDeleteRequested"
    @responded="refreshSelectedEntry"
    @cancel-toggled="refreshSelectedEntry"
    @cancel-requested="onCancelRequested"
  />

  <PageCalendarEditScopeDialog
    v-model="showScopeDialog"
    :mode="scopeDialogMode"
    @confirm="onScopeConfirmed"
    @cancel="showScopeDialog = false"
  />

  <!-- Day overflow ("+N weitere"): the same agenda list, scoped to one day. -->
  <CommonModal
    v-model="showDayModal"
    :title="expandedDayLabel"
    width-class="max-w-lg"
    @close="showDayModal = false"
  >
    <PageCalendarAgendaList :entries="expandedDayEntries" @open="openFromDayModal" />

    <template #footer>
      <button class="btn-secondary" @click="showDayModal = false">{{ t('actions.close') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import {
  applySourceFilter,
  CALENDAR_SOURCES,
  dayKeyOf,
  groupEntriesByDay,
  loadSourceFilter,
  nowInBerlin,
  parseDayKey,
  saveSourceFilter,
  shiftAnchor,
  toDayKey,
  todayKey,
  windowForView,
  type CalendarSourceFilter,
  type CalendarViewMode,
} from '~/composables/useCalendarView'
import type { GetCalendarEntriesResponse } from '~/server/api/calendar/entries.get'
import type { AppointmentEditScope, AppointmentTypeRow, CalendarEntry } from '~/types/appointment'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t, locale } = useI18n()
const { hasPermission } = useAuth()
const toast = useToast()
const { pageMeta, setPage } = usePage()
const { formatDayHeading } = useLocaleFormatters()

const canCreate = computed(() => hasPermission('calendar.create'))

// The grids are hidden below xl anyway, so a narrow viewport starts on the agenda list. Decided at
// setup time rather than in onMounted so the first load already asks for the right window.
const view = ref<CalendarViewMode>(
  typeof window !== 'undefined' && window.innerWidth < 1280 ? 'list' : 'month',
)
// A real day, not forced to the 1st: the month grid normalizes internally regardless of which day
// of the month `anchor` points at, and keeping it as "today" is what makes switching straight from
// the initial month view to week view land on the current week instead of the week containing the
// 1st.
const anchor = ref(nowInBerlin())
const entries = ref<CalendarEntry[]>([])
const appointmentTypes = ref<AppointmentTypeRow[]>([])
const loading = ref(true)
const loadError = ref('')

const sourceFilter = ref<CalendarSourceFilter>(loadSourceFilter())

const showDetail = ref(false)
const selectedEntry = ref<CalendarEntry | null>(null)
const showScopeDialog = ref(false)
const scopeDialogMode = ref<'edit' | 'delete' | 'cancel'>('edit')
const showDayModal = ref(false)
const expandedDayKey = ref('')
const showFilters = ref(false)
const headerSentinelRef = ref<HTMLElement | null>(null)
const isHeaderStuck = ref(false)
let headerStickyObserver: IntersectionObserver | null = null

/**
 * The list view fetches only as much of its rolling horizon as needed to know for certain whether
 * there is a next page: after loading, the window keeps growing in small steps and re-fetching
 * until either the database has actually returned more entries than the current page can show, or
 * the horizon cap is hit — never a blind "assume there's more" cap-based guess, and never an eager
 * fetch of the entire multi-year horizon up front.
 */
const LIST_HORIZON_MONTHS = 24
const LIST_WINDOW_STEP_MONTHS = 3
const LIST_PAGE_SIZE = 30
const listVisibleCount = ref(LIST_PAGE_SIZE)
const listWindowMonths = ref(LIST_WINDOW_STEP_MONTHS)

const viewOptions = computed(() => ([
  { value: 'month', label: t('calendar.views.month') },
  { value: 'week', label: t('calendar.views.week') },
  { value: 'list', label: t('calendar.views.list') },
]))

const visibleEntries = computed(() => applySourceFilter(entries.value, sourceFilter.value))
const isFiltered = computed(() => visibleEntries.value.length !== entries.value.length)

/** How many toggles are switched off — the number the collapsed filter button carries on mobile. */
const activeFilterCount = computed(() => {
  const hiddenSources = CALENDAR_SOURCES.length - sourceFilter.value.sources.length
  const hiddenTypes = sourceFilter.value.typeIds === null
    ? 0
    : Math.max(0, appointmentTypes.value.length - sourceFilter.value.typeIds.length)
  return hiddenSources + hiddenTypes
})

/** Whether the shown period already contains today, which is what greys out the "today" button. */
const isCurrentPeriod = computed(() => {
  const { from, to } = windowForView(anchor.value, view.value)
  const today = todayKey()
  return today >= dayKeyOf(from) && today <= dayKeyOf(to)
})

const periodLabel = computed(() => {
  const date = anchor.value
  if (view.value === 'week') {
    const { from, to } = windowForView(date, 'week')
    return `${formatShortDate(from)} – ${formatShortDate(to)}`
  }
  return new Date(date).toLocaleDateString(locale.value, { month: 'long', year: 'numeric', timeZone: 'UTC' })
})

const expandedDayEntries = computed(() => groupEntriesByDay(visibleEntries.value).get(expandedDayKey.value) ?? [])
const expandedDayLabel = computed(() => expandedDayKey.value ? formatDayHeading(expandedDayKey.value) : '')

/** The list view's own entries, capped for rendering — `canLoadMoreList` compares against this. */
const listEntries = computed(() => view.value === 'list'
  ? visibleEntries.value.slice(0, listVisibleCount.value)
  : visibleEntries.value)
const canLoadMoreList = computed(() => view.value === 'list' && visibleEntries.value.length > listVisibleCount.value)

/**
 * Deliberately its own flag, not `loading`: `loading` drives AgendaList's full skeleton state,
 * which would replace the already-rendered rows and read as the whole page reloading (and jump
 * the scroll position with it). "Load more" should only ever add rows below what's already there.
 */
const loadingMore = ref(false)

async function loadMoreList() {
  listVisibleCount.value += LIST_PAGE_SIZE
  loadingMore.value = true
  try {
    await growListWindowIfNeeded()
  } catch {
    toast.error(t('calendar.loadFailed'))
  } finally {
    loadingMore.value = false
  }
}

function formatShortDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale.value, {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })
}

function step(direction: -1 | 1) {
  anchor.value = shiftAnchor(anchor.value, view.value, direction)
}

function goToToday() {
  anchor.value = nowInBerlin()
}

function openEntry(entry: CalendarEntry) {
  selectedEntry.value = entry
  showDetail.value = true
}

/**
 * A response or a cancel/reactivate toggle changes fields that live on the *entry* object from the
 * last `load()` (the yes/no/maybe/pending counts; `isCancelled`) — reloading refreshes `entries`,
 * but `selectedEntry` still pointed at the stale pre-reload object, so the open modal sat frozen on
 * the old values until it was closed and reopened. Re-pointing it at the matching fresh entry is
 * what actually makes it update while the modal stays open.
 */
async function refreshSelectedEntry() {
  await load()
  if (!selectedEntry.value) return
  const key = selectedEntry.value.key
  selectedEntry.value = entries.value.find(entry => entry.key === key) ?? selectedEntry.value
}

function openFromDayModal(entry: CalendarEntry) {
  showDayModal.value = false
  openEntry(entry)
}

function closeDetail() {
  showDetail.value = false
  selectedEntry.value = null
}

function expandDay(dayKey: string) {
  expandedDayKey.value = dayKey
  showDayModal.value = true
}

function openWeek(dayKey: string) {
  anchor.value = parseDayKey(dayKey)
  view.value = 'week'
}

function createAppointment(dayKey?: string) {
  // Pre-fill the clicked day, keeping the current time-of-day behaviour to the editor's defaults.
  setPage('AppointmentCreate', {
    ...(dayKey ? { presetDate: dayKey } : {}),
    returnTarget: buildReturnTarget('Calendar'),
  })
}

function openEditor(entry: CalendarEntry, scope: AppointmentEditScope) {
  setPage('AppointmentCreate', {
    appointmentId: entry.id,
    occurrenceDate: entry.occurrenceDate,
    editScope: scope,
    returnTarget: buildReturnTarget('Calendar'),
  })
}

function onEditRequested(entry: CalendarEntry, isSeries: boolean) {
  selectedEntry.value = entry
  if (!isSeries) {
    showDetail.value = false
    openEditor(entry, 'series')
    return
  }
  scopeDialogMode.value = 'edit'
  showScopeDialog.value = true
}

function onDeleteRequested(entry: CalendarEntry, isSeries: boolean) {
  selectedEntry.value = entry
  if (!isSeries) {
    showDetail.value = false
    void deleteAppointment(entry, 'series')
    return
  }
  scopeDialogMode.value = 'delete'
  showScopeDialog.value = true
}

function onCancelRequested(entry: CalendarEntry, isSeries: boolean) {
  selectedEntry.value = entry
  if (!isSeries) {
    showDetail.value = false
    void cancelAppointment(entry, 'series')
    return
  }
  scopeDialogMode.value = 'cancel'
  showScopeDialog.value = true
}

async function onScopeConfirmed(scope: AppointmentEditScope) {
  const entry = selectedEntry.value
  showScopeDialog.value = false
  if (!entry) return

  if (scopeDialogMode.value === 'delete') {
    showDetail.value = false
    await deleteAppointment(entry, scope)
    return
  }

  if (scopeDialogMode.value === 'cancel') {
    showDetail.value = false
    await cancelAppointment(entry, scope)
    return
  }

  showDetail.value = false
  openEditor(entry, scope)
}

async function deleteAppointment(entry: CalendarEntry, scope: AppointmentEditScope) {
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/appointments/${entry.id}`, {
      method: 'DELETE',
      body: { scope, occurrenceDate: entry.occurrenceDate },
    })

    if (!res.ok) {
      toast.error(res.error || t('calendar.form.deleteFailed'))
      return
    }

    toast.success(t('calendar.form.deleted'))
    closeDetail()
    await load()
  } catch {
    toast.error(t('calendar.form.deleteFailed'))
  }
}

async function cancelAppointment(entry: CalendarEntry, scope: AppointmentEditScope) {
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/appointments/${entry.id}/cancel`, {
      method: 'POST',
      body: { cancelled: true, scope, occurrenceDate: entry.occurrenceDate },
    })

    if (!res.ok) {
      toast.error(res.error || t('calendar.detail.cancelFailed'))
      return
    }

    toast.success(t('calendar.detail.cancelled'))
    closeDetail()
    await load()
  } catch {
    toast.error(t('calendar.detail.cancelFailed'))
  }
}

function listWindow(months: number) {
  const today = nowInBerlin()
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months, today.getUTCDate()))
  return { from: `${toDayKey(today)} 00:00:00`, to: `${toDayKey(to)} 23:59:59` }
}

async function fetchWindow(window: { from: string, to: string }) {
  const res = await $fetch<GetCalendarEntriesResponse>('/api/calendar/entries', {
    query: { from: window.from, to: window.to },
  })
  if (!res.ok) throw new Error(res.error || t('calendar.loadFailed'))
  entries.value = res.entries
  appointmentTypes.value = res.appointmentTypes
}

async function growListWindowIfNeeded() {
  while (visibleEntries.value.length <= listVisibleCount.value && listWindowMonths.value < LIST_HORIZON_MONTHS) {
    listWindowMonths.value = Math.min(LIST_HORIZON_MONTHS, listWindowMonths.value + LIST_WINDOW_STEP_MONTHS)
    await fetchWindow(listWindow(listWindowMonths.value))
  }
}

async function load() {
  loading.value = true
  loadError.value = ''

  try {
    if (view.value === 'list') {
      await fetchWindow(listWindow(listWindowMonths.value))
      await growListWindowIfNeeded()
    } else {
      await fetchWindow(windowForView(anchor.value, view.value))
    }
  } catch (err) {
    entries.value = []
    loadError.value = err instanceof Error ? err.message : t('calendar.loadFailed')
  } finally {
    loading.value = false
  }
}

/** A notification deep link carries the occurrence it is about; open that entry straight away. */
function applyDeepLink() {
  const appointmentId = Number(pageMeta.value?.appointmentId)
  const occurrenceDate = pageMeta.value?.occurrenceDate as string | undefined
  if (!Number.isFinite(appointmentId) || appointmentId <= 0) return

  if (occurrenceDate) anchor.value = parseDayKey(dayKeyOf(occurrenceDate))

  const match = entries.value.find(entry => entry.source === 'appointment'
    && entry.id === appointmentId
    && (!occurrenceDate || entry.occurrenceDate === occurrenceDate))

  if (match) openEntry(match)
}

watch(sourceFilter, (value) => {
  saveSourceFilter(value)
}, { deep: true })

watch([anchor, view], (_next, previous) => {
  // Entering list view fresh starts its rolling horizon over, rather than keeping whatever a
  // previous visit to list view had already extended it to via "load more".
  if (view.value === 'list' && previous?.[1] !== 'list') {
    listVisibleCount.value = LIST_PAGE_SIZE
    listWindowMonths.value = LIST_WINDOW_STEP_MONTHS
  }
  load()
})

watch(() => [pageMeta.value?.appointmentId, pageMeta.value?.occurrenceDate], async () => {
  if (!pageMeta.value?.appointmentId) return
  const occurrenceDate = pageMeta.value?.occurrenceDate as string | undefined
  if (occurrenceDate) anchor.value = parseDayKey(dayKeyOf(occurrenceDate))
  await load()
  applyDeepLink()
})

function onKeydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (showDetail.value || showScopeDialog.value || showDayModal.value) return

  const target = event.target as HTMLElement | null
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return

  if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
  else if (event.key.toLowerCase() === 'h') goToToday()
  else return

  event.preventDefault()
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)

  if (headerSentinelRef.value) {
    headerStickyObserver = new IntersectionObserver((observerEntries) => {
      isHeaderStuck.value = !observerEntries[0]?.isIntersecting
    })
    headerStickyObserver.observe(headerSentinelRef.value)
  }

  const occurrenceDate = pageMeta.value?.occurrenceDate as string | undefined
  if (occurrenceDate) anchor.value = parseDayKey(dayKeyOf(occurrenceDate))
  await load()
  applyDeepLink()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  headerStickyObserver?.disconnect()
})

useAppRefresh().onRefresh(load)
</script>
