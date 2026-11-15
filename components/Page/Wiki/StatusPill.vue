<template>
  <span
    v-if="status && status !== 'published'"
    :class="[
      'inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[0.65rem] font-medium uppercase tracking-wide',
      status === 'archived' ? 'bg-warning-100 text-warning-800' : 'bg-base-100 text-base-500',
    ]"
  >
    <Icon v-if="status === 'archived'" name="material-symbols:archive-outline-rounded" class="h-3 w-3" aria-hidden="true" />
    {{ t(`wiki.status.${status}`) }}
  </span>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { WikiArticleStatus } from '~/types/wiki'

/** Compact status marker for article lists (tree, search, sub-articles). Published shows nothing. */
defineProps<{
  status?: WikiArticleStatus | null
}>()

const { t } = useI18n()
</script>
