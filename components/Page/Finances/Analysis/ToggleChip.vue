<template>
  <button
    type="button"
    :disabled="disabled"
    :class="[
      'w-full rounded-lg border font-medium transition',
      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      compact ? 'px-2.5 py-1.5 text-xs leading-tight' : 'px-3 py-2 text-sm',
      selected
        ? 'border-accent-400 bg-accent-50 text-accent-700'
        : disabled
          ? 'border-base-200 bg-white text-base-700'
          : 'border-base-200 bg-white text-base-700 hover:bg-base-50',
    ]"
    :aria-pressed="selected"
    :title="title || undefined"
  >
    <span class="inline-flex items-center justify-center gap-1.5">
      <Icon v-if="icon" :name="icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  selected: boolean
  compact?: boolean
  disabled?: boolean
  icon?: string
  title?: string
}>(), {
  compact: false,
  disabled: false,
  icon: '',
  title: '',
})
</script>
