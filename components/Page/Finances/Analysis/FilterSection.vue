<template>
  <div class="rounded-xl border border-base-200">
    <button
      type="button"
      class="flex w-full cursor-pointer items-start justify-between gap-3 p-4 text-left transition hover:bg-base-50"
      :class="expanded ? 'rounded-t-xl' : 'rounded-xl'"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <div class="min-w-0 space-y-1">
        <h3 class="flex items-center gap-2 font-semibold text-base-900">
          <Icon v-if="icon" :name="icon" class="shrink-0 text-lg text-base-400" aria-hidden="true" />
          {{ title }}
        </h3>

        <p v-if="!expanded && summary" class="truncate text-xs font-medium text-accent-700">{{ summary }}</p>
        <p v-else class="text-xs text-base-500">{{ hint }}</p>
      </div>

      <Icon
        :name="expanded ? 'material-symbols:keyboard-arrow-up-rounded' : 'material-symbols:keyboard-arrow-down-rounded'"
        class="mt-0.5 h-5 w-5 shrink-0 text-base-500"
        aria-hidden="true"
      />
    </button>

    <div v-if="expanded" class="space-y-4 border-t border-base-100 p-4">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  hint: string
  summary?: string
  icon?: string
}>()

const expanded = defineModel<boolean>('expanded', { default: false })
</script>
