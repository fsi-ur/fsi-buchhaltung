<template>
  <PageSettingsEntityManager
    ref="entityManagerRef"
    :title="t('settings.entities.positions')"
    :singular-label="t('settings.entities.position')"
    :add-label="t('settings.entities.newPosition')"
    :empty-label="t('settings.entities.noPositions')"
    persist-key="settings-positions"
    list-endpoint="/api/positions/manage"
    save-endpoint="/api/positions/save"
    activate-endpoint="/api/positions/activate"
    response-list-key="positions"
    :history-tables="['positions', 'member_positions']"
    :extra-columns="tableColumns"
    :can-manage="hasAccess"
    :create-item="createItem"
    :map-edit-item="mapEditItem"
    modal-width-class="max-w-3xl"
    :on-error="handleError"
  >
    <template #cell-members="{ item }">
      {{ currentMemberSummary(item) }}
    </template>

    <template #actions="{ item, edit, toggle }">
      <button class="text-link-600 hover:underline cursor-pointer" @click="edit()">
        {{ t('actions.edit') }}
      </button>

      <button
        class="hover:underline cursor-pointer"
        :class="item.is_active ? 'text-danger-500' : 'text-base-500'"
        @click="item.is_active ? openDeactivateModal(item) : toggle()"
      >
        {{ item.is_active ? t('actions.deactivate') : t('actions.activate') }}
      </button>
    </template>

    <template #modal-fields-after-description="{ editingItem }">
      <div
        v-if="positionBody(editingItem).is_active === false"
        class="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-900"
      >
        <p class="font-medium">{{ t('settings.positions.inactiveBannerTitle') }}</p>
        <p class="mt-1">{{ t('settings.positions.inactiveBannerText') }}</p>
      </div>
      <div class="space-y-4 pt-1">
        <div class="rounded-lg overflow-hidden border border-base-200 p-4 space-y-3 relative z-20">
          <div class="space-y-3">
            <h4 class="font-medium text-base-900">{{ t('settings.positions.manageAssignments') }}</h4>

            <CommonSearchSelect
              v-model="memberQuery"
              :options="memberSearchOptions(editingItem)"
              :placeholder="t('settings.positions.memberPlaceholder')"
              :empty-text="t('settings.positions.noMembersAvailable')"
              :disabled="positionBody(editingItem).is_active === false"
              @select="selectMember($event, editingItem)"
              @clear-selection="memberQuery = ''"
            />
          </div>

          <div
            v-if="visibleAssignments(editingItem).length === 0"
            class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-500"
          >
            {{ t('settings.positions.noMembersAssigned') }}
          </div>

          <div v-else class="min-h-0 overflow-hidden rounded-lg border border-base-200 bg-base-50">
            <div
              ref="assignmentListRef"
              :class="[
                'position-assignment-scroll max-h-80 overflow-y-auto p-2',
                hasAssignmentScrollbar ? 'pr-1' : '',
              ]"
            >
              <div
                v-for="{ assignment, index, state } in visibleAssignments(editingItem)"
                :key="assignmentRowKey(assignment, index)"
                class="relative z-0 mb-2 rounded-lg border border-base-200 bg-white px-3 py-2 space-y-2 last:mb-0 focus-within:z-20"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="truncate text-sm font-medium text-base-800">{{ assignmentLabel(assignment) }}</div>

                      <span
                        :class="['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', assignmentStateClass(state)]"
                      >
                        {{ assignmentStateLabel(state) }}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    class="shrink-0 text-sm text-danger-500 hover:underline cursor-pointer"
                    @click="removeAssignment(index, editingItem)"
                  >
                    {{ t('actions.remove') }}
                  </button>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label class="flex items-center gap-2 text-sm text-base-700">
                    <span class="shrink-0">{{ t('common.from') }}</span>
                    <CommonDateInput v-model="assignment.since" class="min-w-0" />
                  </label>

                  <label class="flex items-center gap-2 text-sm text-base-700">
                    <span class="shrink-0">{{ t('common.to') }}</span>
                    <CommonDateInput
                      v-model="assignment.until"
                      class="min-w-0"
                      :empty-value="null"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </PageSettingsEntityManager>

  <CommonModal
    v-if="showDeactivateModal && deactivatePosition"
    v-model="showDeactivateModal"
    :title="t('settings.positions.deactivateConfirm.title')"
    width-class="max-w-2xl"
    @close="closeDeactivateModal"
  >
    <p class="text-sm text-base-700">
      {{ t('settings.positions.deactivateConfirm.intro', { position: deactivatePositionLabel }) }}
    </p>
    <p class="text-sm text-base-600">
      {{ t('settings.positions.deactivateConfirm.reviewHint') }}
    </p>

    <div class="space-y-4">
      <div class="rounded-lg border border-base-200 bg-base-50 p-4">
        <label class="text-sm font-medium text-base-700">{{ t('settings.positions.deactivateConfirm.untilDate') }}</label>
        <CommonDateInput v-model="deactivateForm.assignment_until" class="mt-2" />
        <p class="mt-2 text-sm text-base-600">
          {{ t('settings.positions.deactivateConfirm.untilDateHint') }}
        </p>
      </div>

      <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
        <input v-model="deactivateForm.delete_future_assignments" type="checkbox" class="checkbox">
        {{ t('settings.positions.deactivateConfirm.deleteFuture') }}
      </label>

      <section
        v-if="deactivatePreview.closedAssignments.length"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('settings.positions.deactivateConfirm.closedAssignmentsTitle') }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700">
          <li
            v-for="assignment in deactivatePreview.closedAssignments"
            :key="assignment.key"
          >
            <span class="font-medium text-base-900">{{ assignment.label }}</span>
            <span class="text-base-600">{{ ` ${assignment.detail}` }}</span>
          </li>
        </ul>
      </section>

      <section
        v-if="deactivatePreview.removedAssignments.length"
        class="rounded-lg border border-base-200 bg-base-50 p-4"
      >
        <p class="text-sm font-medium text-base-900">
          {{ t('settings.positions.deactivateConfirm.removedAssignmentsTitle') }}
        </p>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-base-700">
          <li
            v-for="assignment in deactivatePreview.removedAssignments"
            :key="assignment.key"
          >
            <span class="font-medium text-base-900">{{ assignment.label }}</span>
            <span class="text-base-600">{{ ` ${assignment.detail}` }}</span>
          </li>
        </ul>
      </section>

      <p
        v-if="!deactivatePreview.hasConsequences"
        class="rounded-lg border border-base-200 bg-base-50 p-4 text-sm text-base-700"
      >
        {{ t('settings.positions.deactivateConfirm.none') }}
      </p>
    </div>

    <template #footer>
      <button class="btn-secondary" type="button" @click="closeDeactivateModal">
        {{ t('actions.cancel') }}
      </button>
      <button class="btn-primary" type="button" @click="confirmDeactivate">
        {{ t('actions.deactivate') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { EntityManagerColumn, SaveSettingsEntityBody, SettingsEntityRow } from '~/components/Page/Settings/EntityManager.vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import type {
  PositionMemberAssignment,
  PositionMemberOption,
  PositionRow,
  SavePositionAssignmentBody,
  SavePositionBody,
} from '~/types/position'
const { today: appToday } = useAppTimeZone()

interface EditablePositionAssignment extends SavePositionAssignmentBody {
  member_query: string
  full_name?: string
}

interface EditablePosition extends SavePositionBody {
  assignments: EditablePositionAssignment[]
}

type AssignmentState = 'current' | 'upcoming' | 'past' | 'draft'
interface AssignmentLike {
  member_id: number
  since: string
  until: string | null
  full_name?: string
  member_query?: string
}

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const toast = useToast()
const { hasPermission } = useAuth()

const hasAccess = computed(() => hasPermission('settings.positions.manage'))
const entityManagerRef = ref<{ loadItems: () => Promise<void> } | null>(null)
const memberOptions = ref<PositionMemberOption[]>([])
const memberQuery = ref('')
const assignmentListRef = ref<HTMLElement | null>(null)
const hasAssignmentScrollbar = ref(false)
const deactivatePosition = ref<PositionRow | null>(null)
const showDeactivateModal = ref(false)
const deactivateForm = ref({
  assignment_until: '',
  delete_future_assignments: false,
})

let assignmentListResizeObserver: ResizeObserver | null = null
let assignmentListMutationObserver: MutationObserver | null = null

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

const tableColumns = computed<EntityManagerColumn[]>(() => [
  {
    key: 'members',
    label: t('settings.positions.members'),
    filterable: false,
    getValue: item => currentMemberSummary(item),
  },
])

const memberOptionsById = computed(() => {
  return new Map(memberOptions.value.map(member => [member.id, member]))
})

function todayValue() {
  return appToday()
}

function positionRow(item: SettingsEntityRow) {
  return item as PositionRow
}

function positionBody(editingItem: SaveSettingsEntityBody) {
  return editingItem as EditablePosition
}

function assignmentRowKey(assignment: EditablePositionAssignment, index: number) {
  return assignment.id ? `assignment-${assignment.id}` : `draft-${index}`
}

function createAssignment(assignment?: Partial<PositionMemberAssignment>): EditablePositionAssignment {
  return {
    id: assignment?.id,
    member_id: assignment?.member_id ?? 0,
    since: assignment?.since ?? '',
    until: assignment?.until ?? null,
    member_query: assignment?.full_name ?? '',
    full_name: assignment?.full_name,
  }
}

function createItem(): EditablePosition {
  memberQuery.value = ''
  return {
    code: '',
    name: '',
    description: '',
    assignments: [],
  }
}

function mapEditItem(item: SettingsEntityRow): EditablePosition {
  memberQuery.value = ''
  const position = positionRow(item)
  return {
    id: position.id,
    code: position.code,
    name: position.name,
    description: position.description,
    is_active: position.is_active,
    assignments: (position.assignments ?? [])
      .slice()
      .sort(compareAssignmentsMeaningfully)
      .map(assignment => createAssignment(assignment)),
  }
}

function compareText(left: string | null | undefined, right: string | null | undefined) {
  return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' })
}

function compareAssignmentsMeaningfully(left: AssignmentLike, right: AssignmentLike) {
  const stateOrder: Record<AssignmentState, number> = {
    draft: 0,
    upcoming: 1,
    current: 2,
    past: 3,
  }

  const leftState = assignmentState(left)
  const rightState = assignmentState(right)
  const stateDifference = stateOrder[leftState] - stateOrder[rightState]
  if (stateDifference !== 0) return stateDifference

  if (leftState === 'current') {
    const leftUntil = left.until || '9999-12-31'
    const rightUntil = right.until || '9999-12-31'
    if (leftUntil !== rightUntil) return leftUntil.localeCompare(rightUntil)
    if (left.since !== right.since) return right.since.localeCompare(left.since)
  }

  if (leftState === 'upcoming') {
    if (left.since !== right.since) return left.since.localeCompare(right.since)
  }

  if (leftState === 'past') {
    const leftUntil = left.until || ''
    const rightUntil = right.until || ''
    if (leftUntil !== rightUntil) return rightUntil.localeCompare(leftUntil)
    if (left.since !== right.since) return right.since.localeCompare(left.since)
  }

  if (leftState === 'draft' && left.since !== right.since) {
    return compareText(left.since, right.since)
  }

  const leftLabel = left.full_name || left.member_query
  const rightLabel = right.full_name || right.member_query
  const labelDifference = compareText(leftLabel, rightLabel)
  if (labelDifference !== 0) return labelDifference

  return Number(left.member_id || 0) - Number(right.member_id || 0)
}

function assignmentLabel(assignment: EditablePositionAssignment) {
  const member = memberOptionsById.value.get(assignment.member_id)
  return member?.full_name || assignment.full_name || assignment.member_query || t('common.notAvailable')
}

function isCurrentAssignment(assignment: AssignmentLike) {
  const today = todayValue()
  return Boolean(assignment.member_id)
    && Boolean(assignment.since)
    && assignment.since <= today
    && (!assignment.until || assignment.until >= today)
}

function isUpcomingAssignment(assignment: AssignmentLike) {
  const today = todayValue()
  return Boolean(assignment.member_id) && Boolean(assignment.since) && assignment.since > today
}

function isPastAssignment(assignment: AssignmentLike) {
  const today = todayValue()
  const until = assignment.until
  return Boolean(assignment.member_id)
    && typeof until === 'string'
    && until.length > 0
    && until < today
}

function assignmentState(assignment: AssignmentLike): AssignmentState {
  if (isCurrentAssignment(assignment)) return 'current'
  if (isUpcomingAssignment(assignment)) return 'upcoming'
  if (isPastAssignment(assignment)) return 'past'
  return 'draft'
}

function assignmentStateLabel(state: AssignmentState) {
  if (state === 'current') return t('settings.positions.currentBadge')
  if (state === 'upcoming') return t('settings.positions.upcomingBadge')
  if (state === 'past') return t('settings.positions.pastBadge')
  return t('settings.positions.draftBadge')
}

function assignmentStateClass(state: AssignmentState) {
  if (state === 'current') return 'bg-success-100 text-success-800'
  if (state === 'upcoming') return 'bg-warning-100 text-warning-800'
  if (state === 'past') return 'bg-base-200 text-base-700'
  return 'bg-base-100 text-base-700'
}

function visibleAssignments(editingItem: SaveSettingsEntityBody) {
  return positionBody(editingItem).assignments
    .map((assignment, index) => ({
      assignment,
      index,
      state: assignmentState(assignment),
    }))
}

function currentAssignmentsForItem(item: SettingsEntityRow) {
  return (positionRow(item).assignments ?? [])
    .map(assignment => createAssignment(assignment))
    .filter(isCurrentAssignment)
    .sort(compareAssignmentsMeaningfully)
}

function currentMemberSummary(item: SettingsEntityRow) {
  const assignments = currentAssignmentsForItem(item)
  if (!assignments.length) return t('settings.positions.noCurrentMembers')

  const labels = assignments.map(assignment => assignmentLabel(assignment))
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`
}

const deactivatePositionLabel = computed(() => {
  if (!deactivatePosition.value) return ''
  return `${deactivatePosition.value.code} - ${deactivatePosition.value.name}`
})

const deactivatePreview = computed(() => {
  const position = deactivatePosition.value
  const untilDate = deactivateForm.value.assignment_until || null
  const deleteFutureAssignments = deactivateForm.value.delete_future_assignments
  const cutoffDate = untilDate || todayValue()
  const assignments = (position?.assignments ?? [])
    .slice()
    .map((assignment, index) => ({ assignment, index }))

  const closedAssignments = untilDate
    ? assignments
      .filter(({ assignment }) => assignment.since <= untilDate && (!assignment.until || assignment.until > untilDate))
      .map(({ assignment, index }) => ({
        key: `closed-${assignment.id ?? index}`,
        label: assignmentLabel(createAssignment(assignment)),
        detail: `(${formatDate(assignment.since)} - ${formatDate(untilDate)})`,
      }))
    : []

  const removedAssignments = deleteFutureAssignments
    ? assignments
      .filter(({ assignment }) => assignment.since > cutoffDate)
      .map(({ assignment, index }) => ({
        key: `removed-${assignment.id ?? index}`,
        label: assignmentLabel(createAssignment(assignment)),
        detail: `(${formatDate(assignment.since)} - ${assignment.until ? formatDate(assignment.until) : t('common.openEnded')})`,
      }))
    : []

  return {
    closedAssignments,
    removedAssignments,
    hasConsequences: closedAssignments.length > 0 || removedAssignments.length > 0,
  }
})

function memberSearchOptions(editingItem: SaveSettingsEntityBody) {
  return memberOptions.value
    .map<SearchSelectOption<PositionMemberOption>>(member => ({
      key: member.id,
      label: member.full_name,
      value: member,
      searchText: member.full_name.trim(),
    }))
}

function openDeactivateModal(item: SettingsEntityRow) {
  deactivatePosition.value = positionRow(item)
  deactivateForm.value = {
    assignment_until: '',
    delete_future_assignments: false,
  }
  showDeactivateModal.value = true
}

function closeDeactivateModal() {
  showDeactivateModal.value = false
  deactivatePosition.value = null
  deactivateForm.value = {
    assignment_until: '',
    delete_future_assignments: false,
  }
}

function removeAssignment(index: number, editingItem: SaveSettingsEntityBody) {
  positionBody(editingItem).assignments.splice(index, 1)
}

function selectMember(value: unknown, editingItem: SaveSettingsEntityBody) {
  if (positionBody(editingItem).is_active === false) return
  const member = value as PositionMemberOption
  if (!member?.id) return

  const assignments = positionBody(editingItem).assignments
  assignments.unshift(createAssignment({
    member_id: member.id,
    full_name: member.full_name,
  }))
  memberQuery.value = ''
}

async function confirmDeactivate() {
  if (!deactivatePosition.value) return

  const res = await $fetch<{ ok: boolean, error?: string }>('/api/positions/activate', {
    method: 'POST',
    body: {
      id: deactivatePosition.value.id,
      is_active: false,
      assignment_until: deactivateForm.value.assignment_until || null,
      delete_future_assignments: deactivateForm.value.delete_future_assignments,
    },
  })

  if (!res.ok) {
    toast.error(translatePositionAssignmentToast(res.error) || t('settings.positions.updateFailed'))
    return
  }

  closeDeactivateModal()
  await entityManagerRef.value?.loadItems()
}

async function loadMemberOptions() {
  try {
    const res = await $fetch<{ ok: boolean, members?: PositionMemberOption[], error?: string }>('/api/positions/member-options')
    if (!res.ok) {
      toast.error(res.error || t('settings.positions.loadFailed'))
      return
    }

    memberOptions.value = res.members ?? []
  } catch (error) {
    console.error(error)
    toast.error(t('settings.positions.loadFailed'))
  }
}

function handleError({ phase, message, error }: { phase: 'load' | 'save' | 'toggle', message?: string, error?: unknown }) {
  if (error) console.error(error)
  const translatedMessage = translatePositionAssignmentToast(message)

  if (phase === 'load') {
    toast.error(translatedMessage || t('settings.positions.loadFailed'))
    return
  }

  if (phase === 'save') {
    toast.error(translatedMessage || t('settings.positions.saveFailed'))
    return
  }

  toast.error(translatedMessage || t('settings.positions.updateFailed'))
}

function updateAssignmentListOverflow() {
  const element = assignmentListRef.value
  if (!element) {
    hasAssignmentScrollbar.value = false
    return
  }

  hasAssignmentScrollbar.value = element.scrollHeight > element.clientHeight + 1
}

function cleanupAssignmentListObservers() {
  assignmentListResizeObserver?.disconnect()
  assignmentListMutationObserver?.disconnect()
  assignmentListResizeObserver = null
  assignmentListMutationObserver = null
}

watch(assignmentListRef, async (element) => {
  cleanupAssignmentListObservers()

  if (!element) {
    hasAssignmentScrollbar.value = false
    return
  }

  await nextTick()
  updateAssignmentListOverflow()

  assignmentListResizeObserver = new ResizeObserver(() => {
    updateAssignmentListOverflow()
  })
  assignmentListResizeObserver.observe(element)

  assignmentListMutationObserver = new MutationObserver(() => {
    updateAssignmentListOverflow()
  })
  assignmentListMutationObserver.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  })
})

onMounted(async () => {
  if (!hasAccess.value) return
  await loadMemberOptions()
})

useAppRefresh().onRefresh(async () => {
  if (!hasAccess.value) return
  await Promise.all([loadMemberOptions(), entityManagerRef.value?.loadItems()])
})

onBeforeUnmount(() => {
  cleanupAssignmentListObservers()
})
</script>

<style scoped>
.position-assignment-scroll {
  scrollbar-width: auto;
  scrollbar-color: #94a3b8 #e2e8f0;
}

.position-assignment-scroll::-webkit-scrollbar {
  width: 12px;
}

.position-assignment-scroll::-webkit-scrollbar-track {
  background: #e2e8f0;
  border-radius: 9999px;
}

.position-assignment-scroll::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 9999px;
  border: 2px solid #e2e8f0;
}
</style>
