<template>
  <section class="space-y-4">
    <header>
      <h3 class="text-sm font-semibold uppercase tracking-wide text-base-400">{{ t('calendar.website.section') }}</h3>
      <p class="mt-0.5 text-xs text-base-400">{{ t('calendar.website.sectionHint') }}</p>
    </header>

    <p v-if="disabled" class="rounded-lg bg-base-50 px-3 py-2 text-sm text-base-600">
      {{ t('calendar.website.readOnly') }}
    </p>

    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-sm font-medium text-base-800">{{ t('calendar.website.published') }}</p>
        <p class="text-xs text-base-500">{{ t('calendar.website.publishedHint') }}</p>
      </div>
      <CommonToggleSwitch
        :model-value="modelValue.published"
        :label="t('calendar.website.published')"
        :disabled="disabled"
        @update:model-value="emit('update:modelValue', { ...modelValue, published: $event })"
      />
    </div>

    <template v-if="modelValue.published">
      <div class="field sm:max-w-sm">
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
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: AppointmentWebsiteSettings): void
}>()

const { t } = useI18n()
</script>
