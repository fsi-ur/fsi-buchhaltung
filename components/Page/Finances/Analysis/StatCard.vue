<template>
  <div :class="['rounded-xl px-4 py-4', tone.surface]">
    <div :class="['truncate text-sm', tone.label]">{{ label }}</div>
    <div :class="['mt-2 text-2xl font-semibold tabular-nums', tone.value]">{{ value }}</div>
    <div v-if="caption" :class="['mt-1 text-xs', tone.label]">{{ caption }}</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  value: string
  caption?: string
  tone?: 'neutral' | 'accent' | 'success' | 'info' | 'danger' | 'warning'
}>(), {
  caption: '',
  tone: 'neutral',
})

const TONES = {
  neutral: { surface: 'bg-base-100', label: 'text-base-600', value: 'text-base-900' },
  accent: { surface: 'bg-accent-50', label: 'text-accent-700', value: 'text-accent-950' },
  success: { surface: 'bg-success-50', label: 'text-success-700', value: 'text-success-950' },
  info: { surface: 'bg-info-50', label: 'text-info-700', value: 'text-info-950' },
  danger: { surface: 'bg-danger-50', label: 'text-danger-700', value: 'text-danger-900' },
  warning: { surface: 'bg-warning-50', label: 'text-warning-800', value: 'text-warning-900' },
} as const

const tone = computed(() => TONES[props.tone])
</script>
