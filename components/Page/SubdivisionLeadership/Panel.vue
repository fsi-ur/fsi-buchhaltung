<template>
  <CommonPageTableCard
    v-if="canViewMembers"
    :title="t('subdivisionLeadership.members.title', { count: subdivision.members.length })"
    persist-key="subdivision-leadership-members"
    :search-value="memberSearch"
    :search-placeholder="t('subdivisionLeadership.members.search')"
    :can-create="canManageMembers"
    :create-label="`+ ${t('subdivisionLeadership.members.add')}`"
    @update:search-value="memberSearch = $event"
    @create="addMemberOpen = true"
  >
    <template #actions>
      <PageAuditScopedHistoryButton
        v-if="canViewHistory"
        :tables="[]"
        :parent-id="subdivision.id"
        endpoint="/api/subdivision-leadership/history"
        visible
        :context="subdivision.name"
      />
    </template>

    <p v-if="subdivision.description" class="text-sm text-base-600">{{ subdivision.description }}</p>

    <CommonAdvancedTable
      v-model:search="memberSearch"
      persist-key="subdivision-leadership-members"
      :rows="subdivision.members"
      :columns="memberColumns"
      :empty-text="t('subdivisionLeadership.members.empty')"
      :openable="false"
      :show-actions="canManageMembers"
      :row-has-actions="(row: LeadershipMember) => !row.is_self"
    >
      <template #actions="{ row }">
        <button
          v-if="!row.is_self"
          type="button"
          class="text-danger-500 hover:underline cursor-pointer"
          @click="memberToRemove = row"
        >
          {{ t('actions.remove') }}
        </button>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonCard :title="t('subdivisionLeadership.positions.title')">
    <template #actions>
      <PageAuditScopedHistoryButton
        v-if="canViewHistory && !canViewMembers"
        :tables="[]"
        :parent-id="subdivision.id"
        endpoint="/api/subdivision-leadership/history"
        visible
        :context="subdivision.name"
      />
      <button
        v-if="canAssignPositions && assignablePositions.length"
        type="button"
        class="btn-primary"
        @click="openAssignment()"
      >
        + {{ t('subdivisionLeadership.positions.assign') }}
      </button>
    </template>

    <p v-if="!activeAssignments.length" class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-500">
      {{ t('subdivisionLeadership.positions.empty') }}
    </p>

    <ul v-else class="divide-y divide-base-200 rounded-lg border border-base-200">
      <li
        v-for="assignment in activeAssignments"
        :key="assignment.id"
        class="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
      >
        <div class="min-w-0 space-y-0.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium text-base-900">{{ assignment.member_name }}</span>
            <span class="text-sm text-base-600">{{ assignment.position_name }}</span>
            <CommonStatusBadge :label="stateLabel(assignment)" :tone="stateTone(assignment)" />
          </div>
          <p class="text-xs text-base-500">{{ periodLabel(assignment) }}</p>
        </div>

        <div v-if="canEditAssignment(assignment)" class="flex gap-3 text-sm">
          <button type="button" class="text-link-600 hover:underline cursor-pointer" @click="openAssignment(assignment)">
            {{ t('actions.edit') }}
          </button>
          <button type="button" class="text-danger-500 hover:underline cursor-pointer" @click="assignmentToEnd = assignment">
            {{ t('subdivisionLeadership.positions.end') }}
          </button>
        </div>
      </li>
    </ul>

    <details v-if="pastAssignments.length" class="text-sm">
      <summary class="cursor-pointer text-base-600">
        {{ t('subdivisionLeadership.positions.past', { count: pastAssignments.length }) }}
      </summary>
      <ul class="mt-2 space-y-1 text-base-600">
        <li v-for="assignment in pastAssignments" :key="assignment.id">
          {{ assignment.member_name }} · {{ assignment.position_name }} · {{ periodLabel(assignment) }}
        </li>
      </ul>
    </details>
  </CommonCard>

  <PageSubdivisionLeadershipAddMemberModal
    v-if="addMemberOpen"
    v-model="addMemberOpen"
    :subdivision="subdivision"
    @saved="$emit('changed')"
  />

  <PageSubdivisionLeadershipAssignmentModal
    v-if="assignmentOpen"
    v-model="assignmentOpen"
    :subdivision="subdivision"
    :assignment="editedAssignment"
    :assignable-positions="assignablePositions"
    @saved="$emit('changed')"
  />

  <CommonModal
    v-if="memberToRemove"
    :model-value="Boolean(memberToRemove)"
    :title="t('subdivisionLeadership.members.removeTitle')"
    width-class="max-w-lg"
    @update:model-value="memberToRemove = null"
  >
    <p class="text-sm text-base-700">
      {{ t('subdivisionLeadership.members.removeText', { member: memberToRemove.full_name, subdivision: subdivision.name }) }}
    </p>
    <template #footer>
      <button type="button" class="btn-secondary" @click="memberToRemove = null">{{ t('actions.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="busy" @click="removeMember">{{ t('actions.remove') }}</button>
    </template>
  </CommonModal>

  <CommonModal
    v-if="assignmentToEnd"
    :model-value="Boolean(assignmentToEnd)"
    :title="t('subdivisionLeadership.positions.endTitle')"
    width-class="max-w-lg"
    @update:model-value="assignmentToEnd = null"
  >
    <p class="text-sm text-base-700">
      {{ t('subdivisionLeadership.positions.endText', { member: assignmentToEnd.member_name, position: assignmentToEnd.position_name }) }}
    </p>
    <template #footer>
      <button type="button" class="btn-secondary" @click="assignmentToEnd = null">{{ t('actions.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="busy" @click="endAssignment">{{ t('subdivisionLeadership.positions.end') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { MemberStatus } from '~/types/member'
import type {
  LeadershipAssignment,
  LeadershipMember,
  LeadershipPositionOption,
  LeadershipSubdivision,
} from '~/types/subdivisionLeadership'

const props = defineProps<{
  subdivision: LeadershipSubdivision
  assignablePositions: LeadershipPositionOption[]
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { hasPermission, isSimulating } = useAuth()
const { formatDate } = useLocaleFormatters()
const { today } = useAppTimeZone()

const memberSearch = ref('')
const addMemberOpen = ref(false)
const assignmentOpen = ref(false)
const editedAssignment = ref<LeadershipAssignment | null>(null)
const memberToRemove = ref<LeadershipMember | null>(null)
const assignmentToEnd = ref<LeadershipAssignment | null>(null)
const busy = ref(false)

// The server sends the scoped permissions effective for this user here (all of them with
// subdivisions.leadership.edit); "view as" never simulates scoped permissions.
const permissions = computed(() => isSimulating() ? [] : props.subdivision.permissions)
const canManageMembers = computed(() => permissions.value.includes('subdivision.members.manage'))
const canViewMembers = computed(() => permissions.value.includes('subdivision.members.view') || hasPermission('subdivisions.leadership.view'))
const canAssignPositions = computed(() => permissions.value.includes('subdivision.positions.assign'))
const canViewHistory = computed(() => permissions.value.includes('subdivision.history.view') || hasPermission('subdivisions.leadership.view'))

function statusLabel(status: MemberStatus) {
  if (status === MemberStatus.Active) return t('member.states.active')
  if (status === MemberStatus.Passive) return t('member.states.passive')
  if (status === MemberStatus.Hold) return t('member.states.hold')
  return t('member.states.left')
}

const memberColumns = computed<AdvancedTableColumn<LeadershipMember>[]>(() => [
  { key: 'name', label: t('common.name'), getValue: row => row.full_name, filterable: false, globalSearchable: true, mobile: 'title' },
  { key: 'subject', label: t('subdivisionLeadership.members.subject'), getValue: row => row.subject_name ?? '', globalSearchable: true, filterType: 'text' },
  { key: 'email', label: t('subdivisionLeadership.members.email'), getValue: row => row.email ?? '', filterable: false, globalSearchable: true },
  { key: 'phone', label: t('subdivisionLeadership.members.phone'), getValue: row => row.phone ?? '', filterable: false, globalSearchable: true, mobileMinBreakpoint: 'lg' },
  { key: 'status', label: t('subdivisionLeadership.members.status'), getValue: row => statusLabel(row.status), filterType: 'text', mobileLabel: true },
])

function isPast(assignment: LeadershipAssignment) {
  return Boolean(assignment.until && assignment.until < today())
}

const activeAssignments = computed(() => props.subdivision.assignments.filter(assignment => !isPast(assignment)))
const pastAssignments = computed(() => props.subdivision.assignments.filter(isPast))

function stateLabel(assignment: LeadershipAssignment) {
  return assignment.since > today() ? t('settings.positions.upcomingBadge') : t('settings.positions.currentBadge')
}

function stateTone(assignment: LeadershipAssignment) {
  return assignment.since > today() ? 'warning' as const : 'success' as const
}

function periodLabel(assignment: LeadershipAssignment) {
  return `${formatDate(assignment.since)} – ${assignment.until ? formatDate(assignment.until) : t('common.openEnded')}`
}

function canEditAssignment(assignment: LeadershipAssignment) {
  return canAssignPositions.value && assignment.assignable_by_leaders && !assignment.is_self
}

function openAssignment(assignment?: LeadershipAssignment) {
  editedAssignment.value = assignment ?? null
  assignmentOpen.value = true
}

async function removeMember() {
  if (!memberToRemove.value || busy.value) return
  busy.value = true
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/subdivision-leadership/remove-member', {
      method: 'POST',
      body: { subdivision_id: props.subdivision.id, member_id: memberToRemove.value.id },
    })
    if (!res.ok) {
      toast.error(res.error || t('subdivisionLeadership.saveFailed'))
      return
    }
    toast.success(t('subdivisionLeadership.members.removed'))
    memberToRemove.value = null
    emit('changed')
  } finally {
    busy.value = false
  }
}

async function endAssignment() {
  if (!assignmentToEnd.value || busy.value) return
  busy.value = true
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/subdivision-leadership/end-assignment', {
      method: 'POST',
      body: { subdivision_id: props.subdivision.id, id: assignmentToEnd.value.id },
    })
    if (!res.ok) {
      toast.error(res.error || t('subdivisionLeadership.saveFailed'))
      return
    }
    toast.success(t('subdivisionLeadership.positions.ended'))
    assignmentToEnd.value = null
    emit('changed')
  } finally {
    busy.value = false
  }
}
</script>
