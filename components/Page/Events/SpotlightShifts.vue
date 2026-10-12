<template>
  <div class="rounded-xl border border-base-200 bg-base-50/60 p-4">
    <button
      type="button"
      class="-m-1 block w-[calc(100%+0.5rem)] rounded-lg p-1 text-left transition not-disabled:cursor-pointer not-disabled:hover:bg-base-100/70 disabled:cursor-default"
      :disabled="!canOpen"
      @click="$emit('open')"
    >
      <span class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-1.5 text-sm font-semibold text-base-700">
          <Icon name="material-symbols:calendar-month-rounded" class="text-base text-accent-500" />
          {{ t('event.planning.tabs.shifts') }}
        </span>
        <span v-if="shifts.length" class="shrink-0 text-sm font-semibold text-base-900">
          {{ t('event.planning.shiftsStaffed', { staffed: fullyStaffed, total: shifts.length }) }}
        </span>
      </span>

      <span v-if="shifts.length" class="mt-2 block h-2 overflow-hidden rounded-full bg-base-200">
        <span
          class="block h-full rounded-full transition-all"
          :class="status === 'past' ? 'bg-base-400' : 'bg-accent-500'"
          :style="{ width: `${staffedPercent}%` }"
        />
      </span>
      <span v-else class="mt-1 block text-xs text-base-500">{{ t('event.planning.noShiftsYet') }}</span>
    </button>

    <div v-if="shifts.length" class="mt-3">
      <template v-if="openShifts.length">
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <button
            v-for="shift in visibleOpenShifts"
            :key="shift.id"
            type="button"
            class="rounded-lg bg-white p-2.5 text-left shadow-sm transition not-disabled:cursor-pointer not-disabled:hover:shadow-md disabled:cursor-default"
            :disabled="!canOpen"
            @click="$emit('open')"
          >
            <span class="flex items-center justify-between gap-2">
              <span class="flex min-w-0 items-center gap-1">
                <Icon
                  v-if="shift.is_signed_up"
                  name="material-symbols:check-circle-rounded"
                  class="shrink-0 text-sm text-success-500"
                />
                <span class="truncate text-sm font-medium text-base-800">{{ shift.name }}</span>
              </span>
              <span class="shrink-0 rounded-md bg-warning-50 px-1.5 py-0.5 text-xs font-medium text-warning-700">
                {{ t('event.planning.staffedCount', { current: shift.member_count, required: shift.required_people }) }}
              </span>
            </span>
            <span class="mt-1 flex items-center gap-1 text-xs text-base-500">
              <Icon name="material-symbols:schedule-rounded" class="shrink-0 text-sm text-base-400" />
              <span class="truncate">{{ timeLabel(shift) }}</span>
            </span>
          </button>
          <button
            v-if="hiddenOpenShiftCount"
            type="button"
            class="flex items-center justify-center rounded-lg bg-white p-2.5 text-center text-sm font-semibold text-base-600 shadow-sm transition not-disabled:cursor-pointer not-disabled:hover:shadow-md disabled:cursor-default"
            :disabled="!canOpen"
            @click="$emit('open')"
          >
            {{ t('event.spotlight.moreOpenShifts', { count: hiddenOpenShiftCount }) }}
          </button>
        </div>
      </template>
      <p v-else class="flex items-center gap-1.5 text-sm font-medium text-success-600">
        <Icon name="material-symbols:check-circle-rounded" class="text-base" />
        {{ t('event.planning.statusText.allStaffed') }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { EventSpotlightShift, EventSpotlightStatus } from '~/types/event'

const props = defineProps<{
  shifts: EventSpotlightShift[]
  status: EventSpotlightStatus
  canOpen: boolean
}>()

defineEmits<{ (e: 'open'): void }>()

const MAX_OPEN_SHIFTS = 3

const { t } = useI18n()
const { formatDate, formatDateTime } = useLocaleFormatters()

const fullyStaffed = computed(() => props.shifts.filter(shift => shift.member_count >= shift.required_people).length)
const staffedPercent = computed(() => props.shifts.length ? Math.round((fullyStaffed.value / props.shifts.length) * 100) : 0)

const openShifts = computed(() => props.shifts.filter(shift => shift.member_count < shift.required_people))
const visibleOpenShifts = computed(() => openShifts.value.slice(0, MAX_OPEN_SHIFTS))
const hiddenOpenShiftCount = computed(() => openShifts.value.length - visibleOpenShifts.value.length)

function timeLabel(shift: EventSpotlightShift) {
  const sameDay = shift.starts_at.slice(0, 10) === shift.ends_at.slice(0, 10)
  if (sameDay) return `${formatDate(shift.starts_at)} · ${shift.starts_at.slice(11, 16)} – ${shift.ends_at.slice(11, 16)}`
  return `${formatDateTime(shift.starts_at)} – ${formatDateTime(shift.ends_at)}`
}
</script>
