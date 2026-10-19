<template>
  <PageHomeWidgetFrame
    :title="t('home.widgets.events.title')"
    icon="material-symbols:event-rounded"
    :loading="loading"
    :is-empty="!active"
    empty-icon="material-symbols:event-busy-rounded"
    :empty-text="t('event.spotlight.none')"
  >
    <template #action>
      <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <div v-if="canToggle" class="inline-flex rounded-lg bg-white/10 p-0.5 text-xs font-medium">
          <button
            type="button"
            class="cursor-pointer rounded-md px-2.5 py-1 transition"
            :class="view === 'upcoming' ? 'bg-white text-base-900' : 'text-base-200 hover:text-white'"
            @click="view = 'upcoming'"
          >
            {{ t('event.spotlight.toggleUpcoming') }}
          </button>
          <button
            type="button"
            class="cursor-pointer rounded-md px-2.5 py-1 transition"
            :class="view === 'latest' ? 'bg-white text-base-900' : 'text-base-200 hover:text-white'"
            @click="view = 'latest'"
          >
            {{ t('event.spotlight.toggleLatest') }}
          </button>
        </div>

        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-base-200 transition cursor-pointer hover:bg-white/20 hover:text-white"
          @click="setPage('Events')"
        >
          {{ t('home.widgets.showAll') }}
          <Icon name="material-symbols:arrow-forward-rounded" class="text-sm" />
        </button>
      </div>
    </template>

    <div v-if="active" class="flex h-full flex-col gap-4">
      <!-- Status + name -->
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            :class="active.status === 'past' ? 'bg-base-100 text-base-600' : 'bg-accent-100 text-accent-700'"
          >
            <span class="h-1.5 w-1.5 rounded-full" :class="active.status === 'past' ? 'bg-base-400' : 'bg-accent-500'" />
            {{ statusLabel }}
          </span>
          <span v-if="countdownLabel" class="flex items-center gap-1 text-xs text-base-500">
            <Icon name="material-symbols:schedule-rounded" class="text-sm text-base-400" />
            {{ countdownLabel }}
          </span>
        </div>

        <button
          type="button"
          class="mt-1.5 flex w-full items-center gap-1.5 text-left"
          :class="canOpenActive ? 'cursor-pointer' : 'cursor-default'"
          :disabled="!canOpenActive"
          @click="openActive()"
        >
          <span class="truncate text-lg font-semibold text-base-900" :class="{ 'hover:underline': canOpenActive }">{{ active.name }}</span>
          <Icon
            v-if="canOpenActive"
            name="material-symbols:open-in-new-rounded"
            class="shrink-0 text-base text-base-400"
          />
        </button>
      </div>

      <!-- Event facts -->
      <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div class="col-span-2">
          <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('event.startsOn') }} – {{ t('event.endsOn') }}</dt>
          <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-base-800">
            <Icon name="material-symbols:event-rounded" class="shrink-0 text-base text-base-400" />
            <span>{{ rangeLabel }}</span>
          </dd>
        </div>

        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('event.location') }}</dt>
          <dd class="mt-0.5 flex items-center gap-1.5 text-sm text-base-800">
            <Icon name="material-symbols:location-on-rounded" class="shrink-0 text-base text-base-400" />
            <span class="truncate">{{ active.location || t('event.planning.locationMissing') }}</span>
          </dd>
        </div>

        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('event.expectedGuests') }}</dt>
          <dd class="mt-0.5 flex items-center gap-1.5 text-sm text-base-800">
            <Icon name="material-symbols:groups-rounded" class="shrink-0 text-base text-base-400" />
            <span>{{ active.expected_guests != null ? active.expected_guests : t('event.planning.guestsMissing') }}</span>
          </dd>
        </div>
      </dl>

      <!-- Planning summary (only when the user may view planning details) -->
      <div v-if="active.planning && showPlanning" class="mt-auto rounded-xl border border-base-200 bg-base-50/60 p-4">
        <button
          type="button"
          class="-m-1 block w-[calc(100%+0.5rem)] rounded-lg p-1 text-left transition not-disabled:cursor-pointer not-disabled:hover:bg-base-100/70 disabled:cursor-default"
          :disabled="!canOpenActive"
          @click="openActive('overview')"
        >
          <span class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-1.5 text-sm font-semibold text-base-700">
              <Icon
                :name="active.status === 'past' ? 'material-symbols:history-rounded' : 'material-symbols:checklist-rtl-rounded'"
                class="text-base text-accent-500"
              />
              {{ active.status === 'past' ? t('event.spotlight.recap') : t('event.spotlight.planningState') }}
            </span>
            <span class="text-sm font-semibold text-base-900">{{ active.planning.readiness }}%</span>
          </span>

          <span class="mt-2 block h-2 overflow-hidden rounded-full bg-base-200">
            <span
              class="block h-full rounded-full transition-all"
              :class="active.status === 'past' ? 'bg-base-400' : 'bg-accent-500'"
              :style="{ width: `${active.planning.readiness}%` }"
            />
          </span>
        </button>

        <div class="mt-3 grid grid-cols-2 gap-2">
          <button
            v-for="tile in summaryTiles"
            :key="tile.label"
            type="button"
            class="rounded-lg bg-white p-2.5 text-left shadow-sm transition not-disabled:cursor-pointer not-disabled:hover:shadow-md disabled:cursor-default"
            :disabled="!canOpenActive"
            @click="openActive(tile.tab)"
          >
            <span class="flex items-center gap-1 text-xs text-base-500">
              <Icon :name="tile.icon" class="shrink-0 text-sm" :class="tile.variant === 'ok' ? 'text-success-500' : tile.variant === 'warning' ? 'text-warning-500' : 'text-base-400'" />
              <span class="truncate">{{ tile.label }}</span>
            </span>
            <span class="mt-0.5 block text-sm font-semibold text-base-800">{{ tile.value }}</span>
          </button>
        </div>
      </div>

      <!-- Shift overview (signup users without planning access) -->
      <PageEventsSpotlightShifts
        v-else-if="active.shiftOverview && showShiftOverview"
        class="mt-auto"
        :shifts="active.shiftOverview"
        :status="active.status"
        :can-open="canOpenActive"
        @open="openActive('shifts')"
      />
    </div>
  </PageHomeWidgetFrame>
</template>

<script setup lang="ts">
import { useEventSpotlightAccess } from '~/composables/useEventSpotlightAccess'
import { useI18n } from '~/composables/useI18n'
import type { GetEventSpotlightResponse } from '~/server/api/events/spotlight.get'
import type { EventSpotlight } from '~/types/event'
import type { EventPlanningTabKey } from '~/components/Page/Events/planning/types'

const { t } = useI18n()
const { setPage } = usePage()

type SpotlightView = 'upcoming' | 'latest'

const loading = ref(true)
const upcoming = ref<EventSpotlight | null>(null)
const latest = ref<EventSpotlight | null>(null)
const view = ref<SpotlightView>('upcoming')

const canToggle = computed(() => Boolean(upcoming.value && latest.value))

const active = computed<EventSpotlight | null>(() => {
  if (view.value === 'latest' && latest.value) return latest.value
  return upcoming.value ?? latest.value
})

const { statusLabel, countdownLabel, rangeLabel, summaryTiles } = useEventSpotlightView(active)
const { canOpenActive, showPlanning, showShiftOverview } = useEventSpotlightAccess(active)

function openActive(tab?: EventPlanningTabKey) {
  if (!active.value || !canOpenActive.value) return
  setPage('EventCreate', {
    eventId: active.value.id,
    ...(tab ? { tab } : {}),
    returnTarget: buildReturnTarget('Home'),
  })
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch<GetEventSpotlightResponse>('/api/events/spotlight')
    if (res.ok) {
      upcoming.value = res.upcoming
      latest.value = res.latest
      view.value = res.upcoming ? 'upcoming' : 'latest'
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)
useAppRefresh().onRefresh(load)
</script>
