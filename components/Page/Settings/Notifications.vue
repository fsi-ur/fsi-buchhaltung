<template>
  <CommonCard v-if="loading" :title="t('settings.notifications.title')" :description="t('settings.notifications.intro')">
    <div class="flex items-center justify-center p-10 text-base-400">
      <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" aria-hidden="true" />
    </div>
  </CommonCard>

  <template v-else-if="settings">
    <CommonCard
      :title="t('settings.notifications.title')"
      :description="t('settings.notifications.intro')"
      :tone="settings.notifications_enabled ? 'success' : 'warning'"
    >
      <template #actions>
        <PageAuditTableHistoryButton :tables="['app_settings']" restricted />
      </template>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-base-800">{{ t('settings.notifications.masterSwitch') }}</p>
          <p class="text-xs text-base-600">{{ t('settings.notifications.masterSwitchHelp') }}</p>
        </div>
        <CommonToggleSwitch
          v-model="settings.notifications_enabled"
          :label="t('settings.notifications.masterSwitch')"
        />
      </div>
    </CommonCard>

    <CommonCard :class="dimWhenDisabled" :title="t('settings.notifications.channels')">
      <div class="divide-y divide-base-100">
        <div
          v-for="channel in NOTIFICATION_CHANNELS"
          :key="channel.key"
          class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div class="flex min-w-0 items-start gap-3">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-base-100 text-base-600">
              <Icon :name="channelIcon(channel.key)" class="h-5 w-5" aria-hidden="true" />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-base-800">{{ t(channel.labelKey) }}</p>
              <p class="text-xs text-base-500">{{ t(`settings.notifications.channelHelp.${channel.key}`) }}</p>
              <p v-if="channelWarning(channel.key)" class="mt-1 inline-flex items-center gap-1 text-xs text-warning-600">
                <Icon name="material-symbols:warning-rounded" class="h-4 w-4" aria-hidden="true" />
                {{ channelWarning(channel.key) }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span v-if="channel.key === 'in_app'" class="text-xs text-base-400">
              {{ t('settings.notifications.alwaysOn') }}
            </span>
            <CommonToggleSwitch
              v-model="settings.channels_enabled[channel.key]"
              :disabled="channel.key === 'in_app' || (channel.key === 'push' && !pushConfigured)"
              :label="t(channel.labelKey)"
            />
          </div>
        </div>
      </div>
    </CommonCard>

    <CommonCard
      :class="dimWhenDisabled"
      :title="t('settings.notifications.types')"
      :description="t('settings.notifications.typesHelp')"
    >
      <div class="divide-y divide-base-100">
        <div v-for="typeKey in automaticTypeKeys" :key="typeKey" class="py-3 first:pt-0 last:pb-0">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-3">
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                :class="typeColorClass(typeKey)"
              >
                <Icon :name="typeIcon(typeKey)" class="h-5 w-5" aria-hidden="true" />
              </span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-base-800">{{ typeLabel(typeKey) }}</p>
                <p class="text-xs text-base-500">{{ typeDescription(typeKey) }}</p>
              </div>
            </div>
            <CommonToggleSwitch
              :model-value="isTypeOn(typeKey)"
              :label="typeLabel(typeKey)"
              @update:model-value="setTypeEnabled(typeKey, $event)"
            />
          </div>

          <div v-if="isTypeOn(typeKey)" class="mt-3 overflow-x-auto sm:pl-12">
            <table class="w-full min-w-88 border-separate border-spacing-y-1 text-xs">
              <thead>
                <tr class="text-left text-[11px] font-medium text-base-400">
                  <th class="w-0 pr-2 font-medium"></th>
                  <th class="px-2 font-medium" :title="t('settings.notifications.channelActiveHelp')">
                    {{ t('settings.notifications.channelActiveHeader') }}
                  </th>
                  <th class="px-2 font-medium" :title="t('settings.notifications.channelDefaultHelp')">
                    {{ t('settings.notifications.channelDefaultHeader') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="channel in typeChannelKeys()" :key="channel">
                  <td class="whitespace-nowrap rounded-l-md bg-base-50 py-1.5 pr-2 pl-2 font-medium text-base-600">
                    <span class="inline-flex items-center gap-1.5">
                      <Icon :name="channelIcon(channel)" class="h-4 w-4 shrink-0" aria-hidden="true" />
                      {{ t(`notifications.channels.${channel}`) }}
                    </span>
                  </td>
                  <td class="bg-base-50 px-2 py-1.5">
                    <CommonToggleSwitch
                      :model-value="isTypeChannelOn(typeKey, channel)"
                      :disabled="channelOffGlobally(channel)"
                      :label="`${typeLabel(typeKey)} – ${t(`notifications.channels.${channel}`)} – ${t('settings.notifications.channelActiveHeader')}`"
                      @update:model-value="toggleTypeChannel(typeKey, channel)"
                    />
                    <span v-if="channelOffGlobally(channel)" class="mt-0.5 block text-[10px] text-warning-600">
                      {{ t('settings.notifications.channelOffGlobally') }}
                    </span>
                  </td>
                  <td class="rounded-r-md bg-base-50 px-2 py-1.5">
                    <CommonToggleSwitch
                      v-if="defaultChannelKeys.includes(channel)"
                      :model-value="isDefaultChannelOn(typeKey, channel)"
                      :disabled="!isTypeChannelOn(typeKey, channel) || channelOffGlobally(channel)"
                      :label="`${typeLabel(typeKey)} – ${t(`notifications.channels.${channel}`)} – ${t('settings.notifications.channelDefaultHeader')}`"
                      @update:model-value="toggleDefaultChannel(typeKey, channel)"
                    />
                    <span v-else class="text-base-400">{{ t('settings.notifications.alwaysOn') }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-else class="mt-2 text-xs text-warning-600 sm:pl-12">
            {{ t('settings.notifications.typeDisabledHint') }}
          </p>
        </div>
      </div>
    </CommonCard>

    <CommonCard :class="dimWhenDisabled" :title="t('settings.notifications.behaviour')">
      <div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-base-800">{{ t('settings.notifications.quietHours') }}</p>
            <p class="text-xs text-base-500">{{ t('settings.notifications.quietHoursHelp') }}</p>
          </div>
          <CommonToggleSwitch
            v-model="settings.quiet_hours.enabled"
            :label="t('settings.notifications.quietHoursEnabled')"
          />
        </div>

        <div v-if="settings.quiet_hours.enabled" class="mt-3 flex flex-wrap items-end gap-3">
          <div class="field">
            <label for="quiet-hours-start">{{ t('settings.notifications.quietHoursStart') }}</label>
            <input id="quiet-hours-start" v-model="settings.quiet_hours.start" type="time" class="input w-32">
          </div>
          <div class="field">
            <label for="quiet-hours-end">{{ t('settings.notifications.quietHoursEnd') }}</label>
            <input id="quiet-hours-end" v-model="settings.quiet_hours.end" type="time" class="input w-32">
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-base-100 pt-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-base-800">{{ t('settings.notifications.skipDeclinedAppointmentReminders') }}</p>
          <p class="text-xs text-base-500">{{ t('settings.notifications.skipDeclinedAppointmentRemindersHelp') }}</p>
        </div>
        <CommonToggleSwitch
          v-model="settings.skip_declined_appointment_reminders"
          :label="t('settings.notifications.skipDeclinedAppointmentReminders')"
        />
      </div>

      <div class="flex flex-wrap gap-6 border-t border-base-100 pt-4">
        <div class="field">
          <label for="inbox-retention-days">{{ t('settings.notifications.inboxRetentionDays') }}</label>
          <input id="inbox-retention-days" v-model.number="settings.inbox_retention_days" type="number" min="1" class="input w-32">
          <p class="max-w-xs text-xs text-base-500">{{ t('settings.notifications.inboxRetentionDaysHelp') }}</p>
        </div>
        <div class="field">
          <label for="retention-days">{{ t('settings.notifications.retentionDays') }}</label>
          <input id="retention-days" v-model.number="settings.retention_days" type="number" min="1" class="input w-32">
          <p class="max-w-xs text-xs text-base-500">{{ t('settings.notifications.retentionDaysHelp') }}</p>
        </div>
      </div>
    </CommonCard>

    <CommonCard
      :class="dimWhenDisabled"
      :title="t('settings.notifications.leadTimes')"
      :description="t('settings.notifications.leadTimesHelp')"
    >
      <p class="-mt-1 inline-flex items-start gap-1 text-xs text-base-400">
        <Icon name="material-symbols:info-outline-rounded" class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {{ t('settings.notifications.leadTimesPastHint') }}
      </p>

      <div
        v-for="typeKey in scheduledTypeKeys"
        :key="typeKey"
        class="rounded-lg border border-base-100 p-3 space-y-2"
      >
        <div class="flex items-center gap-2">
          <Icon :name="typeIcon(typeKey)" class="h-4 w-4 shrink-0 text-base-400" aria-hidden="true" />
          <p class="text-sm font-medium text-base-700">{{ typeLabel(typeKey) }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <span
            v-for="minutes in sortedLeadTimes(typeKey)"
            :key="minutes"
            class="inline-flex items-center gap-1 rounded-md bg-secondary-50 py-1 pr-1 pl-2 text-xs font-medium text-secondary-800"
          >
            {{ t('settings.notifications.leadBefore', { value: formatLeadMinutes(minutes) }) }}
            <button
              type="button"
              class="rounded p-0.5 text-secondary-600 transition hover:bg-secondary-100 cursor-pointer"
              :title="t('actions.remove')"
              :aria-label="t('actions.remove')"
              @click="removeLeadTime(typeKey, minutes)"
            >
              <Icon name="material-symbols:close-rounded" class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
          <span v-if="!sortedLeadTimes(typeKey).length" class="text-xs text-base-400">
            {{ t('settings.notifications.leadTimesNone') }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input
            v-model.number="leadDrafts[typeKey].value"
            type="number"
            min="1"
            class="input w-20"
            :aria-label="t('settings.notifications.leadTimeAdd')"
            @keydown.enter.prevent="addLeadTime(typeKey)"
          >
          <select v-model="leadDrafts[typeKey].unit" class="input w-28">
            <option value="minutes">{{ t('settings.notifications.unitMinutes') }}</option>
            <option value="hours">{{ t('settings.notifications.unitHours') }}</option>
            <option value="days">{{ t('settings.notifications.unitDays') }}</option>
          </select>
          <button
            type="button"
            class="btn-secondary inline-flex items-center gap-1"
            @click="addLeadTime(typeKey)"
          >
            <Icon name="material-symbols:add-rounded" class="h-4 w-4" aria-hidden="true" />
            {{ t('settings.notifications.leadTimeAdd') }}
          </button>
        </div>
      </div>
    </CommonCard>

    <CommonCard
      :class="dimWhenDisabled"
      :title="t('settings.notifications.templates')"
      :description="t('settings.notifications.templatesHelp')"
    >
      <div v-for="typeKey in templateTypeKeys" :key="typeKey" class="rounded-lg border border-base-100">
        <button
          type="button"
          class="flex w-full items-center gap-2 p-3 text-left cursor-pointer"
          @click="toggleTemplate(typeKey)"
        >
          <Icon :name="typeIcon(typeKey)" class="h-4 w-4 shrink-0 text-base-400" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-base-700">{{ typeLabel(typeKey) }}</span>
            <span class="block truncate text-xs text-base-500">{{ typeDescription(typeKey) }}</span>
          </span>
          <span
            v-if="hasTemplateOverride(typeKey)"
            class="shrink-0 rounded-md bg-secondary-100 px-2 py-0.5 text-[11px] font-medium text-secondary-800"
          >
            {{ t('settings.notifications.templateCustom') }}
          </span>
          <Icon
            :name="openTemplates.includes(typeKey) ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
            class="h-5 w-5 shrink-0 text-base-400"
            aria-hidden="true"
          />
        </button>

        <div v-if="openTemplates.includes(typeKey)" class="space-y-2 border-t border-base-100 p-3">
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="variable in typeVariables(typeKey)"
              :key="variable"
              class="rounded-md border border-base-200 bg-base-50 px-2 py-0.5 text-[11px] font-medium text-base-600"
              :title="variableDescription(variable)"
            >
              {{ variableToken(variable) }}
            </span>
          </div>

          <div class="field">
            <label>{{ t('notifications.compose.subject') }}</label>
            <input
              :value="settings.templates[typeKey]?.subject || ''"
              type="text"
              class="input"
              :placeholder="t(`notifications.types.${typeKey}.subject`)"
              @input="updateTemplate(typeKey, 'subject', ($event.target as HTMLInputElement).value)"
            >
          </div>

          <div class="field">
            <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label class="mb-0">{{ t('notifications.compose.body') }}</label>
              <CommonTextFormatToolbar @action="applyTemplateFormat(typeKey, $event)" />
            </div>
            <textarea
              :ref="el => setTemplateBodyRef(typeKey, el as Element | null)"
              :value="settings.templates[typeKey]?.body || ''"
              rows="3"
              class="input resize-y"
              :placeholder="t(`notifications.types.${typeKey}.body`)"
              @input="updateTemplate(typeKey, 'body', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
            <p class="mt-1 text-xs text-base-400">{{ t('notifications.compose.formatHelp') }}</p>
          </div>

          <div class="flex justify-end">
            <button
              type="button"
              class="text-xs font-medium text-base-500 hover:text-base-700 hover:underline cursor-pointer"
              :disabled="!hasTemplateOverride(typeKey)"
              :class="{ 'cursor-not-allowed opacity-50': !hasTemplateOverride(typeKey) }"
              @click="resetTemplate(typeKey)"
            >
              {{ t('settings.notifications.templateReset') }}
            </button>
          </div>
        </div>
      </div>
    </CommonCard>

    <CommonCard :class="dimWhenDisabled" :title="t('settings.notifications.emailPresentation')">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="field">
          <label for="email-from-name">{{ t('settings.notifications.emailFromName') }}</label>
          <input id="email-from-name" v-model="settings.email_from_name" type="text" class="input">
        </div>
        <div class="field">
          <label for="email-subject-prefix">{{ t('settings.notifications.emailSubjectPrefix') }}</label>
          <input id="email-subject-prefix" v-model="settings.email_subject_prefix" type="text" class="input">
        </div>
      </div>
      <div class="field">
        <div class="mb-1 flex flex-wrap items-center justify-between gap-2">
          <label for="email-footer" class="mb-0">{{ t('settings.notifications.emailFooter') }}</label>
          <CommonTextFormatToolbar @action="applyFooterFormat" />
        </div>
        <div class="mb-1.5 flex flex-wrap gap-1.5">
          <button
            v-for="variable in footerVariables"
            :key="variable"
            type="button"
            class="rounded-md border border-base-200 bg-base-50 px-2 py-0.5 text-[11px] font-medium text-base-600 transition hover:border-secondary-400 hover:text-secondary-700 cursor-pointer"
            :title="`${variableDescription(variable)} — ${t('notifications.compose.insertVariable')}`"
            @click="insertFooterVariable(variable)"
          >
            {{ variableToken(variable) }}
          </button>
        </div>
        <textarea
          id="email-footer"
          ref="footerRef"
          v-model="settings.email_footer"
          rows="5"
          class="input resize-y"
          style="resize: vertical; min-height: 6rem;"
        ></textarea>
        <p class="mt-1 text-xs text-base-400">{{ t('notifications.compose.formatHelp') }}</p>
      </div>
    </CommonCard>

    <div class="sticky bottom-0 col-span-12 -mx-6 flex flex-wrap items-center justify-end gap-3 border-t border-base-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-6 sm:shadow-lg">
      <span v-if="dirty" class="mr-auto inline-flex items-center gap-1 text-xs text-warning-600">
        <Icon name="material-symbols:error-outline-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('settings.notifications.unsavedChanges') }}
      </span>
      <button
        type="button"
        class="btn-secondary"
        :disabled="!dirty || saving"
        :class="{ 'opacity-50 cursor-not-allowed': !dirty || saving }"
        @click="load"
      >
        {{ t('actions.discard') }}
      </button>
      <button
        type="button"
        class="btn-primary inline-flex items-center gap-2"
        :disabled="saving"
        :class="{ 'opacity-50 cursor-not-allowed': saving }"
        @click="save"
      >
        <Icon name="material-symbols:save-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('settings.notifications.save') }}
      </button>
    </div>
  </template>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useNotificationDisplay } from '~/composables/useNotificationDisplay'
import { useTextFormatting } from '~/composables/useTextFormatting'
import { useVariableInsert } from '~/composables/useVariableInsert'
import { NOTIFICATION_CHANNELS, type NotificationChannelKey } from '~/config/notificationChannels'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_MAP, EMAIL_FOOTER_VARIABLES, type NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationSettings } from '~/types/notification'
import type { GetNotificationSettingsResponse } from '~/server/api/settings/notifications.get'
import type { SaveNotificationSettingsResponse } from '~/server/api/settings/notifications.save.post'
import { applyFormatAction, type FormatActionKey } from '~/utils/notificationFormatting'

const { t } = useI18n()
const toast = useToast()
const { typeIcon, typeColorClass, typeLabel, typeDescription, channelIcon, formatLeadMinutes, variableDescription } = useNotificationDisplay()

const loading = ref(true)
const saving = ref(false)
const smtpConfigured = ref(false)
const pushConfigured = ref(false)
const settings = ref<NotificationSettings | null>(null)
const savedSnapshot = ref('')
const openTemplates = ref<NotificationTypeKey[]>([])

const scheduledTypeKeys = NOTIFICATION_TYPES.filter(type => type.schedule).map(type => type.key)
const templateTypeKeys = NOTIFICATION_TYPES.map(type => type.key)
// `custom.message` is composed by hand every time — there is nothing to switch off in advance.
const automaticTypeKeys = NOTIFICATION_TYPES.filter(type => type.key !== 'custom.message').map(type => type.key)

const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const

const leadDrafts = reactive(Object.fromEntries(
  scheduledTypeKeys.map(key => [key, { value: 1, unit: 'days' as keyof typeof UNIT_MINUTES }]),
) as Record<NotificationTypeKey, { value: number, unit: keyof typeof UNIT_MINUTES }>)

const ALL_CHANNELS: NotificationChannelKey[] = ['in_app', 'email', 'push']

function canonicalizeSettings(input: NotificationSettings): NotificationSettings {
  const typeSettings: NotificationSettings['type_settings'] = {}
  for (const key of Object.keys(input.type_settings).sort() as NotificationTypeKey[]) {
    const entry = input.type_settings[key]
    if (!entry) continue
    const channels: Partial<Record<NotificationChannelKey, boolean>> = {}
    for (const channel of ALL_CHANNELS) {
      if (entry.channels?.[channel] === false) channels[channel] = false
    }
    const enabled = entry.enabled !== false
    if (enabled && !Object.keys(channels).length) continue
    typeSettings[key] = { enabled, channels }
  }

  const defaultChannels: NotificationSettings['default_channels'] = {}
  for (const key of Object.keys(input.default_channels).sort() as NotificationTypeKey[]) {
    const entry = input.default_channels[key]
    if (!entry) continue
    const channels: Partial<Record<NotificationChannelKey, boolean>> = {}
    for (const channel of ALL_CHANNELS) {
      if (entry[channel] === false) channels[channel] = false
    }
    if (Object.keys(channels).length) defaultChannels[key] = channels
  }

  const templates: NotificationSettings['templates'] = {}
  for (const key of Object.keys(input.templates).sort() as NotificationTypeKey[]) {
    const entry = input.templates[key]
    const subject = entry?.subject?.trim() || ''
    const body = entry?.body?.trim() || ''
    if (subject || body) templates[key] = { subject, body }
  }

  return { ...input, type_settings: typeSettings, default_channels: defaultChannels, templates }
}

function snapshot(input: NotificationSettings): string {
  return JSON.stringify(canonicalizeSettings(input))
}

const dirty = computed(() => settings.value !== null && snapshot(settings.value) !== savedSnapshot.value)

const dimWhenDisabled = computed(() => (settings.value?.notifications_enabled ? '' : 'opacity-60'))

function channelWarning(channel: NotificationChannelKey) {
  if (channel === 'email' && !smtpConfigured.value) return t('settings.notifications.smtpNotConfigured')
  if (channel === 'push' && !pushConfigured.value) return t('settings.notifications.pushNotConfigured')
  return ''
}

function typeChannelKeys(): NotificationChannelKey[] {
  return NOTIFICATION_CHANNELS.map(channel => channel.key)
}

function channelOffGlobally(channel: NotificationChannelKey) {
  return channel !== 'in_app' && !settings.value?.channels_enabled[channel]
}

function isTypeOn(typeKey: NotificationTypeKey) {
  return settings.value?.type_settings[typeKey]?.enabled !== false
}

function isTypeChannelOn(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  return settings.value?.type_settings[typeKey]?.channels?.[channel] !== false
}

function typeEntry(typeKey: NotificationTypeKey) {
  return settings.value?.type_settings[typeKey] ?? { enabled: true, channels: {} }
}

function setTypeEnabled(typeKey: NotificationTypeKey, enabled: boolean) {
  if (!settings.value) return
  settings.value.type_settings = { ...settings.value.type_settings, [typeKey]: { ...typeEntry(typeKey), enabled } }
}

/** Channels are stored as explicit `false` entries only — switching one back on removes the entry. */
function toggleTypeChannel(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  if (!settings.value) return
  const entry = typeEntry(typeKey)
  const channels = { ...entry.channels }
  if (channels[channel] === false) delete channels[channel]
  else channels[channel] = false
  settings.value.type_settings = { ...settings.value.type_settings, [typeKey]: { ...entry, channels } }
}

const defaultChannelKeys: NotificationChannelKey[] = ['email', 'push']

function defaultChannelEntry(typeKey: NotificationTypeKey) {
  return settings.value?.default_channels[typeKey] ?? {}
}

function isDefaultChannelOn(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  return defaultChannelEntry(typeKey)[channel] !== false
}

function toggleDefaultChannel(typeKey: NotificationTypeKey, channel: NotificationChannelKey) {
  if (!settings.value) return
  const channels = { ...defaultChannelEntry(typeKey) }
  if (channels[channel] === false) delete channels[channel]
  else channels[channel] = false
  settings.value.default_channels = { ...settings.value.default_channels, [typeKey]: channels }
}

function variableToken(variable: string) {
  return `{${variable}}`
}

function typeVariables(typeKey: NotificationTypeKey) {
  return NOTIFICATION_TYPE_MAP[typeKey]?.variables || []
}

function sortedLeadTimes(typeKey: NotificationTypeKey) {
  return [...(settings.value?.lead_times[typeKey] || [])].sort((a, b) => b - a)
}

function addLeadTime(typeKey: NotificationTypeKey) {
  if (!settings.value) return
  const draft = leadDrafts[typeKey]
  const minutes = Math.round(Number(draft.value) * UNIT_MINUTES[draft.unit])
  if (!Number.isInteger(minutes) || minutes <= 0) return

  const current = settings.value.lead_times[typeKey] || []
  if (current.includes(minutes)) return
  settings.value.lead_times[typeKey] = [...current, minutes].sort((a, b) => b - a)
}

function removeLeadTime(typeKey: NotificationTypeKey, minutes: number) {
  if (!settings.value) return
  settings.value.lead_times[typeKey] = (settings.value.lead_times[typeKey] || []).filter(value => value !== minutes)
}

function toggleTemplate(typeKey: NotificationTypeKey) {
  openTemplates.value = openTemplates.value.includes(typeKey)
    ? openTemplates.value.filter(key => key !== typeKey)
    : [...openTemplates.value, typeKey]
}

function hasTemplateOverride(typeKey: NotificationTypeKey) {
  const template = settings.value?.templates[typeKey]
  return Boolean(template?.subject?.trim() || template?.body?.trim())
}

function updateTemplate(typeKey: NotificationTypeKey, field: 'subject' | 'body', value: string) {
  if (!settings.value) return
  const current = settings.value.templates[typeKey] || { subject: '', body: '' }
  settings.value.templates[typeKey] = { ...current, [field]: value }
}

function resetTemplate(typeKey: NotificationTypeKey) {
  if (!settings.value) return
  settings.value.templates[typeKey] = { subject: '', body: '' }
}

const templateBodyRefs = reactive<Partial<Record<NotificationTypeKey, HTMLTextAreaElement | null>>>({})

function setTemplateBodyRef(typeKey: NotificationTypeKey, el: Element | null) {
  templateBodyRefs[typeKey] = (el as HTMLTextAreaElement | null)
}

function applyTemplateFormat(typeKey: NotificationTypeKey, key: FormatActionKey) {
  const textarea = templateBodyRefs[typeKey] || null
  const currentValue = settings.value?.templates[typeKey]?.body || ''
  const start = textarea?.selectionStart ?? currentValue.length
  const end = textarea?.selectionEnd ?? currentValue.length
  const result = applyFormatAction(key, currentValue, start, end)
  updateTemplate(typeKey, 'body', result.value)

  nextTick(() => {
    textarea?.focus()
    textarea?.setSelectionRange(result.selectionStart, result.selectionEnd)
  })
}

const footerRef = ref<HTMLTextAreaElement | null>(null)
const emailFooter = computed({
  get: () => settings.value?.email_footer || '',
  set: (value: string) => {
    if (settings.value) settings.value.email_footer = value
  },
})
const { apply: applyFooterFormat } = useTextFormatting(emailFooter, footerRef)
const { insert: insertFooterVariable } = useVariableInsert(emailFooter, footerRef)

// The footer is appended to every notification type's e-mail, so only the variables every
// notification's payload actually carries — the recipient plus the (static) association ones —
// are safe to offer here; see server/utils/notifications/dispatch.ts.
const footerVariables = EMAIL_FOOTER_VARIABLES

async function load() {
  loading.value = true
  try {
    const res = await $fetch<GetNotificationSettingsResponse>('/api/settings/notifications')
    if (res.ok) {
      settings.value = res.settings
      savedSnapshot.value = snapshot(res.settings)
      smtpConfigured.value = res.smtpConfigured
      pushConfigured.value = res.pushConfigured
    } else {
      toast.error(res.error)
    }
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!settings.value) return
  saving.value = true
  try {
    const res = await $fetch<SaveNotificationSettingsResponse>('/api/settings/notifications.save', { method: 'POST', body: settings.value })
    if (res.ok) {
      settings.value = res.settings
      savedSnapshot.value = snapshot(res.settings)
      toast.success(t('settings.notifications.saved'))
    } else {
      toast.error(res.error)
    }
  } catch {
    toast.error(t('settings.notifications.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(load)

useAppRefresh().onRefresh(() => {
  if (!dirty.value) return load()
})
</script>
