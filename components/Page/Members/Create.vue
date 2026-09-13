<template>
  <Page :headline1="t('member.title')" @open-menu="$emit('openMenu')">
    <template #cards>
      <div class="col-span-12 xl:col-span-8 xl:col-start-3">
        <div v-if="isEditMode && memberId" class="mb-3 flex justify-end">
          <PageAuditHistoryButton table="members" :record-id="memberId" />
        </div>

        <MembersForm
          v-model="form"
          :disabled="!canEdit"
          :saving="isSaving"
          :can-edit-subjects="canEditSubjects"
          :can-manage-users="canManageUsers"
          :can-manage-subdivisions="canManageSubdivisions"
          :show-account-creation="!isEditMode"
          @submit="submit"
          @cancel="cancel"
        >
          <template #beforeActions>
            <PageMembersWelcomeMailPanel
              v-if="canEdit"
              v-model="sendWelcomeMail"
              :member-id="memberId"
              :member-status="form.status"
              :disabled="isSaving"
            />
          </template>
        </MembersForm>
      </div>
    </template>
  </Page>

  <CommonModal
    v-model="showLeftStatusConfirmModal"
    :title="t('member.leftStatusConfirm.title')"
    width-class="max-w-2xl"
  >
    <p class="text-sm text-base-700">
      {{ isLeftDateDue
        ? t('member.leftStatusConfirm.introUpdate')
        : t('member.leftStatusConfirm.introScheduled', { date: formatDate(form.left_at || '') }) }}
    </p>
    <p class="text-sm text-base-600">
      {{ t('member.leftStatusConfirm.reviewHint') }}
    </p>

    <div class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
      <section
        v-if="leftStatusPreview.accountWillBeDeactivated"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusConfirm.accountDeactivate') }}
        </p>
      </section>

      <section
        v-if="leftStatusPreview.showSubdivisionSection"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusConfirm.subdivisionsTitle') }}
        </p>
        <ul
          v-if="leftStatusPreview.removedSubdivisionLabels.length"
          class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700"
        >
          <li
            v-for="label in leftStatusPreview.removedSubdivisionLabels"
            :key="label"
          >
            {{ label }}
          </li>
        </ul>
        <p v-else class="mt-2 text-sm text-base-700">
          {{ t('member.leftStatusConfirm.subdivisionsFallback') }}
        </p>
      </section>

      <section
        v-if="leftStatusPreview.closedPositions.length"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusConfirm.positionsClosedTitle') }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700">
          <li
            v-for="position in leftStatusPreview.closedPositions"
            :key="position.key"
          >
            <span class="font-medium text-base-900">{{ position.label }}</span>
            <span class="text-base-600"> {{ position.detail }}</span>
          </li>
        </ul>
      </section>

      <section
        v-if="leftStatusPreview.removedPositions.length"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusConfirm.positionsRemovedTitle') }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700">
          <li
            v-for="position in leftStatusPreview.removedPositions"
            :key="position.key"
          >
            <span class="font-medium text-base-900">{{ position.label }}</span>
            <span class="text-base-600"> {{ position.detail }}</span>
          </li>
        </ul>
      </section>

      <p
        v-if="!leftStatusPreview.hasConsequences"
        class="rounded-lg border border-base-200 bg-base-50 p-4 text-sm text-base-700"
      >
        {{ t('member.leftStatusConfirm.none') }}
      </p>
    </div>

    <template #footer>
      <button class="btn-secondary" type="button" @click="showLeftStatusConfirmModal = false">
        {{ t('actions.cancel') }}
      </button>
      <button class="btn-primary" :disabled="isSaving" type="button" @click="confirmLeftStatusSave">
        {{ t('member.leftStatusConfirm.continue') }}
      </button>
    </template>
  </CommonModal>

  <CommonModal
    v-if="showLeftStatusResultModal && leftStatusResult"
    v-model="showLeftStatusResultModal"
    :title="t('member.leftStatusResult.title')"
    width-class="max-w-2xl"
    @close="closeLeftStatusResultModal"
  >
    <p class="text-sm text-base-700">
      {{ t('member.leftStatusResult.intro') }}
    </p>
    <p class="text-sm text-base-600">
      {{ t('member.leftStatusResult.closeHint') }}
    </p>

    <div class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
      <section
        v-if="leftStatusResult.account_deactivated"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusResult.accountTitle') }}
        </p>
        <p class="mt-2 text-sm text-base-700">
          {{ leftStatusResult.account_deactivated.username }}
        </p>
      </section>

      <section
        v-if="leftStatusResult.removed_subdivisions.length"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusResult.subdivisionsTitle') }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700">
          <li
            v-for="subdivision in leftStatusResult.removed_subdivisions"
            :key="subdivision.id"
          >
            {{ subdivision.label }}
          </li>
        </ul>
      </section>

      <section
        v-if="leftStatusResult.closed_positions.length"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusResult.positionsClosedTitle') }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700">
          <li
            v-for="position in leftStatusResult.closed_positions"
            :key="position.id"
          >
            <span class="font-medium text-base-900">{{ position.label }}</span>
            <span class="text-base-600">
              {{ formatClosedPositionResult(position) }}
            </span>
          </li>
        </ul>
      </section>

      <section
        v-if="leftStatusResult.removed_positions.length"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('member.leftStatusResult.positionsRemovedTitle') }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700">
          <li
            v-for="position in leftStatusResult.removed_positions"
            :key="position.id"
          >
            <span class="font-medium text-base-900">{{ position.label }}</span>
            <span class="text-base-600"> {{ formatRemovedPositionResult(position) }}</span>
          </li>
        </ul>
      </section>

      <p
        v-if="!leftStatusResultHasChanges"
        class="rounded-lg border border-base-200 bg-base-50 p-4 text-sm text-base-700"
      >
        {{ t('member.leftStatusResult.none') }}
      </p>
    </div>

    <template #footer>
      <button class="btn-primary" type="button" @click="closeLeftStatusResultModal">
        {{ t('actions.close') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import { MemberStatus, type Member, type MemberStatusActionPositionClose, type MemberStatusActionPositionRemoval, type MemberStatusActionSummary, type SaveMemberBody } from '~/types/member'
import { usePage } from '~/composables/usePage'
import MembersForm from './Form.vue'
import { useAuth } from '~/composables/useAuth'
import type { PositionRow } from '~/types/position'
import type { SubdivisionOption } from '~/types/subdivision'

const emit = defineEmits<{
  (e: 'openMenu'): void
}>()

type MemberSaveResponse = {
  ok: boolean
  error?: string
  status_actions?: MemberStatusActionSummary | null
}

const { setPage, pageMeta } = usePage()
const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const toast = useToast()
const { hasPermission } = useAuth()

const canEdit = computed(() => hasPermission('members.edit'))
const canEditSubjects = computed(() => hasPermission('subjects.edit'))
const canManageUsers = computed(() => hasPermission('users.manage'))
const canManageSubdivisions = computed(() => hasPermission('settings.subdivisions.manage'))

const isEditMode = ref(false)
const memberId = ref<number | null>(null)
const originalStatus = ref<MemberStatus | null>(null)
const positionCatalog = ref<PositionRow[]>([])
const subdivisionCatalog = ref<SubdivisionOption[]>([])
const showLeftStatusConfirmModal = ref(false)
const showLeftStatusResultModal = ref(false)
const leftStatusResult = ref<MemberStatusActionSummary | null>(null)
const isSaving = ref(false)

function translatePositionAssignmentToast(message?: string) {
  if (!message) return message

  const invalidRangeMatch = message.match(/^(.*): end date cannot be before start date$/)
  if (invalidRangeMatch) {
    return t('common.positionAssignmentInvalidRange', {
      label: invalidRangeMatch[1]!.trim(),
    })
  }

  const overlapMatch = message.match(/^(.*): assignment periods must not overlap \((.*) and (.*)\)$/)
  if (overlapMatch) {
    return t('common.positionAssignmentOverlap', {
      label: overlapMatch[1]!.trim(),
      firstRange: formatPositionAssignmentRange(overlapMatch[2]!.trim()),
      secondRange: formatPositionAssignmentRange(overlapMatch[3]!.trim()),
    })
  }

  return message
}

function formatPositionAssignmentRange(range: string) {
  const [rawSince, rawUntil] = range.split(' - ')
  const since = formatDate(rawSince?.trim())
  const normalizedUntil = rawUntil?.trim() === 'open-ended'
    ? t('common.openEnded')
    : formatDate(rawUntil?.trim())

  return `${since} - ${normalizedUntil}`
}

const form = ref<SaveMemberBody>({
  account: null,
  new_account: null,
  first_name: '',
  last_name: '',
  birthdate: '',
  street: '',
  street_number: '',
  postal_code: '',
  city: '',
  subject_name: '',
  phone: '',
  email: '',
  notes: null,
  status: MemberStatus.Active,
  honorary: false,
  applied_at: '',
  joined_at: '',
  left_at: null,
  positions: [],
  subdivision_ids: [],
})

const sendWelcomeMail = ref(true)

onMounted(async () => {
  await loadSupportData()

  memberId.value = pageMeta.value?.memberId || null
  if (!memberId.value) return

  isEditMode.value = true

  const res = await $fetch<{ ok: boolean, member?: Member, error?: string }>(`/api/members/${memberId.value}`)
  if (!res.ok || !res.member) {
    isEditMode.value = false
    return
  }

  originalStatus.value = res.member.status
  form.value = {
    account: res.member.account,
    new_account: null,
    first_name: res.member.first_name,
    last_name: res.member.last_name,
    birthdate: res.member.birthdate,
    street: res.member.street,
    street_number: res.member.street_number,
    postal_code: res.member.postal_code,
    city: res.member.city,
    subject_name: res.member.subject_name,
    phone: res.member.phone,
    email: res.member.email,
    notes: res.member.notes,
    status: res.member.status,
    honorary: res.member.honorary,
    applied_at: res.member.applied_at,
    joined_at: res.member.joined_at,
    left_at: res.member.left_at,
    positions: res.member.positions || [],
    subdivision_ids: res.member.subdivisions?.map(subdivision => subdivision.id) || [],
  }
})

useAppRefresh().onRefresh(loadSupportData)

async function loadSupportData() {
  await Promise.all([
    loadPositionCatalog(),
    canManageSubdivisions.value ? loadSubdivisionCatalog() : Promise.resolve(),
  ])
}

const isLeftStatusTransition = computed(() => {
  if (form.value.status !== MemberStatus.Left) return false
  if (!isEditMode.value) return false
  return originalStatus.value !== MemberStatus.Left
})

const isLeftDateDue = computed(() => {
  const leftAt = form.value.left_at
  if (!leftAt) return false
  const today = new Date().toISOString().slice(0, 10)
  return leftAt <= today
})

const positionLabelById = computed(() => {
  return new Map(positionCatalog.value.map(position => [position.id, `${position.code} - ${position.name}`]))
})

const subdivisionLabelById = computed(() => {
  return new Map(subdivisionCatalog.value.map(subdivision => [subdivision.id, `${subdivision.code} - ${subdivision.name}`]))
})

const leftStatusPreview = computed(() => {
  const leftAt = form.value.left_at || ''
  const hasLeftAt = Boolean(leftAt)
  const positions = hasLeftAt ? form.value.positions : []
  const closedPositions = positions
    .filter(position => position.position_id && position.since && position.since <= leftAt && (!position.until || position.until > leftAt))
    .map((position, index) => ({
      key: `${position.id ?? 'new'}-${position.position_id}-${index}`,
      label: positionLabelById.value.get(position.position_id) ?? `#${position.position_id}`,
      detail: `(${position.since} - ${leftAt})`,
    }))
  const removedPositions = positions
    .filter(position => position.position_id && position.since && position.since > leftAt)
    .map((position, index) => ({
      key: `${position.id ?? 'new'}-${position.position_id}-${index}`,
      label: positionLabelById.value.get(position.position_id) ?? `#${position.position_id}`,
      detail: `(${position.since} - ${position.until || t('member.leftStatusResult.openEnded')})`,
    }))
  const removedSubdivisionLabels = (form.value.subdivision_ids ?? [])
    .map(subdivisionId => subdivisionLabelById.value.get(subdivisionId) ?? `#${subdivisionId}`)
  const showSubdivisionSection = removedSubdivisionLabels.length > 0
    || (isEditMode.value && !canManageSubdivisions.value)
  const accountWillBeDeactivated = Boolean(form.value.account)
    || Boolean(form.value.new_account && form.value.new_account.is_active !== false)
  const hasConsequences = accountWillBeDeactivated
    || showSubdivisionSection
    || closedPositions.length > 0
    || removedPositions.length > 0

  return {
    accountWillBeDeactivated,
    removedSubdivisionLabels,
    showSubdivisionSection,
    closedPositions,
    removedPositions,
    hasConsequences,
  }
})

const leftStatusResultHasChanges = computed(() => {
  const result = leftStatusResult.value
  if (!result) return false

  return Boolean(result.account_deactivated)
    || result.removed_subdivisions.length > 0
    || result.closed_positions.length > 0
    || result.removed_positions.length > 0
})

async function loadPositionCatalog() {
  try {
    const res = await $fetch<{ ok: boolean, positions?: PositionRow[] }>('/api/positions')
    if (res.ok && res.positions) positionCatalog.value = res.positions
  } catch {
    positionCatalog.value = []
  }
}

async function loadSubdivisionCatalog() {
  if (!canManageSubdivisions.value) return

  try {
    const res = await $fetch<{ ok: boolean, subdivisions?: SubdivisionOption[] }>('/api/subdivisions/options')
    if (res.ok && res.subdivisions) subdivisionCatalog.value = res.subdivisions
  } catch {
    subdivisionCatalog.value = []
  }
}

async function submit() {
  if (isSaving.value) return
  if (!canEdit.value) {
    toast.error(t('common.notAuthorized'))
    return
  }

  if (isLeftStatusTransition.value) {
    showLeftStatusConfirmModal.value = true
    return
  }

  await persistMember(false)
}

async function confirmLeftStatusSave() {
  if (isSaving.value) return
  showLeftStatusConfirmModal.value = false
  await persistMember(true)
}

async function persistMember(showStatusActionsModal: boolean) {
  if (isSaving.value) return
  isSaving.value = true

  try {
    let response: MemberSaveResponse

    if (isEditMode.value && memberId.value) {
      response = await $fetch<MemberSaveResponse>(String(`/api/members/${memberId.value}`), {
        method: 'PUT',
        body: form.value,
      })

      if (!response.ok) throw new Error(response.error || t('member.saved.failedUpdate'))
    } else {
      response = await $fetch<MemberSaveResponse>('/api/members/create', {
        method: 'POST',
        body: { ...form.value, send_welcome_mail: sendWelcomeMail.value },
      })

      if (!response.ok) throw new Error(response.error || t('member.saved.failedCreate'))
    }

    if (showStatusActionsModal && response.status_actions) {
      leftStatusResult.value = response.status_actions
      showLeftStatusResultModal.value = true
      return
    }

    if (showStatusActionsModal && !isLeftDateDue.value) {
      toast.success(t('member.saved.scheduledLeave', { date: formatDate(form.value.left_at || '') }))
      setPage(pageMeta.value?.returnTo || 'MemberList')
      return
    }

    toast.success(isEditMode.value ? t('member.saved.updated') : t('member.saved.created'))
    setPage(pageMeta.value?.returnTo || 'MemberList')
  } catch (err: any) {
    toast.error(translatePositionAssignmentToast(err?.message) || t('member.saved.failedSave'))
  } finally {
    isSaving.value = false
  }
}

function formatClosedPositionResult(position: MemberStatusActionPositionClose) {
  const previousUntil = position.previous_until
    ? `, ${t('member.leftStatusResult.untilChangedFrom', { date: position.previous_until })}`
    : ''

  return `(${position.since} - ${position.until}${previousUntil})`
}

function formatRemovedPositionResult(position: MemberStatusActionPositionRemoval) {
  return `(${position.since} - ${position.until || t('member.leftStatusResult.openEnded')})`
}

function closeLeftStatusResultModal() {
  showLeftStatusResultModal.value = false
  leftStatusResult.value = null
  setPage(pageMeta.value?.returnTo || 'MemberList')
}

function cancel() {
  const returnTo = pageMeta.value?.returnTo || 'MemberList'
  setPage(returnTo)
}
</script>
