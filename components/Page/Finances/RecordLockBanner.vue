<template>
  <div
    class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm"
    :class="unlocked ? 'border-danger-200 bg-danger-50 text-danger-900' : 'border-warning-200 bg-warning-50 text-warning-900'"
  >
    <p class="flex-1">
      {{ unlocked ? t('finances.recordLock.unlockedHint') : canUnlock ? t('finances.recordLock.lockedHint') : t('finances.recordLockedHint') }}
    </p>
    <button
      v-if="canUnlock && !unlocked"
      type="button"
      class="btn-secondary inline-flex items-center gap-2"
      @click="confirmOpen = true"
    >
      <Icon name="material-symbols:lock-open-outline" class="h-4 w-4" />
      {{ t('finances.recordLock.unlock') }}
    </button>
    <button
      v-else-if="unlocked"
      type="button"
      class="btn-secondary inline-flex items-center gap-2"
      @click="unlocked = false"
    >
      <Icon name="material-symbols:lock-outline" class="h-4 w-4" />
      {{ t('finances.recordLock.relock') }}
    </button>

    <CommonModal
      v-model="confirmOpen"
      :title="t('finances.recordLock.confirmTitle')"
      width-class="max-w-lg"
      @close="confirmOpen = false"
    >
      <p class="text-sm text-base-700">
        {{ t('finances.recordLock.confirmText') }}
      </p>
      <template #footer>
        <button type="button" class="btn-secondary" @click="confirmOpen = false">
          {{ t('actions.cancel') }}
        </button>
        <button type="button" class="btn-primary" @click="confirmUnlock">
          {{ t('finances.recordLock.confirm') }}
        </button>
      </template>
    </CommonModal>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '~/composables/useI18n'

/**
 * Notice on a booked (locked) finance record (SEC-22). Holders of the domain's unlock permission
 * get a button that unlocks the editor after a confirmation — the permission alone never makes a
 * booked record editable; saves made while unlocked send `unlock` to the server.
 */
defineProps<{
  /** The user holds the domain's `*.unlock` permission. */
  canUnlock: boolean
}>()

const unlocked = defineModel<boolean>({ default: false })
const { t } = useI18n()
const confirmOpen = ref(false)

function confirmUnlock() {
  confirmOpen.value = false
  unlocked.value = true
}
</script>
