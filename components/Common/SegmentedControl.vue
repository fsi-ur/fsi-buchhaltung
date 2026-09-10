<template>
  <div
    class="inline-flex w-full gap-1 rounded-lg border border-base-200 bg-base-100 p-1"
    :class="wrap ? 'flex-wrap' : 'sm:w-auto'"
    role="group"
    :aria-label="ariaLabel || undefined"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-medium transition"
      :class="[
        wrap ? 'flex-auto' : 'flex-1 sm:flex-none',
        option.value === modelValue
          ? 'bg-white text-base-900 shadow-sm'
          : 'text-base-500 hover:text-base-700',
      ]"
      :aria-pressed="option.value === modelValue"
      @click="$emit('update:modelValue', option.value)"
    >
      {{ option.label }}
      <span v-if="option.badge !== undefined" class="ml-1 text-base-400">{{ option.badge }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
export interface SegmentedControlOption {
  value: string
  label: string
  /** Muted suffix after the label, e.g. how many records the option stands for. */
  badge?: string | number
}

defineProps<{
  modelValue: string
  options: SegmentedControlOption[]
  /** Accessible name for the button group, e.g. the visible field label. */
  ariaLabel?: string
  /** Let the options break into several rows instead of squeezing them onto one line. */
  wrap?: boolean
}>()

defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()
</script>
