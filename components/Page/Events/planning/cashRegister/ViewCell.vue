<template>
  <span :class="toneClass">{{ text }}</span>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { ViewCell } from '~/shared/cashRegisterView'

const props = defineProps<{
  cell: ViewCell
}>()

const { locale } = useI18n()

const text = computed(() => formatViewCell(props.cell, locale.value))
const toneClass = computed(() => {
  const tone = toViewValue(props.cell).tone
  return tone ? VIEW_TONE_TEXT[tone] : ''
})
</script>
