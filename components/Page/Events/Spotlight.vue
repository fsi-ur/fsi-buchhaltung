<template>
  <CommonSpotlight
    :loading="loading"
    :is-empty="!active"
    empty-icon="material-symbols:event-busy-rounded"
    :empty-text="t('event.spotlight.none')"
    :title="active?.name"
  >
    <template #badge>
      <span
        class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
        :class="active?.status === 'past' ? 'bg-white/10 text-base-200' : 'bg-accent-500/20 text-accent-200'"
      >
        <span class="h-1.5 w-1.5 rounded-full" :class="active?.status === 'past' ? 'bg-base-400' : 'bg-accent-400'" />
        {{ activeLabel }}
      </span>
    </template>

    <template v-if="canToggle" #toggle>
      <div class="inline-flex rounded-lg bg-white/10 p-0.5 text-xs font-medium">
        <button
          type="button"
          class="cursor-pointer rounded-md px-3 py-1.5 transition"
          :class="view === 'upcoming' ? 'bg-white text-base-900' : 'text-base-200 hover:text-white'"
          @click="view = 'upcoming'"
        >
          {{ t('event.spotlight.toggleUpcoming') }}
        </button>
        <button
          type="button"
          class="cursor-pointer rounded-md px-3 py-1.5 transition"
          :class="view === 'latest' ? 'bg-white text-base-900' : 'text-base-200 hover:text-white'"
          @click="view = 'latest'"
        >
          {{ t('event.spotlight.toggleLatest') }}
        </button>
      </div>
    </template>

    <template #subtitle>
      <p v-if="countdownLabel" class="mt-1 flex items-center gap-1.5 text-sm text-base-300">
        <Icon name="material-symbols:schedule-rounded" class="text-base text-base-400" />
        {{ countdownLabel }}
      </p>
    </template>

    <template #action>
      <div class="flex shrink-0 items-center gap-2">
        <PageWikiHelpButton dark />

        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition not-disabled:cursor-pointer not-disabled:hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canOpenActive"
          @click="active && $emit('open', active.id)"
        >
          <Icon name="material-symbols:open-in-new-rounded" class="text-base" />
          {{ t('actions.open') }}
        </button>
      </div>
    </template>

    <template v-if="active">
      <!-- Body -->
      <div class="grid gap-4" :class="hasSidePanel ? 'md:grid-cols-[1fr_1.1fr]' : ''">
        <!-- Event facts -->
        <dl
          class="grid grid-cols-2 gap-x-4 gap-y-3 self-start"
          :class="hasSidePanel ? '' : 'md:grid-cols-4'"
        >
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

          <div class="col-span-2">
            <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('event.organizers') }}</dt>
            <dd class="mt-1 flex flex-wrap gap-1.5">
              <span
                v-for="org in organizerLabels"
                :key="org"
                class="inline-flex items-center rounded-md bg-base-100 px-2 py-0.5 text-xs text-base-700"
              >{{ org }}</span>
              <span v-if="!organizerLabels.length" class="text-sm text-base-400">{{ t('event.noOrganizersShort') }}</span>
            </dd>
          </div>

          <div class="col-span-2">
            <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('event.costCentres') }}</dt>
            <dd class="mt-1 flex flex-wrap gap-1.5">
              <span
                v-for="split in active.cost_centre_splits"
                :key="split.cost_centre_id"
                class="inline-flex items-center rounded-md bg-base-100 px-2 py-0.5 text-xs text-base-700"
              >{{ split.code }} · {{ Number(split.allocation_percentage).toFixed(0) }}%</span>
              <span v-if="!active.cost_centre_splits.length" class="text-sm text-base-400">{{ t('event.noCostCentresShort') }}</span>
            </dd>
          </div>
        </dl>

        <!-- Planning summary (only when the user may view planning details) -->
        <div v-if="active.planning && showPlanning" class="rounded-xl border border-base-200 bg-base-50/60 p-4">
          <button
            type="button"
            class="-m-1 block w-[calc(100%+0.5rem)] rounded-lg p-1 text-left transition not-disabled:cursor-pointer not-disabled:hover:bg-base-100/70 disabled:cursor-default"
            :disabled="!canOpenActive"
            @click="openTab('overview')"
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
            <span class="mt-1 block text-xs text-base-500">
              {{ active.status === 'past'
                ? t('event.spotlight.recapHint', { pct: active.planning.readiness })
                : t('event.planning.completedPercent', { pct: active.planning.readiness }) }}
            </span>
          </button>

          <div class="mt-3 grid grid-cols-2 gap-2">
            <button
              v-for="tile in summaryTiles"
              :key="tile.label"
              type="button"
              class="rounded-lg bg-white p-2.5 text-left shadow-sm transition not-disabled:cursor-pointer not-disabled:hover:shadow-md disabled:cursor-default"
              :disabled="!canOpenActive"
              @click="openTab(tile.tab)"
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
          :shifts="active.shiftOverview"
          :status="active.status"
          :can-open="canOpenActive"
          @open="openTab('shifts')"
        />
      </div>
    </template>
  </CommonSpotlight>
</template>

<script setup lang="ts">
import { useEventSpotlightAccess } from '~/composables/useEventSpotlightAccess'
import { useI18n } from '~/composables/useI18n'
import type { GetEventSpotlightResponse } from '~/server/api/events/spotlight.get'
import type { EventSpotlight } from '~/types/event'
import type { EventPlanningTabKey } from './planning/types'

const emit = defineEmits<{ (e: 'open', eventId: number, tab?: EventPlanningTabKey): void }>()

const { t } = useI18n()

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

const { statusLabel: activeLabel, countdownLabel, rangeLabel, organizerLabels, summaryTiles } = useEventSpotlightView(active)
const { canOpenActive, showPlanning, showShiftOverview } = useEventSpotlightAccess(active)

const hasSidePanel = computed(() => showPlanning.value || showShiftOverview.value)

function openTab(tab: EventPlanningTabKey) {
  if (active.value && canOpenActive.value) emit('open', active.value.id, tab)
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
