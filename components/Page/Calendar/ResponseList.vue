<template>
  <section>
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h4 class="text-xs font-semibold uppercase tracking-wide text-base-400">{{ t('calendar.detail.participants') }}</h4>
      <span v-if="participants.length" class="text-xs font-medium text-base-500">
        {{ t('calendar.responses.answeredOf', { answered: answeredCount, total: participants.length }) }}
      </span>
    </div>

    <template v-if="participants.length">
      <div class="mb-2 flex h-2 overflow-hidden rounded-full bg-base-100" aria-hidden="true">
        <div
          v-for="group in barSegments"
          :key="group.key"
          :class="group.barClass"
          :style="{ width: `${(group.count / participants.length) * 100}%` }"
        />
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('calendar.responses.filterLabel')">
          <button
            v-for="group in GROUPS"
            :key="group.key"
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition"
            :class="expanded && filter === group.key ? group.activeChipClass : 'border-base-200 bg-white text-base-600 hover:bg-base-50'"
            :aria-pressed="expanded && filter === group.key"
            :title="t(`calendar.responses.groups.${group.key}`)"
            @click="selectGroup(group.key)"
          >
            <Icon :name="group.icon" class="text-[13px]" :class="expanded && filter === group.key ? '' : group.headingClass" />
            <span class="hidden sm:inline">{{ t(`calendar.responses.groups.${group.key}`) }}</span>
            <span>{{ counts[group.key] }}</span>
          </button>
        </div>

        <button
          type="button"
          class="ml-auto inline-flex cursor-pointer items-center gap-0.5 rounded-md px-2 py-0.5 text-xs font-medium text-link-600 hover:bg-link-50"
          :aria-expanded="expanded"
          @click="toggleExpanded"
        >
          {{ expanded ? t('calendar.responses.hide') : t('calendar.responses.show') }}
          <Icon :name="expanded ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'" class="text-base" />
        </button>
      </div>

      <template v-if="expanded">
        <div v-if="showSearch" class="relative mt-2">
          <Icon name="material-symbols:search-rounded" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-base-400" />
          <input
            v-model="search"
            type="search"
            class="input w-full pl-9"
            :placeholder="t('calendar.responses.search')"
            :aria-label="t('calendar.responses.search')"
          />
        </div>

        <div
          v-if="visibleGroups.length"
          class="scroll-panel mt-2 max-h-72 overflow-y-auto overscroll-none rounded-xl border border-base-200"
        >
          <div v-for="group in visibleGroups" :key="group.key">
            <h5 class="sticky top-0 z-10 flex items-center gap-1.5 border-b border-base-100 bg-base-50 px-3 py-1.5 text-xs font-semibold" :class="group.headingClass">
              <Icon :name="group.icon" class="text-sm" />
              {{ t(`calendar.responses.groups.${group.key}`) }}
              <span class="font-medium text-base-400">{{ group.rows.length }}</span>
              <span v-if="group.key === 'open' && group.unconfirmed" class="ml-auto font-medium text-base-400">
                {{ t('calendar.detail.unconfirmedCount', { count: group.unconfirmed }) }}
              </span>
            </h5>

            <ul class="grid gap-x-4 px-3 py-1.5 sm:grid-cols-2">
              <li
                v-for="participant in group.rows"
                :key="participant.id"
                class="flex min-w-0 items-start justify-between gap-2 py-1 text-sm"
              >
                <span class="min-w-0">
                  <span class="block truncate text-base-800">{{ participant.name }}</span>
                  <span v-if="participant.comment" class="block truncate text-xs text-base-500" :title="participant.comment">
                    „{{ participant.comment }}“
                  </span>
                </span>
                <span
                  v-if="participant.unconfirmed"
                  class="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-base-300 px-2 py-0.5 text-[11px] font-semibold text-base-500"
                  :title="t('calendar.rsvp.unconfirmedTitle')"
                >
                  <Icon name="material-symbols:sync-problem-rounded" class="text-[13px]" />
                  {{ t('calendar.rsvp.unconfirmed', { answer: t(`calendar.rsvp.${participant.unconfirmed}Short`) }) }}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <p v-else class="mt-2 rounded-xl border border-dashed border-base-200 px-3 py-4 text-center text-sm text-base-400">
          {{ t('calendar.responses.noMatches') }}
        </p>
      </template>
    </template>

    <p v-else class="text-sm text-base-400">{{ t('calendar.detail.noParticipants') }}</p>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { AppointmentResponseValue } from '~/types/appointment'

export interface ResponseListParticipant {
  id: number
  name: string
  /** Confirmed answer; `null` when there is none or it still awaits reconfirmation. */
  response: AppointmentResponseValue | null
  /** Answer from before the occurrence changed, not yet confirmed again. */
  unconfirmed: AppointmentResponseValue | null
  comment: string | null
}

type GroupKey = AppointmentResponseValue | 'open'

const props = defineProps<{
  participants: ResponseListParticipant[]
}>()

const { t } = useI18n()

/** Below this many people the list fits at a glance and a search box would only be clutter. */
const SEARCH_THRESHOLD = 12

const filter = ref<'all' | GroupKey>('all')
const search = ref('')
/** Collapsed by default so a big audience does not push the rest of the modal away. */
const expanded = ref(false)

const GROUPS: Array<{ key: GroupKey, icon: string, headingClass: string, barClass: string, activeChipClass: string }> = [
  { key: 'yes', icon: 'material-symbols:check-circle-rounded', headingClass: 'text-success-700', barClass: 'bg-success-500', activeChipClass: 'border-transparent bg-success-500 text-white' },
  { key: 'maybe', icon: 'material-symbols:help-rounded', headingClass: 'text-warning-700', barClass: 'bg-warning-400', activeChipClass: 'border-transparent bg-warning-500 text-white' },
  { key: 'no', icon: 'material-symbols:cancel-rounded', headingClass: 'text-danger-700', barClass: 'bg-danger-400', activeChipClass: 'border-transparent bg-danger-500 text-white' },
  { key: 'open', icon: 'material-symbols:hourglass-top-rounded', headingClass: 'text-base-600', barClass: 'bg-base-300', activeChipClass: 'border-transparent bg-base-600 text-white' },
]

const showSearch = computed(() => props.participants.length > SEARCH_THRESHOLD)

function groupOf(participant: ResponseListParticipant): GroupKey {
  return participant.response ?? 'open'
}

const counts = computed(() => {
  const result: Record<GroupKey, number> = { yes: 0, maybe: 0, no: 0, open: 0 }
  for (const participant of props.participants) result[groupOf(participant)] += 1
  return result
})

const answeredCount = computed(() => props.participants.length - counts.value.open)

/** The "open" share stays the bar's empty track, so only real answers are drawn. */
const barSegments = computed(() => GROUPS
  .filter(group => group.key !== 'open')
  .map(group => ({ ...group, count: counts.value[group.key] }))
  .filter(group => group.count > 0))

/** Opens the list on one answer; pressing the active one again goes back to everybody. */
function selectGroup(key: GroupKey) {
  if (expanded.value && filter.value === key) {
    filter.value = 'all'
    return
  }
  filter.value = key
  expanded.value = true
}

function toggleExpanded() {
  expanded.value = !expanded.value
  if (!expanded.value) {
    filter.value = 'all'
    search.value = ''
  }
}

const visibleGroups = computed(() => {
  const needle = showSearch.value ? search.value.trim().toLocaleLowerCase() : ''
  const matches = needle
    ? props.participants.filter(participant => participant.name.toLocaleLowerCase().includes(needle))
    : props.participants

  return GROUPS
    .filter(group => filter.value === 'all' || filter.value === group.key)
    .map((group) => {
      const rows = matches.filter(participant => groupOf(participant) === group.key)
      // Unconfirmed answers are the most telling of the open ones, so they lead that group.
      if (group.key === 'open') rows.sort((a, b) => Number(Boolean(b.unconfirmed)) - Number(Boolean(a.unconfirmed)))
      return { ...group, rows, unconfirmed: rows.filter(row => row.unconfirmed).length }
    })
    .filter(group => group.rows.length > 0)
})
</script>
