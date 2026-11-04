<template>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 text-sm font-medium text-accent-500 hover:underline cursor-pointer"
  >
    <Icon name="material-symbols:open-in-new-rounded" class="h-4 w-4" aria-hidden="true" />
    {{ label }}
  </button>
</template>

<script setup lang="ts">
defineProps<{
  label: string
}>()
</script>
