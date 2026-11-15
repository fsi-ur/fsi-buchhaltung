<template>
  <CommonModal
    :model-value="space !== null"
    :title="space ? t('wiki.space.accessTitle', { title: space.title }) : ''"
    width-class="max-w-2xl"
    @update:model-value="(open: boolean) => { if (!open) close() }"
  >
    <p class="text-sm text-base-600">{{ t('wiki.space.accessHint') }}</p>
    <PageWikiArticleAccessTab
      v-if="space"
      scope-type="space"
      :scope-id="space.id"
      @changed="changed = true"
    />

    <template #footer>
      <button type="button" class="btn-secondary" @click="close">{{ t('actions.close') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'

/** Access grants of one wiki space, in a dialog. Emits `changed` on close when grants were edited. */
const props = defineProps<{
  space: { id: number, title: string } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'changed'): void
}>()

const { t } = useI18n()
const changed = ref(false)

watch(() => props.space?.id, () => { changed.value = false })

function close() {
  if (changed.value) emit('changed')
  changed.value = false
  emit('close')
}
</script>
