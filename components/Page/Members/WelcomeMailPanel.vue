<template>
  <section v-if="visible" class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
    <header class="flex items-center gap-2">
      <Icon name="material-symbols:waving-hand-rounded" class="h-5 w-5 shrink-0 text-secondary-700" aria-hidden="true" />
      <h3 class="text-sm font-semibold text-base-900">{{ t('member.welcomeMail.title') }}</h3>
      <CommonStatusBadge v-if="memberId && status" :label="stateLabel" :tone="stateTone" class="ml-auto" />
    </header>

    <div v-if="!memberId" class="mt-3 space-y-3">
      <label class="flex cursor-pointer items-start gap-3">
        <input
          :checked="modelValue"
          type="checkbox"
          class="checkbox mt-0.5"
          :disabled="disabled"
          @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
        >
        <span class="min-w-0">
          <span class="block text-sm font-medium text-base-800">{{ t('member.welcomeMail.sendOnCreate') }}</span>
          <span class="block text-xs text-base-500">{{ t('member.welcomeMail.sendOnCreateHelp') }}</span>
        </span>
      </label>

      <PageNotificationsMailStatusNotice v-if="modelValue" scheduled />
    </div>

    <div v-else class="mt-3 space-y-2">
      <p class="text-sm text-base-700">{{ stateLabel }}</p>

      <p v-if="status?.error" class="text-xs text-danger-600">
        {{ t('member.welcomeMail.errorLabel') }}: {{ status.error }}
      </p>

      <p v-if="blockedReason" class="inline-flex items-start gap-1 text-xs text-warning-600">
        <Icon name="material-symbols:error-outline-rounded" class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {{ blockedReason }}
      </p>

      <p v-if="status && status.attempts > 1" class="text-xs text-base-400">
        {{ t('member.welcomeMail.attempts', { count: status.attempts }) }}
      </p>

      <p v-if="status && !status.alreadySent" class="text-xs text-base-400">
        {{ t('member.welcomeMail.onlyOnce') }}
      </p>

      <div class="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          class="btn-secondary inline-flex items-center gap-1.5"
          :disabled="!canSend || sending || disabled"
          :class="{ 'cursor-not-allowed opacity-50': !canSend || sending || disabled }"
          @click="onSendClick"
        >
          <Icon name="material-symbols:outgoing-mail" class="h-4 w-4" aria-hidden="true" />
          {{ sending
            ? t('member.welcomeMail.sending')
            : (status && status.state !== 'none' && !status.alreadySent
              ? t('member.welcomeMail.resend')
              : t('member.welcomeMail.send')) }}
        </button>

        <button
          v-if="status?.notificationId && canViewOutbox"
          type="button"
          class="cursor-pointer text-xs font-medium text-link-600 hover:underline"
          @click="openOutbox"
        >
          {{ t('member.welcomeMail.openOutbox') }}
        </button>
      </div>
    </div>
  </section>

  <CommonModal
    v-model="showConfirm"
    :title="t('member.welcomeMail.confirmTitle')"
    width-class="max-w-md"
  >
    <p class="text-sm text-base-700">
      {{ status?.state === 'scheduled' ? t('member.welcomeMail.confirmScheduled') : t('member.welcomeMail.confirmResend') }}
    </p>

    <template #footer>
      <button class="btn-secondary" type="button" @click="showConfirm = false">{{ t('actions.cancel') }}</button>
      <button class="btn-primary" type="button" :disabled="sending" @click="send">{{ t('member.welcomeMail.send') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { usePage } from '~/composables/usePage'
import { useAuth } from '~/composables/useAuth'
import { useAppRefresh } from '~/composables/useAppRefresh'
import { useNotificationDisplay } from '~/composables/useNotificationDisplay'
import { MemberStatus } from '~/types/member'
import type { MemberWelcomeStatus } from '~/server/utils/memberWelcome'
import type { GetMemberWelcomeMailResponse } from '~/server/api/members/[id]/welcome-mail.get'
import type { SendMemberWelcomeMailResponse } from '~/server/api/members/[id]/welcome-mail.post'

const props = defineProps<{
  memberId: number | null
  memberStatus: MemberStatus
  modelValue: boolean
  disabled?: boolean
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const { t } = useI18n()
const toast = useToast()
const { setPage } = usePage()
const { hasPermission } = useAuth()
const { scheduledTime } = useNotificationDisplay()

const canViewOutbox = computed(() => hasPermission(['notifications.view']))

const status = ref<MemberWelcomeStatus | null>(null)
const canSend = ref(false)
const blockedReason = ref<string | null>(null)
const sending = ref(false)
const showConfirm = ref(false)

const welcomeStatus = computed(() => props.memberStatus === MemberStatus.Active || props.memberStatus === MemberStatus.Passive)

const visible = computed(() => welcomeStatus.value || (props.memberId !== null && status.value !== null && status.value.state !== 'none'))

const stateLabel = computed(() => {
  const current = status.value
  if (!current || current.state === 'none') return t('member.welcomeMail.state.none')
  if (current.state === 'scheduled') return t('member.welcomeMail.state.scheduled', { date: scheduledTime(current.scheduledFor || '') })
  if (current.state === 'sent') return t('member.welcomeMail.state.sent', { date: scheduledTime(current.sentAt || current.scheduledFor || '') })
  if (current.state === 'failed') return t('member.welcomeMail.state.failed')
  return t('member.welcomeMail.state.cancelled')
})

const stateTone = computed(() => {
  switch (status.value?.state) {
    case 'sent': return 'success'
    case 'scheduled': return 'warning'
    case 'failed': return 'danger'
    case 'cancelled': return 'baseMuted'
    default: return 'base'
  }
})

async function load() {
  if (!props.memberId) return

  try {
    const res = await $fetch<GetMemberWelcomeMailResponse>(`/api/members/${props.memberId}/welcome-mail`)
    if (!res.ok) return
    status.value = res.status
    canSend.value = res.canSend
    blockedReason.value = res.blockedReason
  } catch {
    status.value = null
  }
}

function onSendClick() {
  // Sending now instead of waiting, or after a failed attempt, deserves a confirmation.
  if (status.value && status.value.state !== 'none') {
    showConfirm.value = true
    return
  }
  send()
}

async function send() {
  if (!props.memberId || sending.value) return

  sending.value = true
  try {
    const res = await $fetch<SendMemberWelcomeMailResponse>(`/api/members/${props.memberId}/welcome-mail`, { method: 'POST' })
    if (!res.ok) {
      toast.error(res.error)
      return
    }

    status.value = res.status
    showConfirm.value = false
    toast.success(t('member.welcomeMail.sent'))
  } catch {
    toast.error(t('member.welcomeMail.sendFailed'))
  } finally {
    sending.value = false
  }
}

function openOutbox() {
  setPage('NotificationList', { tab: 'outbox', notificationId: status.value?.notificationId })
}

watch(() => props.memberId, load, { immediate: true })

useAppRefresh().onRefresh(load)
</script>
