<template>
  <section class="space-y-4">
    <header>
      <h3 class="text-sm font-semibold uppercase tracking-wide text-base-400">{{ t('calendar.website.section') }}</h3>
      <p class="mt-0.5 text-xs text-base-400">
        {{ occurrence ? t('calendar.website.occurrenceSectionHint') : t('calendar.website.sectionHint') }}
      </p>
    </header>

    <p v-if="disabled" class="rounded-lg bg-base-50 px-3 py-2 text-sm text-base-600">
      {{ t('calendar.website.readOnly') }}
    </p>

    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-sm font-medium text-base-800">
          {{ occurrence ? t('calendar.website.occurrencePublished') : t('calendar.website.published') }}
        </p>
        <p class="text-xs text-base-500">
          {{ occurrence
            ? (seriesPublished ? t('calendar.website.occurrenceHintSeriesPublished') : t('calendar.website.occurrenceHintSeriesUnpublished'))
            : t('calendar.website.publishedHint') }}
        </p>
      </div>
      <CommonToggleSwitch
        :model-value="modelValue.published"
        :label="occurrence ? t('calendar.website.occurrencePublished') : t('calendar.website.published')"
        :disabled="disabled"
        @update:model-value="emit('update:modelValue', { ...modelValue, published: $event })"
      />
    </div>

    <p
      v-if="occurrence && modelValue.published !== seriesPublished"
      class="text-xs font-medium text-accent-700"
    >
      {{ modelValue.published ? t('calendar.website.occurrenceDeviatesPublished') : t('calendar.website.occurrenceDeviatesHidden') }}
    </p>

    <template v-if="modelValue.published">
      <div v-if="!occurrence" class="field sm:max-w-sm">
        <label>{{ t('calendar.website.visibleFrom') }}</label>
        <CommonDateInput
          :model-value="modelValue.visible_from"
          mode="datetime"
          :disabled="disabled"
          @update:model-value="emit('update:modelValue', { ...modelValue, visible_from: $event || null })"
        />
        <p class="mt-1 text-xs text-base-400">{{ t('calendar.website.visibleFromHint') }}</p>
      </div>

      <div
        v-if="restricted"
        class="flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-800"
      >
        <Icon name="material-symbols:warning-outline-rounded" class="mt-0.5 shrink-0 text-sm" />
        <span>{{ t('calendar.website.restrictedWarning') }}</span>
      </div>

      <div class="flex items-start gap-2 rounded-lg bg-base-50 px-3 py-2 text-xs text-base-500">
        <Icon name="material-symbols:info-outline-rounded" class="mt-0.5 shrink-0 text-sm" />
        <span>{{ t('calendar.website.sharedFields') }}</span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { AppointmentWebsiteSettings } from '~/types/appointment'

defineProps<{
  modelValue: AppointmentWebsiteSettings
  /** The appointment is limited to subdivisions/invited members internally. */
  restricted: boolean
  disabled?: boolean
  /** Editing a single date of a series: only `published` applies, `visible_from` stays the series'. */
  occurrence?: boolean
  /** With `occurrence`: whether the series itself is published. */
  seriesPublished?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: AppointmentWebsiteSettings): void
}>()

const { t } = useI18n()
</script>
