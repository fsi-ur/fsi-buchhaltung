<template>
  <PageSettingsEntityManager
    ref="entityManagerRef"
    :title="t('settings.entities.subdivisions')"
    :singular-label="t('settings.entities.subdivision')"
    :add-label="t('settings.entities.newSubdivision')"
    :empty-label="t('settings.entities.noSubdivisions')"
    persist-key="settings-subdivisions"
    list-endpoint="/api/subdivisions"
    save-endpoint="/api/subdivisions/save"
    activate-endpoint="/api/subdivisions/activate"
    response-list-key="subdivisions"
    :history-tables="['subdivisions', 'subdivision_members']"
    :extra-columns="tableColumns"
    :can-manage="hasAccess"
    :create-item="createItem"
    :map-edit-item="mapEditItem"
    :on-error="handleError"
  >
    <template #actions="{ item, edit, reload }">
      <button class="text-link-600 hover:underline cursor-pointer" @click="edit()">
        {{ t('actions.edit') }}
      </button>

      <button
        class="hover:underline cursor-pointer"
        :class="item.is_active ? 'text-danger-500' : 'text-base-500'"
        @click="item.is_active ? openDeactivateModal(item, reload) : toggleSubdivision(item, true, false, reload)"
      >
        {{ item.is_active ? t('actions.deactivate') : t('actions.activate') }}
      </button>
    </template>

    <template #cell-members="{ item }">
      {{ memberSummary(item) }}
    </template>

    <template #cell-count="{ item }">
      <span class="font-medium text-base-800">{{ memberCount(item) }}</span>
    </template>

    <template #modal-fields-after-description="{ editingItem }">
      <div class="field relative z-20">
        <label>{{ t('settings.subdivisions.members') }}</label>
        <CommonSelectionListField
          :query="memberQuery"
          :options="memberSearchOptions(editingItem)"
          :selected-items="selectedMemberItems(editingItem)"
          :placeholder="t('settings.subdivisions.memberPlaceholder')"
          :empty-text="t('settings.subdivisions.noMembersAvailable')"
          :empty-selection-text="t('settings.subdivisions.noMembersAssigned')"
          :remove-label="t('actions.remove')"
          @update:query="memberQuery = $event"
          @select="selectMember($event, editingItem)"
          @clear-selection="memberQuery = ''"
          @remove="removeMember($event, editingItem)"
        />
      </div>
    </template>
  </PageSettingsEntityManager>

  <CommonModal
    v-if="deactivateTarget"
    v-model="deactivateModalOpen"
    :title="t('settings.subdivisions.deactivateConfirm.title')"
    width-class="max-w-xl"
    @close="closeDeactivateModal"
  >
    <p class="text-sm text-base-600">
      {{ t('settings.subdivisions.deactivateConfirm.intro', { subdivision: `${deactivateTarget.code} - ${deactivateTarget.name}` }) }}
    </p>

    <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-200 p-3 transition-colors hover:border-base-300 hover:bg-base-50">
      <input
        v-model="removeAssignedMembers"
        type="checkbox"
        class="checkbox"
      >
      <span class="text-sm text-base-700">
        {{ t('settings.subdivisions.deactivateConfirm.removeMembers') }}
      </span>
    </label>

    <div v-if="deactivateMembers.length" class="space-y-2">
      <div class="text-sm font-medium text-base-700">
        {{ t('settings.subdivisions.deactivateConfirm.assignedMembersTitle') }}
      </div>
      <div class="max-h-48 overflow-y-auto rounded-lg border border-base-200 bg-base-50 p-3">
        <div
          v-for="member in deactivateMembers"
          :key="member.id"
          class="text-sm text-base-700"
        >
          {{ member.full_name }}
        </div>
      </div>
    </div>

    <p v-else class="text-sm text-base-500">
      {{ t('settings.subdivisions.deactivateConfirm.noAssignedMembers') }}
    </p>

    <template #footer>
      <button class="btn-secondary" @click="closeDeactivateModal">
        {{ t('actions.cancel') }}
      </button>
      <button class="btn-primary" @click="confirmDeactivate">
        {{ t('actions.deactivate') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import type { EntityManagerColumn, SaveSettingsEntityBody, SettingsEntityRow } from '~/components/Page/Settings/EntityManager.vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { SelectionListItem } from '~/components/Common/SelectionListField.vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { MemberStatus } from '~/types/member'
import type { SaveSubdivisionBody, SubdivisionMemberOption, SubdivisionRow } from '~/types/subdivision'

interface EditableSubdivision extends SaveSubdivisionBody {
  member_ids: number[]
}

const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()

const hasAccess = computed(() => hasPermission('settings.subdivisions.manage'))
const entityManagerRef = ref<{ loadItems: () => Promise<void> } | null>(null)
const memberOptions = ref<SubdivisionMemberOption[]>([])
const memberQuery = ref('')
const deactivateModalOpen = ref(false)
const deactivateTarget = ref<SubdivisionRow | null>(null)
const deactivateMembers = ref<SubdivisionRow['members']>([])
const removeAssignedMembers = ref(false)
const reloadAfterToggle = ref<null | (() => Promise<void>)>(null)

const tableColumns = computed<EntityManagerColumn[]>(() => [
  {
    key: 'members',
    label: t('settings.subdivisions.members'),
    filterable: false,
    getValue: item => memberSummary(item),
  },
  {
    key: 'count',
    label: t('common.count'),
    filterType: 'number',
    getValue: item => memberCount(item),
  },
])

const memberOptionsById = computed(() => {
  return new Map(memberOptions.value.map(member => [member.id, member]))
})

function statusLabel(status: MemberStatus) {
  if (status === MemberStatus.Active) return t('member.states.active')
  if (status === MemberStatus.Passive) return t('member.states.passive')
  if (status === MemberStatus.Hold) return t('member.states.hold')
  return t('member.states.left')
}

function memberSummary(item: SettingsEntityRow) {
  const subdivision = item as SubdivisionRow
  if (!subdivision.members.length) return t('settings.subdivisions.noMembersAssigned')

  const labels = subdivision.members.map(member => member.full_name)
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`
}

function memberCount(item: SettingsEntityRow) {
  return (item as SubdivisionRow).members.length
}

function subdivisionBody(editingItem: SaveSettingsEntityBody) {
  return editingItem as EditableSubdivision
}

function createItem(): EditableSubdivision {
  memberQuery.value = ''
  return {
    code: '',
    name: '',
    description: '',
    member_ids: [],
  }
}

function mapEditItem(item: SettingsEntityRow): EditableSubdivision {
  memberQuery.value = ''
  const subdivision = item as SubdivisionRow
  return {
    id: subdivision.id,
    code: subdivision.code,
    name: subdivision.name,
    description: subdivision.description ?? '',
    is_active: subdivision.is_active,
    member_ids: subdivision.members.map(member => member.id),
  }
}

function selectedMemberItems(editingItem: SaveSettingsEntityBody) {
  return subdivisionBody(editingItem).member_ids
    .map(memberId => memberOptionsById.value.get(memberId))
    .filter((member): member is SubdivisionMemberOption => Boolean(member))
    .map<SelectionListItem>(member => ({
      id: member.id,
      label: member.full_name,
      meta: member.subject_name || statusLabel(member.status),
    }))
}

function memberSearchOptions(editingItem: SaveSettingsEntityBody) {
  const selectedIds = new Set(subdivisionBody(editingItem).member_ids)

  return memberOptions.value
    .filter(member => !selectedIds.has(member.id))
    .map<SearchSelectOption<number>>(member => ({
      key: member.id,
      label: member.full_name,
      value: member.id,
      searchText: `${member.full_name} ${member.subject_name || ''} ${statusLabel(member.status)}`.trim(),
    }))
}

function selectMember(value: unknown, editingItem: SaveSettingsEntityBody) {
  const memberId = Number(value)
  if (!Number.isInteger(memberId) || memberId <= 0) return

  const currentIds = subdivisionBody(editingItem).member_ids
  if (currentIds.includes(memberId)) return

  subdivisionBody(editingItem).member_ids = [...currentIds, memberId]
  memberQuery.value = ''
}

function removeMember(value: string | number, editingItem: SaveSettingsEntityBody) {
  const memberId = Number(value)
  subdivisionBody(editingItem).member_ids = subdivisionBody(editingItem).member_ids.filter(id => id !== memberId)
}

function openDeactivateModal(item: SettingsEntityRow, reload: () => Promise<void>) {
  const subdivision = item as SubdivisionRow
  deactivateTarget.value = subdivision
  deactivateMembers.value = subdivision.members
  removeAssignedMembers.value = subdivision.members.length > 0
  reloadAfterToggle.value = reload
  deactivateModalOpen.value = true
}

function closeDeactivateModal() {
  deactivateModalOpen.value = false
  deactivateTarget.value = null
  deactivateMembers.value = []
  removeAssignedMembers.value = false
  reloadAfterToggle.value = null
}

async function toggleSubdivision(
  item: SettingsEntityRow,
  isActive: boolean,
  removeMemberAssignments: boolean,
  reload: () => Promise<void>,
) {
  const res = await apiFetch<{ ok: boolean, error?: string }>('/api/subdivisions/activate', {
    method: 'POST',
    body: {
      id: item.id,
      is_active: isActive,
      remove_member_assignments: removeMemberAssignments,
    },
  })

  if (!res.ok) {
    handleError({ phase: 'toggle', message: res.error })
    return false
  }

  await reload()
  return true
}

async function confirmDeactivate() {
  if (!deactivateTarget.value || !reloadAfterToggle.value) return

  const ok = await toggleSubdivision(
    deactivateTarget.value,
    false,
    removeAssignedMembers.value,
    reloadAfterToggle.value,
  )
  if (ok) closeDeactivateModal()
}

async function loadMemberOptions() {
  try {
    const res = await apiFetch<{ ok: boolean, members?: SubdivisionMemberOption[], error?: string }>('/api/subdivisions/member-options')
    if (!res.ok) {
      toast.error(res.error || t('settings.subdivisions.loadFailed'))
      return
    }

    memberOptions.value = res.members ?? []
  } catch (error) {
    console.error(error)
    toast.error(t('settings.subdivisions.loadFailed'))
  }
}

function handleError({ phase, message, error }: { phase: 'load' | 'save' | 'toggle', message?: string, error?: unknown }) {
  if (error) console.error(error)

  if (phase === 'load') {
    toast.error(message || t('settings.subdivisions.loadFailed'))
    return
  }

  if (phase === 'save') {
    toast.error(message || t('settings.subdivisions.saveFailed'))
    return
  }

  toast.error(message || t('settings.subdivisions.updateFailed'))
}

onMounted(async () => {
  if (!hasAccess.value) return
  await loadMemberOptions()
})

useAppRefresh().onRefresh(async () => {
  if (!hasAccess.value) return
  await Promise.all([loadMemberOptions(), entityManagerRef.value?.loadItems()])
})
</script>
