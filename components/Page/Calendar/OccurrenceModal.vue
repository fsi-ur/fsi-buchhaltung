<template>
  <CommonModal
    :model-value="modelValue"
    :title="entry?.title || ''"
    width-class="max-w-2xl"
    @update:model-value="$emit('update:modelValue', $event)"
    @close="$emit('close')"
  >
    <div v-if="entry" class="space-y-5">
      <p
        v-if="entry.isCancelled"
        class="flex items-center gap-2 rounded-xl bg-danger-50 px-3 py-2 text-sm font-semibold text-danger-700"
      >
        <Icon name="material-symbols:event-busy-rounded" class="shrink-0 text-base" />
        {{ t('calendar.detail.cancelledNotice') }}
      </p>

      <div class="space-y-2 rounded-xl border border-base-200 bg-base-50/60 p-3">
        <p class="flex items-start gap-2 text-sm font-medium text-base-900">
          <Icon name="material-symbols:schedule-rounded" class="mt-0.5 shrink-0 text-base text-base-400" />
          <span>{{ timeLabel }}</span>
        </p>

        <p class="flex items-start gap-2 text-sm" :class="entry.location ? 'text-base-700' : 'text-base-400'">
          <Icon name="material-symbols:location-on-rounded" class="mt-0.5 shrink-0 text-base text-base-400" />
          <span>{{ entry.location || t('calendar.detail.noLocation') }}</span>
        </p>

        <div class="flex flex-wrap items-center gap-2 pt-0.5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
            :style="badgeStyle"
          >
            <Icon :name="entry.icon" class="text-sm" />
            {{ entry.typeName || t(`calendar.sources.${entry.source}`) }}
          </span>

          <span
            v-if="isSeries"
            class="inline-flex items-center gap-1 rounded-full bg-base-100 px-2 py-0.5 text-xs font-medium text-base-600"
          >
            <Icon name="material-symbols:repeat-rounded" class="text-sm" />
            {{ t('calendar.detail.series') }}
          </span>
        </div>
      </div>

      <div
        v-if="entry.source !== 'appointment'"
        class="flex items-start gap-2 rounded-xl border border-base-200 bg-white p-3 text-sm text-base-600"
      >
        <Icon name="material-symbols:lock-outline" class="mt-0.5 shrink-0 text-base text-base-400" />
        <div>
          <p>{{ t('calendar.detail.readOnly') }}</p>
          <button
            v-if="entry.eventId && canOpenEvent"
            type="button"
            class="mt-1 inline-flex cursor-pointer items-center gap-1 font-medium text-link-600 hover:underline"
            @click="openEvent"
          >
            {{ t('calendar.detail.openEvent') }}
            <Icon name="material-symbols:arrow-forward-rounded" class="text-sm" />
          </button>
        </div>
      </div>

      <template v-else>
        <div v-if="loading" class="flex items-center gap-2 text-sm text-base-500">
          <Icon name="material-symbols:progress-activity" class="animate-spin text-base" />
          {{ t('calendar.form.loading') }}
        </div>

        <CommonValidationSummary v-else-if="loadError" :errors="[loadError]" :title="t('calendar.validation.summaryTitle')" />

        <template v-else-if="detail">
          <!-- RSVP first: it is the one thing the reader is here to *do*. -->
          <section
            v-if="entry.canRespond && !entry.isCancelled"
            class="rounded-xl border border-base-200 p-3"
          >
            <h4 class="text-sm font-semibold text-base-800">{{ t('calendar.rsvp.question') }}</h4>

            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="option in responseOptions"
                :key="option.value"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition"
                :class="[
                  ownResponse === option.value ? option.activeClass : option.idleClass,
                  isResponding ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                ]"
                :aria-pressed="ownResponse === option.value"
                :disabled="isResponding"
                @click="respond(option.value)"
              >
                <Icon
                  :name="pendingResponse === option.value ? 'material-symbols:progress-activity' : option.icon"
                  class="text-base"
                  :class="pendingResponse === option.value ? 'animate-spin' : ''"
                />
                {{ option.label }}
              </button>
            </div>

            <label
              v-if="isSeries"
              class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-base-700"
            >
              <input v-model="applyToSeries" type="checkbox" class="checkbox" />
              {{ t('calendar.rsvp.applyToSeries') }}
            </label>
          </section>

          <p
            v-else-if="entry.canRespond && entry.isCancelled"
            class="rounded-xl bg-base-50 px-3 py-2 text-sm text-base-500"
          >
            {{ t('calendar.rsvp.cancelledHint') }}
          </p>

          <!-- Agenda -->
          <section>
            <h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-base-400">{{ t('calendar.detail.agenda') }}</h4>
            <!-- Sanitised server-side by renderArticle (the same renderer the wiki uses). -->
            <div v-if="detail.appointment.agenda_html" class="wiki-article-body text-sm" v-html="detail.appointment.agenda_html" />
            <p v-else class="text-sm text-base-400">{{ t('calendar.detail.noAgenda') }}</p>
          </section>

          <section>
            <h4 class="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs font-semibold uppercase tracking-wide text-base-400">
              <span>{{ t('calendar.detail.participants') }}</span>
              <span v-if="entry.responseSummary" class="font-medium normal-case tracking-normal text-base-500">
                {{ t('calendar.rsvp.summary', {
                  yes: entry.responseSummary.yes,
                  no: entry.responseSummary.no,
                  maybe: entry.responseSummary.maybe,
                }) }}
                <template v-if="entry.responseSummary.pending">
                  · {{ t('calendar.detail.pendingCount', { count: entry.responseSummary.pending }) }}
                </template>
              </span>
            </h4>

            <ul
              v-if="participantRows.length"
              class="max-h-64 divide-y divide-base-100 overflow-y-auto rounded-xl border border-base-200"
            >
              <li
                v-for="participant in participantRows"
                :key="participant.id"
                class="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
              >
                <span class="truncate text-base-800">{{ participant.name }}</span>
                <span
                  class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  :class="participant.response ? responseBadgeClass(participant.response) : 'bg-base-100 text-base-500'"
                >
                  <Icon v-if="participant.response" :name="responseIcon(participant.response)" class="text-[13px]" />
                  {{ participant.response ? t(`calendar.rsvp.${participant.response}Short`) : t('calendar.rsvp.pending') }}
                </span>
              </li>
            </ul>

            <p v-else class="text-sm text-base-400">{{ t('calendar.detail.noParticipants') }}</p>
          </section>
        </template>
      </template>
    </div>

    <template #footer>
      <div v-if="canEdit" class="mr-auto flex items-center gap-1">
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-danger-600 transition hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="loading"
          :title="loading ? t('calendar.form.loading') : ''"
          @click="$emit('delete', entry!, isSeries)"
        >
          <Icon name="material-symbols:delete-outline-rounded" class="text-base" />
          {{ t('calendar.detail.delete') }}
        </button>

        <button
          v-if="detail"
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-base-600 transition hover:bg-base-100 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="isTogglingCancel || loading"
          @click="onCancelClick"
        >
          <Icon
            :name="isTogglingCancel ? 'material-symbols:progress-activity' : isSeriesCancelled ? 'material-symbols:event-available-outline-rounded' : 'material-symbols:event-busy-outline-rounded'"
            class="text-base"
            :class="isTogglingCancel ? 'animate-spin' : ''"
          />
          {{ isSeriesCancelled ? t('calendar.detail.reactivate') : t('calendar.detail.cancelAppointment') }}
        </button>
      </div>

      <button class="btn-secondary" @click="$emit('close')">
        {{ t('actions.close') }}
      </button>

      <button
        v-if="canEdit"
        class="btn-primary inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="loading"
        :title="loading ? t('calendar.form.loading') : ''"
        @click="$emit('edit', entry!, isSeries)"
      >
        <Icon name="material-symbols:edit-outline-rounded" class="text-base" />
        {{ t('calendar.detail.edit') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import type { GetAppointmentResponse } from '~/server/api/appointments/[id].get'
import type { AppointmentResponseValue, CalendarEntry } from '~/types/appointment'

const props = defineProps<{
  modelValue: boolean
  entry: CalendarEntry | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
  (e: 'edit', entry: CalendarEntry, isSeries: boolean): void
  (e: 'delete', entry: CalendarEntry, isSeries: boolean): void
  (e: 'responded'): void
  (e: 'cancelToggled'): void
  (e: 'cancelRequested', entry: CalendarEntry, isSeries: boolean): void
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()
const toast = useToast()
const { setPage } = usePage()
const { formatDate } = useLocaleFormatters()

type AppointmentDetailResponse = Extract<GetAppointmentResponse, { ok: true }>

const loading = ref(false)
const loadError = ref('')
const detail = ref<AppointmentDetailResponse | null>(null)
const isResponding = ref(false)
/** Which button is waiting on the server, so the spinner sits on the one that was pressed. */
const pendingResponse = ref<AppointmentResponseValue | null>(null)
const applyToSeries = ref(false)
const ownResponse = ref<AppointmentResponseValue | null>(null)

const canOpenEvent = computed(() => hasPermission(['events.access', 'events.view', 'events.shifts.signup']))
const canEdit = computed(() => Boolean(props.entry?.source === 'appointment' && props.entry.canEdit))
const isSeries = computed(() => Boolean(detail.value?.appointment.recurrence_freq))
/**
 * Whole-appointment cancellation, distinct from a single cancelled occurrence: `detail.appointment
 * .status` reflects the series/appointment row itself, not the per-date override `entry.isCancelled`
 * also folds in.
 */
const isSeriesCancelled = computed(() => detail.value?.appointment.status === 'cancelled')
const isTogglingCancel = ref(false)

const badgeStyle = computed(() => {
  const color = props.entry?.color ?? '#94a3b8'
  return {
    backgroundColor: `color-mix(in srgb, ${color} 16%, white)`,
    color: `color-mix(in srgb, ${color} 75%, black)`,
  }
})

const timeLabel = computed(() => {
  const entry = props.entry
  if (!entry) return ''
  if (entry.allDay) {
    const start = formatDate(entry.startsAt)
    const end = formatDate(entry.endsAt)
    return start === end ? `${start} · ${t('calendar.allDay')}` : `${start} – ${end} · ${t('calendar.allDay')}`
  }
  return `${formatDate(entry.startsAt)}, ${entry.startsAt.slice(11, 16)} – ${entry.endsAt.slice(11, 16)}`
})

const responseOptions = computed(() => ([
  {
    value: 'yes' as const,
    label: t('calendar.rsvp.yes'),
    icon: 'material-symbols:check-circle-rounded',
    activeClass: 'border-transparent bg-success-500 text-white',
    idleClass: 'border-base-200 bg-white text-base-600 hover:border-success-300 hover:bg-success-50 hover:text-success-700',
  },
  {
    value: 'maybe' as const,
    label: t('calendar.rsvp.maybe'),
    icon: 'material-symbols:help-rounded',
    activeClass: 'border-transparent bg-warning-500 text-white',
    idleClass: 'border-base-200 bg-white text-base-600 hover:border-warning-300 hover:bg-warning-50 hover:text-warning-700',
  },
  {
    value: 'no' as const,
    label: t('calendar.rsvp.no'),
    icon: 'material-symbols:cancel-rounded',
    activeClass: 'border-transparent bg-danger-500 text-white',
    idleClass: 'border-base-200 bg-white text-base-600 hover:border-danger-300 hover:bg-danger-50 hover:text-danger-700',
  },
]))

const participantRows = computed(() => {
  if (!detail.value || !props.entry) return []

  const responsesByMember = new Map(
    detail.value.responses
      .filter(response => response.occurrence_date === props.entry?.occurrenceDate)
      .map(response => [response.member_id, response.response]),
  )

  return detail.value.participants.map(participant => ({
    ...participant,
    response: responsesByMember.get(participant.id) ?? null,
  }))
})

function responseBadgeClass(response: AppointmentResponseValue) {
  if (response === 'yes') return 'bg-success-100 text-success-700'
  if (response === 'no') return 'bg-danger-100 text-danger-700'
  return 'bg-warning-100 text-warning-700'
}

function responseIcon(response: AppointmentResponseValue) {
  if (response === 'yes') return 'material-symbols:check-circle-rounded'
  if (response === 'no') return 'material-symbols:cancel-rounded'
  return 'material-symbols:help-rounded'
}

function openEvent() {
  const entry = props.entry
  if (!entry?.eventId) return
  setPage('EventCreate', {
    eventId: entry.eventId,
    ...(entry.eventTab ? { tab: entry.eventTab } : {}),
    returnTarget: buildReturnTarget('Calendar'),
  })
}

async function loadDetail() {
  const entry = props.entry
  if (!entry || entry.source !== 'appointment') {
    detail.value = null
    return
  }

  loading.value = true
  loadError.value = ''
  applyToSeries.value = false

  try {
    const res = await $fetch<GetAppointmentResponse>(`/api/appointments/${entry.id}`)
    if (res.ok) {
      detail.value = res
      return
    }
    detail.value = null
    loadError.value = res.error || t('calendar.detail.loadFailed')
  } catch {
    detail.value = null
    loadError.value = t('calendar.detail.loadFailed')
  } finally {
    loading.value = false
  }
}

async function respond(response: AppointmentResponseValue) {
  const entry = props.entry
  if (!entry || entry.source !== 'appointment' || isResponding.value) return

  isResponding.value = true
  pendingResponse.value = response
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/appointments/${entry.id}/respond`, {
      method: 'POST',
      body: {
        occurrenceDate: entry.occurrenceDate,
        response,
        applyToSeries: applyToSeries.value,
      },
    })

    if (!res.ok) {
      toast.error(res.error || t('calendar.rsvp.failed'))
      return
    }

    toast.success(t('calendar.rsvp.saved'))
    // Reflect the answer immediately — the parent's reload (via 'responded') only lands once it
    // resolves, and `entry` itself will not carry it until the parent re-passes a fresh object.
    ownResponse.value = response
    emit('responded')
    await loadDetail()
  } catch {
    toast.error(t('calendar.rsvp.failed'))
  } finally {
    isResponding.value = false
    pendingResponse.value = null
  }
}

function onCancelClick() {
  const entry = props.entry
  if (!entry || entry.source !== 'appointment') return

  if (isSeriesCancelled.value) {
    void reactivate()
    return
  }

  emit('cancelRequested', entry, isSeries.value)
}

async function reactivate() {
  const entry = props.entry
  if (!entry || entry.source !== 'appointment' || isTogglingCancel.value) return

  isTogglingCancel.value = true
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/appointments/${entry.id}/cancel`, {
      method: 'POST',
      body: { cancelled: false },
    })

    if (!res.ok) {
      toast.error(res.error || t('calendar.detail.cancelFailed'))
      return
    }

    toast.success(t('calendar.detail.reactivated'))
    emit('cancelToggled')
    await loadDetail()
  } catch {
    toast.error(t('calendar.detail.cancelFailed'))
  } finally {
    isTogglingCancel.value = false
  }
}

watch(() => [props.modelValue, props.entry?.key] as const, ([open]) => {
  if (!open) return
  ownResponse.value = props.entry?.ownResponse ?? null
  loadDetail()
}, { immediate: true })
</script>
