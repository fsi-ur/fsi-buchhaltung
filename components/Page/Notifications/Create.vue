<template>
  <Page :headline1="t('pages.createNotification')" @open-menu="$emit('openMenu')">
    <template #cards>
      <div class="col-span-12 space-y-4 lg:col-span-7 xl:col-span-8">
        <CommonValidationSummary :errors="errors" :title="t('common.validationBlocked')" />

        <section class="space-y-4 rounded-xl bg-white p-4 shadow-sm sm:p-6 sm:shadow-lg">
          <header class="flex items-center gap-2">
            <Icon name="material-symbols:group-rounded" class="h-5 w-5 text-secondary-700" aria-hidden="true" />
            <h3 class="font-semibold">{{ t('notifications.compose.recipients') }}</h3>
            <span class="ml-auto text-xs text-base-500">{{ recipientSummary }}</span>
          </header>

          <label
            class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition"
            :class="form.allActiveMembers ? 'border-secondary-500 bg-secondary-50' : 'border-base-200 hover:border-base-300'"
          >
            <input v-model="form.allActiveMembers" type="checkbox" class="checkbox mt-0.5">
            <span>
              <span class="block text-sm font-medium text-base-800">{{ t('notifications.compose.allActiveMembers') }}</span>
              <span class="block text-xs text-base-500">
                {{ t('notifications.compose.allActiveMembersHelp', { count: memberCount }) }}
              </span>
            </span>
          </label>

          <div v-if="!form.allActiveMembers" class="space-y-4">
            <div class="space-y-2">
              <p class="text-sm font-medium text-base-600">
                {{ t('notifications.compose.recipientsMembers') }}
                <span v-if="form.memberIds.length" class="text-base-400">({{ form.memberIds.length }})</span>
              </p>
              <CommonSelectionListField
                :query="memberQuery"
                :options="memberOptions"
                :selected-items="selectedMemberItems"
                :placeholder="t('common.searchList')"
                :empty-text="t('common.noEntries')"
                :empty-selection-text="t('notifications.compose.noMembersSelected')"
                :remove-label="t('actions.remove')"
                @update:query="memberQuery = $event"
                @select="onSelectMember"
                @remove="onRemoveMember"
              />
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium text-base-600">
                {{ t('notifications.compose.recipientsSubdivisions') }}
                <span v-if="form.subdivisionIds.length" class="text-base-400">({{ form.subdivisionIds.length }})</span>
              </p>
              <CommonSelectionListField
                :query="subdivisionQuery"
                :options="subdivisionOptions"
                :selected-items="selectedSubdivisionItems"
                :placeholder="t('common.searchList')"
                :empty-text="t('common.noEntries')"
                :empty-selection-text="t('notifications.compose.noSubdivisionsSelected')"
                :remove-label="t('actions.remove')"
                @update:query="subdivisionQuery = $event"
                @select="onSelectSubdivision"
                @remove="onRemoveSubdivision"
              />
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium text-base-600">
                {{ t('notifications.compose.recipientsUsers') }}
                <span v-if="form.userIds.length" class="text-base-400">({{ form.userIds.length }})</span>
              </p>
              <CommonSelectionListField
                :query="userQuery"
                :options="userOptions"
                :selected-items="selectedUserItems"
                :placeholder="t('common.searchList')"
                :empty-text="t('common.noEntries')"
                :empty-selection-text="t('notifications.compose.noUsersSelected')"
                :remove-label="t('actions.remove')"
                @update:query="userQuery = $event"
                @select="onSelectUser"
                @remove="onRemoveUser"
              />
            </div>
          </div>
        </section>

        <section class="space-y-4 rounded-xl bg-white p-4 shadow-sm sm:p-6 sm:shadow-lg">
          <header class="flex items-center gap-2">
            <Icon name="material-symbols:edit-note-rounded" class="h-5 w-5 text-secondary-700" aria-hidden="true" />
            <h3 class="font-semibold">{{ t('notifications.compose.content') }}</h3>
          </header>

          <div class="field">
            <label for="notification-subject">{{ t('notifications.compose.subject') }}</label>
            <input
              id="notification-subject"
              v-model="form.subject"
              type="text"
              maxlength="255"
              class="input"
              :placeholder="t('notifications.compose.subjectPlaceholder')"
            >
            <p class="mt-1 text-right text-xs text-base-400">{{ form.subject.length }} / 255</p>
          </div>

          <div class="field">
            <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label for="notification-body" class="mb-0">{{ t('notifications.compose.body') }}</label>
              <CommonTextFormatToolbar @action="applyFormat" />
            </div>
            <textarea
              id="notification-body"
              ref="bodyRef"
              v-model="form.body"
              rows="8"
              class="input resize-y"
              :placeholder="t('notifications.compose.bodyPlaceholder')"
            ></textarea>
            <p class="mt-1 text-xs text-base-400">{{ t('notifications.compose.formatHelp') }}</p>
          </div>

          <div class="space-y-2">
            <p class="text-xs font-medium text-base-500">{{ t('notifications.compose.variables') }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="variable in variables"
                :key="variable"
                type="button"
                class="rounded-md border border-base-200 bg-base-50 px-2 py-1 text-xs font-medium text-base-700 transition hover:border-secondary-400 hover:text-secondary-700 cursor-pointer"
                :title="`${variableDescription(variable)} — ${t('notifications.compose.insertVariable')}`"
                @click="insertVariable(variable)"
              >
                {{ variableToken(variable) }}
              </button>
            </div>
          </div>
        </section>

        <section class="space-y-4 rounded-xl bg-white p-4 shadow-sm sm:p-6 sm:shadow-lg">
          <header class="flex items-center gap-2">
            <Icon name="material-symbols:send-rounded" class="h-5 w-5 text-secondary-700" aria-hidden="true" />
            <h3 class="font-semibold">{{ t('notifications.compose.channels') }}</h3>
          </header>

          <div class="grid gap-2 sm:grid-cols-3">
            <label
              v-for="channel in NOTIFICATION_CHANNELS"
              :key="channel.key"
              class="flex items-start gap-3 rounded-xl border p-3 transition"
              :class="[
                form.channels.includes(channel.key) ? 'border-secondary-500 bg-secondary-50' : 'border-base-200',
                channel.key === 'in_app' || channelOffGlobally(channel.key) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-base-300',
              ]"
            >
              <input
                v-model="form.channels"
                type="checkbox"
                :value="channel.key"
                class="checkbox mt-0.5"
                :disabled="channel.key === 'in_app' || channelOffGlobally(channel.key)"
              >
              <span class="min-w-0">
                <span class="flex items-center gap-1.5 text-sm font-medium text-base-800">
                  <Icon :name="channelIcon(channel.key)" class="h-4 w-4" aria-hidden="true" />
                  {{ t(channel.labelKey) }}
                </span>
                <span class="block text-xs text-base-500">
                  {{ channelOffGlobally(channel.key) ? t('settings.notifications.channelOffGlobally') : t(`notifications.compose.channelHelp.${channel.key}`) }}
                </span>
              </span>
            </label>
          </div>
        </section>

        <section class="space-y-4 rounded-xl bg-white p-4 shadow-sm sm:p-6 sm:shadow-lg">
          <header class="flex items-center gap-2">
            <Icon name="material-symbols:schedule-rounded" class="h-5 w-5 text-secondary-700" aria-hidden="true" />
            <h3 class="font-semibold">{{ t('notifications.compose.timing') }}</h3>
          </header>

          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="option in timingOptions"
              :key="option.value"
              class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition"
              :class="timing === option.value ? 'border-secondary-500 bg-secondary-50' : 'border-base-200 hover:border-base-300'"
            >
              <input v-model="timing" type="radio" :value="option.value" class="mt-0.5 h-4 w-4 cursor-pointer">
              <span>
                <span class="block text-sm font-medium text-base-800">{{ option.label }}</span>
                <span class="block text-xs text-base-500">{{ option.help }}</span>
              </span>
            </label>
          </div>

          <div v-if="timing === 'schedule'" class="field max-w-xs">
            <label for="notification-schedule">{{ t('notifications.compose.scheduleDate') }}</label>
            <CommonDateInput id="notification-schedule" v-model="scheduledFor" mode="datetime" />
          </div>
        </section>

        <CommonFormActions
          :save-disabled="saving"
          :saving="saving"
          :saving-label="t('actions.saving')"
          :cancel-label="t('actions.cancel')"
          :submit-label="timing === 'schedule' ? t('notifications.compose.submitScheduled') : t('notifications.compose.submit')"
          @cancel="cancel"
          @submit="submit"
        />
      </div>

      <div class="col-span-12 lg:col-span-5 xl:col-span-4">
        <section class="space-y-3 rounded-xl bg-white p-4 shadow-sm sm:p-6 sm:shadow-lg lg:sticky lg:top-4">
          <header class="flex items-center gap-2">
            <Icon name="material-symbols:visibility-outline-rounded" class="h-5 w-5 text-secondary-700" aria-hidden="true" />
            <h3 class="font-semibold">{{ t('notifications.compose.preview') }}</h3>
          </header>

          <div class="rounded-xl border border-base-200 p-3">
            <div class="flex items-start gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-200 text-base-700">
                <Icon name="material-symbols:campaign-rounded" class="h-5 w-5" aria-hidden="true" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-base-900">
                  {{ previewSubject || t('notifications.compose.previewEmptySubject') }}
                </p>
                <div
                  v-if="previewBody"
                  class="notification-body-html mt-1 text-sm text-base-600"
                  v-html="previewBodyHtml"
                ></div>
                <p v-else class="mt-1 text-sm text-base-600">
                  {{ t('notifications.compose.previewEmptyBody') }}
                </p>
                <p class="mt-2 text-[11px] text-base-400">{{ t('notifications.relativeTime.now') }}</p>
              </div>
            </div>
          </div>

          <p class="text-xs text-base-400">{{ t('notifications.compose.previewHelp') }}</p>

          <dl class="space-y-1 border-t border-base-100 pt-3 text-xs">
            <div class="flex justify-between gap-2">
              <dt class="text-base-500">{{ t('notifications.compose.recipients') }}</dt>
              <dd class="text-right font-medium text-base-700">{{ recipientSummary }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-base-500">{{ t('notifications.compose.channels') }}</dt>
              <dd class="text-right font-medium text-base-700">{{ selectedChannelLabels }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-base-500">{{ t('notifications.compose.timing') }}</dt>
              <dd class="text-right font-medium text-base-700">
                {{ timing === 'now' ? t('notifications.compose.sendNow') : (scheduledForDisplay || t('notifications.compose.schedule')) }}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { usePage } from '~/composables/usePage'
import { useReturnTarget } from '~/composables/useReturnTarget'
import { useNotificationDisplay } from '~/composables/useNotificationDisplay'
import { useTextFormatting } from '~/composables/useTextFormatting'
import { useVariableInsert } from '~/composables/useVariableInsert'
import { NOTIFICATION_CHANNELS, type NotificationChannelKey } from '~/config/notificationChannels'
import { NOTIFICATION_TYPE_MAP } from '~/config/notificationTypes'
import { renderNotificationBodyHtml } from '~/utils/notificationFormatting'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { SelectionListItem } from '~/components/Common/SelectionListField.vue'
import type { GetNotificationRecipientOptionsResponse } from '~/server/api/notifications/recipient-options.get'
import type { CreateNotificationResponse } from '~/server/api/notifications/create.post'
import type { CustomNotificationDraft } from '~/types/notification'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { pageMeta } = usePage()
const { goToReturnTarget } = useReturnTarget('NotificationList')
const { channelIcon, channelLabel, scheduledTime, variableDescription } = useNotificationDisplay()

type RecipientOptions = Extract<GetNotificationRecipientOptionsResponse, { ok: true }>

const options = ref<RecipientOptions | null>(null)
const memberQuery = ref('')
const subdivisionQuery = ref('')
const userQuery = ref('')
const errors = ref<string[]>([])
const saving = ref(false)
const timing = ref<'now' | 'schedule'>('now')
const scheduledFor = ref<string | null>('')
const bodyRef = ref<HTMLTextAreaElement | null>(null)

const form = reactive({
  subject: '',
  body: '',
  memberIds: [] as number[],
  subdivisionIds: [] as number[],
  userIds: [] as number[],
  allActiveMembers: false,
  channels: ['in_app'] as NotificationChannelKey[],
})

const { apply: applyFormat } = useTextFormatting(toRef(form, 'body'), bodyRef)

const variables = NOTIFICATION_TYPE_MAP['custom.message'].variables

const timingOptions = computed(() => [
  { value: 'now' as const, label: t('notifications.compose.sendNow'), help: t('notifications.compose.sendNowHelp') },
  { value: 'schedule' as const, label: t('notifications.compose.schedule'), help: t('notifications.compose.scheduleHelp') },
])

const memberCount = computed(() => options.value?.members.length || 0)

/** in_app can't be switched off association-wide, so only email/push are ever gated here. */
function channelOffGlobally(channel: NotificationChannelKey) {
  return channel !== 'in_app' && options.value?.channelsEnabled[channel] === false
}

function filterOptions<T>(list: T[], query: string, label: (item: T) => string) {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter(item => label(item).toLowerCase().includes(q))
}

const memberOptions = computed<SearchSelectOption<number>[]>(() => {
  const selected = new Set(form.memberIds)
  return filterOptions((options.value?.members || []).filter(m => !selected.has(m.id)), memberQuery.value, m => m.name)
    .map(m => ({ key: m.id, value: m.id, label: m.name, meta: m.hasAccount ? undefined : t('notifications.compose.noAccount') }))
})

const subdivisionOptions = computed<SearchSelectOption<number>[]>(() => {
  const selected = new Set(form.subdivisionIds)
  return filterOptions((options.value?.subdivisions || []).filter(s => !selected.has(s.id)), subdivisionQuery.value, s => s.name)
    .map(s => ({ key: s.id, value: s.id, label: s.name }))
})

const userOptions = computed<SearchSelectOption<number>[]>(() => {
  const selected = new Set(form.userIds)
  return filterOptions((options.value?.users || []).filter(u => !selected.has(u.id)), userQuery.value, u => u.username)
    .map(u => ({ key: u.id, value: u.id, label: u.username }))
})

const selectedMemberItems = computed<SelectionListItem[]>(() => form.memberIds.map((id) => {
  const member = options.value?.members.find(m => m.id === id)
  return {
    id,
    label: member?.name || String(id),
    meta: member && !member.hasAccount ? t('notifications.compose.noAccount') : null,
  }
}))

const selectedSubdivisionItems = computed<SelectionListItem[]>(() => form.subdivisionIds.map((id) => {
  const subdivision = options.value?.subdivisions.find(s => s.id === id)
  return { id, label: subdivision?.name || String(id) }
}))

const selectedUserItems = computed<SelectionListItem[]>(() => form.userIds.map((id) => {
  const user = options.value?.users.find(u => u.id === id)
  return { id, label: user?.username || String(id) }
}))

const recipientSummary = computed(() => {
  if (form.allActiveMembers) return t('notifications.compose.allActiveMembers')

  const parts: string[] = []
  if (form.memberIds.length) parts.push(`${form.memberIds.length} ${t('notifications.compose.recipientsMembers')}`)
  if (form.subdivisionIds.length) parts.push(`${form.subdivisionIds.length} ${t('notifications.compose.recipientsSubdivisions')}`)
  if (form.userIds.length) parts.push(`${form.userIds.length} ${t('notifications.compose.recipientsUsers')}`)
  return parts.length ? parts.join(' · ') : t('notifications.compose.noRecipients')
})

const selectedChannelLabels = computed(() => form.channels.map(channel => channelLabel(channel)).join(' · '))

const scheduledForDisplay = computed(() => scheduledFor.value ? scheduledTime(scheduledFor.value) : '')

/** Same `{variable}` placeholders the server fills in at send time — shown with sample values here. */
const previewSamples = computed<Record<string, string>>(() => Object.fromEntries(
  variables.map(variable => [variable, t(`notifications.compose.previewSamples.${variable}`)]),
))

function renderPreview(text: string) {
  return text.replace(/\{([a-z_]+)\}/g, (match, name: string) => previewSamples.value[name] ?? match)
}

const previewSubject = computed(() => renderPreview(form.subject))
const previewBody = computed(() => renderPreview(form.body))
const previewBodyHtml = computed(() => renderNotificationBodyHtml(previewBody.value))

function variableToken(variable: string) {
  return `{${variable}}`
}

const { insert: insertVariable } = useVariableInsert(toRef(form, 'body'), bodyRef)

function onSelectMember(value: unknown) {
  const id = Number(value)
  if (!form.memberIds.includes(id)) form.memberIds.push(id)
  memberQuery.value = ''
}

function onRemoveMember(id: string | number) {
  form.memberIds = form.memberIds.filter(m => m !== Number(id))
}

function onSelectSubdivision(value: unknown) {
  const id = Number(value)
  if (!form.subdivisionIds.includes(id)) form.subdivisionIds.push(id)
  subdivisionQuery.value = ''
}

function onRemoveSubdivision(id: string | number) {
  form.subdivisionIds = form.subdivisionIds.filter(s => s !== Number(id))
}

function onSelectUser(value: unknown) {
  const id = Number(value)
  if (!form.userIds.includes(id)) form.userIds.push(id)
  userQuery.value = ''
}

function onRemoveUser(id: string | number) {
  form.userIds = form.userIds.filter(u => u !== Number(id))
}

async function loadOptions() {
  const res = await $fetch<GetNotificationRecipientOptionsResponse>('/api/notifications/recipient-options')
  if (res.ok) {
    options.value = res
    // A duplicated draft may carry a channel that has since been switched off association-wide.
    form.channels = form.channels.filter(channel => !channelOffGlobally(channel))
  } else {
    toast.error(res.error)
  }
}

function validate(): string[] {
  const list: string[] = []
  if (!form.subject.trim()) list.push(t('notifications.errors.subjectRequired'))
  if (!form.body.trim()) list.push(t('notifications.errors.bodyRequired'))
  if (!form.allActiveMembers && !form.memberIds.length && !form.subdivisionIds.length && !form.userIds.length) {
    list.push(t('notifications.errors.recipientsRequired'))
  }
  if (!form.channels.length) list.push(t('notifications.errors.channelRequired'))
  if (timing.value === 'schedule') {
    if (!scheduledFor.value) list.push(t('notifications.errors.scheduleRequired'))
    // Both sides are plain local wall-clock strings, so a lexical comparison is the correct one
    // (see server/utils/notifications/custom.ts).
    else if (scheduledFor.value < localNowString()) list.push(t('notifications.errors.scheduleInPast'))
  }
  return list
}

function localNowString() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`
}

async function submit() {
  errors.value = validate()
  if (errors.value.length) return

  saving.value = true
  try {
    // Sent as the plain local wall-clock value the input shows — no UTC conversion, matching every
    // other datetime in the app (see DateInput/useDateInput) and how the server stores it.
    const res = await $fetch<CreateNotificationResponse>('/api/notifications/create', {
      method: 'POST',
      body: { ...form, scheduledFor: timing.value === 'schedule' ? scheduledFor.value : null },
    })

    if (res.ok) {
      toast.success(t('actions.saved'))
      // The composed notification shows up in the outbox, so that is where leaving the editor goes —
      // also when the editor was opened without a return target of its own.
      goToReturnTarget({ tab: 'outbox' })
    } else {
      errors.value = [res.error]
    }
  } catch {
    errors.value = [t('settings.notifications.saveFailed')]
  } finally {
    saving.value = false
  }
}

function cancel() {
  goToReturnTarget({ tab: 'outbox' })
}

onMounted(() => {
  // "Duplicate" hands over the whole draft — text, audience and channels — so the copy starts out
  // as the message it was copied from and only needs the edits the author actually wants.
  const prefill = pageMeta.value?.prefill as Partial<CustomNotificationDraft> | undefined
  if (prefill) {
    form.subject = prefill.subject || ''
    form.body = prefill.body || ''
    form.memberIds = [...(prefill.memberIds || [])]
    form.subdivisionIds = [...(prefill.subdivisionIds || [])]
    form.userIds = [...(prefill.userIds || [])]
    form.allActiveMembers = Boolean(prefill.allActiveMembers)
    if (prefill.channels?.length) form.channels = [...prefill.channels]
  }
  loadOptions()
})

useAppRefresh().onRefresh(loadOptions)
</script>
