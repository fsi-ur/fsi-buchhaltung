<template>
  <p
    v-if="reason"
    class="flex items-start gap-2 rounded-xl border border-warning-300 bg-warning-50 p-3 text-xs text-warning-800"
    role="status"
  >
    <Icon name="material-symbols:error-outline-rounded" class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <span class="min-w-0">
      <span class="block font-medium">{{ reason }}</span>
      <span v-if="scheduled" class="mt-0.5 block text-warning-700">{{ t('notifications.mailStatus.stillQueued') }}</span>
    </span>
  </p>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useNotificationMailStatus } from '~/composables/useNotificationMailStatus'
import type { NotificationChannelKey } from '~/config/notificationChannels'

const props = withDefaults(defineProps<{
  channel?: NotificationChannelKey
  scheduled?: boolean
}>(), { channel: 'email', scheduled: false })

const { t } = useI18n()
const { ensureLoaded, channelBlockedReason } = useNotificationMailStatus()

const reason = computed(() => channelBlockedReason(props.channel))

onMounted(ensureLoaded)
</script>
