<template>
  <Page @open-menu="$emit('openMenu')">
    <template #cards>
      <section class="col-span-12 -mx-6 -mb-6 isolate bg-white shadow-sm sm:m-0 sm:rounded-xl sm:shadow-lg">
        <div ref="headerSentinelRef" class="h-px" />
        <div
          class="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 bg-base-900 px-4 py-3 text-white transition-[border-radius] sm:px-6"
          :class="isHeaderStuck ? '' : 'sm:rounded-t-xl'"
        >
          <div class="min-w-0">
            <h2 class="text-base font-semibold sm:text-lg">
              {{ appointmentId ? t('calendar.form.editTitle') : t('calendar.form.createTitle') }}
            </h2>
            <p v-if="scopeLabel" class="text-xs text-base-300">{{ scopeLabel }}</p>
          </div>

          <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
            <PageAuditHistoryButton
              v-if="appointmentId && canViewAudit"
              table="appointments"
              :record-id="appointmentId"
            />

            <button
              type="button"
              class="rounded-md px-3 py-2 text-sm text-base-300 transition cursor-pointer hover:text-white hover:underline"
              :disabled="isSaving"
              @click="cancel"
            >
              {{ t('actions.cancel') }}
            </button>

            <button
              v-if="canEdit || canPublish"
              type="button"
              class="btn-primary"
              :class="isSaving ? 'cursor-not-allowed opacity-70' : ''"
              :disabled="isSaving"
              @click="save"
            >
              {{ isSaving ? t('calendar.form.saving') : t('actions.save') }}
            </button>
          </div>
        </div>

        <div class="space-y-6 p-4 sm:p-6">
          <div v-if="isLoading" class="rounded-xl border border-base-200 px-4 py-6 text-sm text-base-500">
            {{ t('calendar.form.loading') }}
          </div>

          <template v-else>
            <CommonValidationSummary
              v-if="errors.length"
              :errors="errors"
              :title="t('calendar.validation.summaryTitle')"
            />

            <p v-if="!canEdit" class="rounded-lg bg-base-50 px-3 py-2 text-sm text-base-600">
              {{ t('calendar.form.readOnly') }}
            </p>

            <PageCalendarForm
              v-model="form"
              :members="members"
              :subdivisions="subdivisions"
              :appointment-types="appointmentTypes"
              :can-manage="canManage"
              :scope="scope"
              :existing-type-id="existingTypeId"
              :disabled="!canEdit"
            />

            <PageCalendarWebsiteField
              v-if="showWebsite"
              v-model="website"
              class="border-t border-base-200 pt-6"
              :restricted="Boolean(form.restricted)"
              :disabled="!canPublish"
            />
          </template>
        </div>
      </section>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import type { AppointmentFormValue } from '~/components/Page/Calendar/Form.vue'
import type { GetAppointmentResponse } from '~/server/api/appointments/[id].get'
import type { GetAppointmentOptionsResponse, AppointmentMemberOption, AppointmentSubdivisionOption } from '~/server/api/appointments/options.get'
import type { GetAppointmentWebsiteResponse } from '~/server/api/appointments/[id]/website.get'
import type { UpdateAppointmentWebsiteResponse } from '~/server/api/appointments/[id]/website.put'
import type { AppointmentEditScope, AppointmentTypeRow, AppointmentWebsiteSettings, SaveAppointmentBody } from '~/types/appointment'
import { nowWallClockFrame } from '~/composables/useCalendarView'
const { timeZone } = useAppTimeZone()

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const { hasPermission, resolveFlag } = useAuth()
const toast = useToast()
const { pageMeta } = usePage()
const { goToReturnTarget } = useReturnTarget('Calendar')

const canManage = computed(() => hasPermission('calendar.manage'))
const canViewAudit = computed(() => hasPermission('audit.view'))

const appointmentId = computed(() => {
  const id = Number(pageMeta.value?.appointmentId)
  return Number.isFinite(id) && id > 0 ? id : null
})

const occurrenceDate = computed(() => (pageMeta.value?.occurrenceDate as string | undefined) ?? null)
const scope = computed<AppointmentEditScope>(() => {
  const requested = pageMeta.value?.editScope as AppointmentEditScope | undefined
  return requested && ['occurrence', 'following', 'series'].includes(requested) ? requested : 'series'
})

const isLoading = ref(false)
const isSaving = ref(false)
const errors = ref<string[]>([])
const canEdit = ref(true)
const existingTypeId = ref<number | null>(null)

const members = ref<AppointmentMemberOption[]>([])
const subdivisions = ref<AppointmentSubdivisionOption[]>([])
const appointmentTypes = ref<AppointmentTypeRow[]>([])
const headerSentinelRef = ref<HTMLElement | null>(null)
const isHeaderStuck = ref(false)
let headerStickyObserver: IntersectionObserver | null = null

const form = ref<AppointmentFormValue>(emptyForm())

// Publishing on the website belongs to the whole series, so a single-occurrence edit doesn't offer it.
const emptyWebsite = (): AppointmentWebsiteSettings => ({ published: false, visible_from: null })
const website = ref<AppointmentWebsiteSettings>(emptyWebsite())
const savedWebsite = ref<AppointmentWebsiteSettings>(emptyWebsite())
const canPublish = ref(hasPermission('calendar.publish'))
const showWebsite = computed(() => scope.value !== 'occurrence' && (canPublish.value || savedWebsite.value.published))
const websiteDirty = computed(() =>
  website.value.published !== savedWebsite.value.published
  || (website.value.visible_from || null) !== (savedWebsite.value.visible_from || null))

const scopeLabel = computed(() => {
  if (!appointmentId.value) return ''
  if (scope.value === 'occurrence') return t('calendar.editScope.occurrence')
  if (scope.value === 'following') return t('calendar.editScope.following')
  return ''
})

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

/** A new appointment defaults to the next full hour, one hour long. */
function emptyForm(): AppointmentFormValue {
  const preset = pageMeta.value?.presetDate as string | undefined
  // The wall-clock strings this form edits are in the app time zone, not the viewer's — the default
  // day/hour must be read the same way, or a viewer in a different timezone gets a default that has
  // already passed, or one still a day away.
  const now = nowWallClockFrame(timeZone.value)
  const day = preset && /^\d{4}-\d{2}-\d{2}$/.test(preset)
    ? preset
    : `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`

  const startHour = Math.min(23, now.getUTCHours() + 1)

  return {
    type_id: null,
    title: '',
    agenda: null,
    location: null,
    starts_at: `${day} ${pad2(startHour)}:00:00`,
    ends_at: `${day} ${pad2(Math.min(23, startHour + 1))}:00:00`,
    all_day: false,
    recurrence_freq: null,
    recurrence_interval: 1,
    recurrence_weekdays: null,
    recurrence_monthly_mode: null,
    recurrence_until: null,
    recurrence_count: null,
    notify_on_create: true,
    notify_on_change: true,
    notify_reminder: true,
    reminder_lead_minutes: null,
    subdivision_ids: [],
    member_ids: [],
    restricted: !canManage.value,
  }
}

async function loadOptions() {
  try {
    const res = await apiFetch<GetAppointmentOptionsResponse>('/api/appointments/options')
    if (!res.ok) return
    members.value = res.members
    subdivisions.value = res.subdivisions
    appointmentTypes.value = res.appointmentTypes
  } catch {
    // The pickers stay empty; saving still validates server-side.
  }
}

async function loadAppointment() {
  const id = appointmentId.value
  if (!id) {
    form.value = emptyForm()
    canEdit.value = true
    existingTypeId.value = null
    canPublish.value = hasPermission('calendar.publish')
    website.value = emptyWebsite()
    savedWebsite.value = emptyWebsite()
    return
  }

  isLoading.value = true
  try {
    const res = await apiFetch<GetAppointmentResponse>(`/api/appointments/${id}`)
    if (!res.ok) {
      errors.value = [res.error || t('calendar.detail.loadFailed')]
      canEdit.value = false
      return
    }

    const appointment = res.appointment
    canEdit.value = appointment.can_edit
    existingTypeId.value = appointment.type_id

    // A single-occurrence edit starts from that occurrence's effective values, not the series'.
    const override = occurrenceDate.value
      ? res.overrides.find(entry => entry.occurrence_date === occurrenceDate.value) ?? null
      : null

    const occurrenceStart = scope.value === 'series'
      ? appointment.starts_at
      : (override?.starts_at ?? occurrenceDate.value ?? appointment.starts_at)

    const durationMs = wallClockMs(appointment.ends_at) - wallClockMs(appointment.starts_at)
    const occurrenceEnd = scope.value === 'series'
      ? appointment.ends_at
      : (override?.ends_at ?? shiftWallClock(occurrenceStart, durationMs))

    form.value = {
      type_id: appointment.type_id,
      title: override?.title ?? appointment.title,
      agenda: override?.agenda ?? appointment.agenda,
      location: override?.location ?? appointment.location,
      starts_at: occurrenceStart,
      ends_at: occurrenceEnd,
      all_day: appointment.all_day,
      recurrence_freq: appointment.recurrence_freq,
      recurrence_interval: appointment.recurrence_interval,
      recurrence_weekdays: appointment.recurrence_weekdays,
      recurrence_monthly_mode: appointment.recurrence_monthly_mode,
      recurrence_until: appointment.recurrence_until,
      recurrence_count: appointment.recurrence_count,
      notify_on_create: appointment.notify_on_create,
      notify_on_change: appointment.notify_on_change,
      notify_reminder: appointment.notify_reminder,
      reminder_lead_minutes: appointment.reminder_lead_minutes,
      subdivision_ids: [...appointment.subdivision_ids],
      member_ids: [...appointment.member_ids],
      restricted: Boolean(appointment.subdivision_ids.length || appointment.member_ids.length),
    }

    await loadWebsite(id)
  } catch {
    errors.value = [t('calendar.detail.loadFailed')]
    canEdit.value = false
  } finally {
    isLoading.value = false
  }
}

async function loadWebsite(id: number) {
  const res = await apiFetch<GetAppointmentWebsiteResponse>(`/api/appointments/${id}/website`)
    .catch(() => ({ ok: false as const, error: '' }))
  if (!res.ok) {
    canPublish.value = false
    website.value = emptyWebsite()
    savedWebsite.value = emptyWebsite()
    return
  }
  canPublish.value = resolveFlag(res.canPublish, 'calendar.publish')
  website.value = { ...res.website }
  savedWebsite.value = { ...res.website }
}

function wallClockMs(value: string): number {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4] ?? '0'), Number(match[5] ?? '0'), Number(match[6] ?? '0'),
  )
}

function shiftWallClock(from: string, offsetMs: number): string {
  const date = new Date(wallClockMs(from) + offsetMs)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
    + ` ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:00`
}

function validate(): string[] {
  const found: string[] = []
  const value = form.value

  if (!value.title.trim()) found.push(t('calendar.validation.title'))

  const start = wallClockMs(value.starts_at)
  const end = wallClockMs(value.ends_at)
  if (!start || !end || (value.all_day ? end < start : end <= start)) found.push(t('calendar.validation.range'))

  if (scope.value !== 'occurrence') {
    if (value.recurrence_freq === 'weekly' && !(value.recurrence_weekdays || '').trim()) {
      found.push(t('calendar.validation.weekdays'))
    }
    if (value.restricted && !value.subdivision_ids.length && !value.member_ids.length) {
      found.push(t('calendar.validation.subdivisionsOrMembers'))
    }
  }

  return found
}

async function save() {
  if (isSaving.value || (!canEdit.value && !canPublish.value)) return

  errors.value = canEdit.value ? validate() : []
  if (errors.value.length) return

  isSaving.value = true
  try {
    // A publisher who may not edit the appointment itself only saves the website settings.
    let savedId = appointmentId.value
    if (canEdit.value) {
      const body: SaveAppointmentBody = { ...form.value }

      const res = appointmentId.value
        ? await apiFetch<{ ok: boolean, id?: number, error?: string }>(`/api/appointments/${appointmentId.value}`, {
          method: 'PUT',
          body: { ...body, scope: scope.value, occurrenceDate: occurrenceDate.value },
        })
        : await apiFetch<{ ok: boolean, id?: number, error?: string }>('/api/appointments/create', {
          method: 'POST',
          body,
        })

      if (!res.ok) {
        errors.value = [res.error || t('calendar.form.saveFailed')]
        return
      }
      // "This and following" answers with the id of the new series.
      savedId = res.id ?? savedId
    }

    if (showWebsite.value && canPublish.value && websiteDirty.value && savedId) {
      const websiteRes = await apiFetch<UpdateAppointmentWebsiteResponse>(`/api/appointments/${savedId}/website`, {
        method: 'PUT',
        body: website.value,
      }).catch(() => ({ ok: false as const, error: '' }))
      if (!websiteRes.ok) {
        // The appointment itself is saved by now — staying here would let a retry create it twice.
        toast.error(websiteRes.error || t('calendar.website.saveFailed'))
        goToReturnTarget()
        return
      }
    }

    toast.success(t('calendar.form.saved'))
    goToReturnTarget()
  } catch {
    errors.value = [t('calendar.form.saveFailed')]
  } finally {
    isSaving.value = false
  }
}

function cancel() {
  goToReturnTarget()
}

watch(() => [pageMeta.value?.appointmentId, pageMeta.value?.editScope, pageMeta.value?.occurrenceDate], () => {
  errors.value = []
  loadAppointment()
})

onMounted(async () => {
  if (headerSentinelRef.value) {
    headerStickyObserver = new IntersectionObserver((observerEntries) => {
      isHeaderStuck.value = !observerEntries[0]?.isIntersecting
    })
    headerStickyObserver.observe(headerSentinelRef.value)
  }

  await loadOptions()
  await loadAppointment()
})

onBeforeUnmount(() => {
  headerStickyObserver?.disconnect()
})

useAppRefresh().onRefresh(loadAppointment)
</script>
