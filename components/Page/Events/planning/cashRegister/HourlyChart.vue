<template>
  <div v-if="bars.length === 0" class="rounded-lg border border-base-200 bg-base-50 p-6 text-center text-sm text-base-400">
    {{ empty }}
  </div>

  <div v-else class="overflow-x-auto pb-1">
    <div class="flex min-w-fit items-end gap-2">
      <div
        v-for="bar in bars"
        :key="bar.hour"
        class="flex min-w-14 flex-1 flex-col items-center"
        :title="bar.title"
      >
        <span class="mb-1 whitespace-nowrap text-xs text-base-500">{{ bar.valueLabel }}</span>
        <div class="w-full rounded-t-md bg-accent-400" :style="{ height: `${bar.height}px` }"></div>
        <span class="mt-1 w-full whitespace-nowrap border-t border-base-200 pt-1 text-center text-xs font-medium text-base-500">
          {{ bar.hourLabel }}
        </span>
        <span class="h-4 whitespace-nowrap text-xs text-base-400">{{ bar.dayLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { ViewValueFormat } from '~/shared/cashRegisterView'

const props = defineProps<{
  points: Array<{ hour: string, value: number, caption?: string }>
  valueFormat?: ViewValueFormat
  empty?: string
}>()

const { locale } = useI18n()
const { toLocalDateTime } = useAppTimeZone()

const MAX_BAR_HEIGHT = 160

// `hour` is an instant (start of a UTC hour), shown as the wall clock of the
// app time zone. Labels are derived once per change, not per render.
const bars = computed(() => {
  const max = props.points.reduce((highest, point) => Math.max(highest, point.value), 0)
  let previousDate = ''

  return props.points.map((point) => {
    const local = toLocalDateTime(point.hour)
    const date = local.slice(0, 10)
    const dayLabel = date === previousDate ? '' : `${date.slice(8, 10)}.${date.slice(5, 7)}.`
    previousDate = date

    const scaled = Math.round((max > 0 ? point.value / max : 0) * MAX_BAR_HEIGHT)
    const valueLabel = formatViewNumber(point.value, props.valueFormat, locale.value)

    return {
      hour: point.hour,
      valueLabel,
      title: point.caption ? `${valueLabel} · ${point.caption}` : valueLabel,
      hourLabel: local.slice(11, 16),
      dayLabel,
      height: max <= 0 ? 2 : Math.max(point.value > 0 ? 4 : 2, scaled),
    }
  })
})
</script>
