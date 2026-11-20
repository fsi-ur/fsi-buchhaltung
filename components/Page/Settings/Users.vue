<template>
  <CommonPageTableCard
    v-if="hasAccess"
    :title="t('settings.users.title')"
    persist-key="settings-users"
    :search-value="search"
    :can-create="true"
    :create-label="`+ ${t('settings.users.newUser')}`"
    @update:search-value="search = $event"
    @create="openCreateModal"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['users', 'notification_push_subscriptions']" restricted />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="settings-users"
      :rows="users"
      :columns="columns"
      :empty-text="t('settings.permissions.noUsers')"
      :row-muted="row => !row.is_active"
      actions-menu
      @row-open="openEditUserModal($event)"
    >
      <template #cell-username="{ row }">
        <span class="inline-flex items-center gap-2">
          <span
            v-if="row.is_online"
            class="h-2 w-2 shrink-0 rounded-full bg-success-500"
            :title="t('settings.users.online')"
            role="img"
            :aria-label="t('settings.users.online')"
          />
          <span>{{ row.username }}</span>
          <CommonStatusBadge v-if="row.id === currentUser?.id" :label="t('settings.users.you')" tone="base" />
        </span>
      </template>

      <template #cell-status="{ row }">
        <span class="inline-flex flex-wrap items-center gap-1.5">
          <CommonStatusBadge
            :label="row.is_active ? t('common.active') : t('common.inactive')"
            :tone="row.is_active ? 'success' : 'baseMuted'"
          />
          <CommonStatusBadge
            v-if="row.must_change_password"
            :label="t('settings.users.passwordChangeRequired')"
            tone="warning"
          />
        </span>
      </template>

      <template #cell-lastActive="{ row }">
        <span v-if="row.last_active_at" :title="formatDateTime(row.last_active_at)">
          {{ formatRelativeTime(row.last_active_at) }}
        </span>
        <span v-else class="text-base-400">{{ t('settings.users.neverActive') }}</span>
      </template>

      <template #actions="{ row }">
        <button class="text-base-700 cursor-pointer" @click="openEditUserModal(row)">
          <Icon name="material-symbols:edit-outline-rounded" class="text-base" />
          {{ t('actions.edit') }}
        </button>

        <button
          v-if="!row.must_change_password"
          class="text-warning-700 cursor-pointer"
          @click="requirePasswordChange(row)"
        >
          <Icon name="material-symbols:lock-reset-rounded" class="text-base" />
          {{ t('settings.users.requirePasswordChange') }}
        </button>

        <button
          v-if="row.id !== currentUser?.id"
          class="cursor-pointer"
          :class="row.is_active ? 'text-danger-600' : 'text-success-700'"
          @click="row.is_active ? openDeactivateModal(row) : setUserActive(row, true)"
        >
          <Icon
            :name="row.is_active ? 'material-symbols:person-off-outline-rounded' : 'material-symbols:person-check-outline-rounded'"
            class="text-base"
          />
          {{ row.is_active ? t('actions.deactivate') : t('actions.activate') }}
        </button>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonModal
    v-model="showCreateModal"
    :title="t('settings.users.createTitle')"
    footer-class="relative z-10 mt-4 flex justify-end gap-3 bg-white pt-2"
    @close="closeCreateModal"
  >
    <div class="grid gap-6">
      <section class="grid gap-4">
        <div>
          <h4 class="font-semibold text-base-800">{{ t('settings.users.sections.account') }}</h4>
          <p class="text-sm text-base-500">{{ t('settings.users.sections.accountCreateHint') }}</p>
        </div>

        <div class="field">
          <label>{{ t('login.username') }}</label>
          <input
            v-model="form.username"
            class="input"
            name="settings-user-username"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            data-lpignore="true"
          >
        </div>

        <div class="field">
          <label>{{ t('settings.users.initialPassword') }}</label>
          <input
            v-model="form.password"
            type="password"
            class="input"
            name="settings-user-password"
            autocomplete="new-password"
            autocapitalize="off"
            spellcheck="false"
            data-lpignore="true"
          >
          <p class="mt-1 text-xs text-base-500">{{ t('settings.users.passwordMinLength', { min: MIN_PASSWORD_LENGTH }) }}</p>
        </div>

        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-base-700">{{ t('settings.users.active') }}</p>
            <p class="text-xs text-base-500">{{ t('settings.users.activeHint') }}</p>
          </div>
          <CommonToggleSwitch v-model="form.is_active" :label="t('settings.users.active')" />
        </div>

        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-base-700">{{ t('settings.users.mustChangePassword') }}</p>
            <p class="text-xs text-base-500">{{ t('settings.users.mustChangePasswordHint') }}</p>
          </div>
          <CommonToggleSwitch v-model="form.must_change_password" :label="t('settings.users.mustChangePassword')" />
        </div>
      </section>

      <section class="grid gap-4 border-t border-base-200 pt-4">
        <div>
          <h4 class="font-semibold text-base-800">{{ t('settings.users.sections.member') }}</h4>
          <p class="text-sm text-base-500">{{ t('settings.users.sections.memberHint') }}</p>
        </div>

        <div class="field relative z-20">
          <label>{{ t('settings.users.linkedMember') }}</label>
          <CommonSearchSelect
            v-model="createMemberQuery"
            :options="createMemberOptions"
            :selected-label="selectedCreateMemberLabel"
            :placeholder="t('settings.users.memberPlaceholder')"
            :empty-text="t('settings.users.noAvailableMembers')"
            @select="selectCreateMember"
            @clear-selection="form.member_id = null"
          />
        </div>
      </section>
    </div>

    <template #footer>
      <button class="btn-secondary" @click="closeCreateModal">
        {{ t('actions.cancel') }}
      </button>

      <button class="btn-primary" :disabled="isCreatingUser" :class="{ 'opacity-50 cursor-not-allowed': isCreatingUser }" @click="createUser">
        {{ t('actions.createNew') }}
      </button>
    </template>
  </CommonModal>

  <CommonModal
    v-if="editingUser"
    :model-value="!!editingUser"
    :title="t('settings.users.editUserTitle', { username: editingUser.username })"
    footer-class="relative z-10 mt-4 flex justify-end gap-3 bg-white pt-2"
    @update:model-value="!$event && closeEditUserModal()"
    @close="closeEditUserModal"
  >
    <div class="grid gap-6">
      <section class="grid gap-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h4 class="font-semibold text-base-800">{{ t('settings.users.sections.account') }}</h4>
            <p class="text-sm text-base-500">{{ t('settings.users.sections.accountHint') }}</p>
          </div>
          <CommonStatusBadge
            v-if="editingUser.must_change_password"
            :label="t('settings.users.passwordChangeRequired')"
            tone="warning"
          />
        </div>

        <div class="field">
          <label>{{ t('login.username') }}</label>
          <input
            v-model="editingUsernameInput"
            class="input"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            data-lpignore="true"
          >
        </div>

        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-base-700">{{ t('settings.users.active') }}</p>
            <p class="text-xs text-base-500">
              {{ editingUser.id === currentUser?.id ? t('settings.users.cannotDeactivateSelf') : t('settings.users.activeHint') }}
            </p>
          </div>
          <CommonToggleSwitch
            v-model="editingIsActive"
            :label="t('settings.users.active')"
            :disabled="editingUser.id === currentUser?.id"
          />
        </div>

        <p
          v-if="editingUser.is_active && !editingIsActive"
          class="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-800"
        >
          {{ t('settings.users.deactivateConsequences') }}
        </p>
      </section>

      <section class="grid gap-4 border-t border-base-200 pt-4">
        <div>
          <h4 class="font-semibold text-base-800">{{ t('settings.users.sections.password') }}</h4>
          <p class="text-sm text-base-500">{{ t('settings.users.sections.passwordHint') }}</p>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="field">
            <label>{{ t('settings.general.newPassword') }}</label>
            <input
              v-model="editingPasswordNew"
              type="password"
              class="input"
              autocomplete="new-password"
            >
          </div>

          <div class="field">
            <label>{{ t('settings.general.confirmPassword') }}</label>
            <input
              v-model="editingPasswordConfirm"
              type="password"
              class="input"
              autocomplete="new-password"
            >
          </div>
        </div>
      </section>

      <section class="grid gap-4 border-t border-base-200 pt-4">
        <div>
          <h4 class="font-semibold text-base-800">{{ t('settings.users.sections.member') }}</h4>
          <p class="text-sm text-base-500">{{ t('settings.users.sections.memberHint') }}</p>
        </div>

        <div class="field relative z-20">
          <label>{{ t('settings.users.linkedMember') }}</label>
          <CommonSearchSelect
            v-model="editMemberQuery"
            :options="editMemberOptions"
            :selected-label="selectedEditMemberLabel"
            :placeholder="t('settings.users.memberPlaceholder')"
            :empty-text="t('settings.users.noAvailableMembers')"
            @select="selectEditMember"
            @clear-selection="editingMemberId = null"
          />
        </div>
      </section>
    </div>

    <template #footer>
      <button class="btn-secondary" :disabled="isSavingUserEdit" :class="{ 'opacity-50 cursor-not-allowed': isSavingUserEdit }" @click="closeEditUserModal">
        {{ t('actions.cancel') }}
      </button>

      <button class="btn-primary" :disabled="isSavingUserEdit" :class="{ 'opacity-50 cursor-not-allowed': isSavingUserEdit }" @click="saveUserEdit">
        {{ t('actions.save') }}
      </button>
    </template>
  </CommonModal>

  <CommonModal
    v-if="deactivatingUser"
    :model-value="!!deactivatingUser"
    :title="t('settings.users.deactivateTitle', { username: deactivatingUser.username })"
    @update:model-value="!$event && (deactivatingUser = null)"
    @close="deactivatingUser = null"
  >
    <p class="text-sm text-base-700">{{ t('settings.users.deactivateConsequences') }}</p>

    <template #footer>
      <button class="btn-secondary" :disabled="isTogglingActive" @click="deactivatingUser = null">
        {{ t('actions.cancel') }}
      </button>

      <button
        class="btn-primary"
        :disabled="isTogglingActive"
        :class="{ 'opacity-50 cursor-not-allowed': isTogglingActive }"
        @click="confirmDeactivate"
      >
        {{ t('actions.deactivate') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordPolicyError } from '~/config/validation'

interface UserListRow {
  id: number
  username: string
  is_active: number | boolean
  must_change_password: number | boolean
  last_active_at: string | null
  is_online: number
  member_id: number | null
  member_name: string | null
}

interface MemberOptionRow {
  id: number
  full_name: string
  account: number | null
  account_username: string | null
}

const { t } = useI18n()
const toast = useToast()
const { hasPermission, user: currentUser, fetchSession } = useAuth()
const { formatDateTime, formatRelativeTime } = useLocaleFormatters()

const hasAccess = computed(() => hasPermission('users.manage'))
const users = ref<UserListRow[]>([])
const loading = ref(true)
const memberOptions = ref<MemberOptionRow[]>([])
const showCreateModal = ref(false)
const editingUser = ref<UserListRow | null>(null)
const createMemberQuery = ref('')
const editMemberQuery = ref('')
const form = ref({
  username: '',
  password: '',
  is_active: true,
  must_change_password: true,
  member_id: null as number | null,
})
const editingMemberId = ref<number | null>(null)
const editingUsernameInput = ref('')
const editingPasswordNew = ref('')
const editingPasswordConfirm = ref('')
const editingIsActive = ref(true)
const deactivatingUser = ref<UserListRow | null>(null)
const isTogglingActive = ref(false)
const isCreatingUser = ref(false)
const isSavingUserEdit = ref(false)
const search = ref('')

const columns = computed<AdvancedTableColumn<UserListRow>[]>(() => [
  {
    key: 'username',
    label: t('login.username'),
    filterable: false,
    globalSearchable: true,
    getValue: user => user.username,
    mobile: 'title',
  },
  {
    key: 'member',
    label: t('settings.users.linkedMember'),
    filterable: false,
    globalSearchable: true,
    getValue: user => user.member_name || t('settings.users.noLinkedMember'),
    mobileLabel: true,
  },
  {
    key: 'status',
    label: t('common.status'),
    getValue: user => (user.is_active ? t('common.active') : t('common.inactive')),
  },
  {
    key: 'lastActive',
    label: t('settings.users.lastActive'),
    // ISO instants sort chronologically as strings; never-active users sort as oldest.
    getValue: user => user.last_active_at ?? '',
    filterValue: user => (user.is_online ? t('settings.users.online') : t('settings.users.offline')),
    mobileLabel: true,
  },
])

const createMemberOptions = computed<SearchSelectOption<MemberOptionRow>[]>(() => memberOptions.value
  .filter(member => member.account === null)
  .map(member => ({
    key: member.id,
    label: member.full_name,
    value: member,
  })))
const editMemberOptions = computed<SearchSelectOption<MemberOptionRow>[]>(() => {
  const userId = editingUser.value?.id ?? null
  return memberOptions.value
    .filter(member => member.account === null || member.account === userId)
    .map(member => ({
      key: member.id,
      label: member.full_name,
      value: member,
    }))
})
const selectedCreateMemberLabel = computed(() => {
  const selected = memberOptions.value.find(member => member.id === form.value.member_id)
  return selected?.full_name || ''
})
const selectedEditMemberLabel = computed(() => {
  const selected = memberOptions.value.find(member => member.id === editingMemberId.value)
  return selected?.full_name || ''
})

function resetForm() {
  form.value = {
    username: '',
    password: '',
    is_active: true,
    must_change_password: true,
    member_id: null,
  }
  createMemberQuery.value = ''
}

function openCreateModal() {
  resetForm()
  showCreateModal.value = true
}

function closeCreateModal() {
  showCreateModal.value = false
  resetForm()
}

function openEditUserModal(user: UserListRow) {
  editingUser.value = { ...user }
  editingUsernameInput.value = user.username
  editingMemberId.value = user.member_id
  editMemberQuery.value = user.member_name || ''
  editingPasswordNew.value = ''
  editingPasswordConfirm.value = ''
  editingIsActive.value = Boolean(user.is_active)
}

function closeEditUserModal() {
  if (isSavingUserEdit.value) return
  editingUser.value = null
  editingUsernameInput.value = ''
  editingMemberId.value = null
  editMemberQuery.value = ''
  editingPasswordNew.value = ''
  editingPasswordConfirm.value = ''
}

function selectCreateMember(value: unknown) {
  const member = value as MemberOptionRow
  form.value.member_id = member.id
  createMemberQuery.value = member.full_name
}

function selectEditMember(value: unknown) {
  const member = value as MemberOptionRow
  editingMemberId.value = member.id
  editMemberQuery.value = member.full_name
}

async function loadUsers() {
  const res = await apiFetch<{ ok: boolean, users?: UserListRow[], error?: string }>('/api/auth/users')
  if (res.ok && res.users) users.value = res.users
}

async function loadMemberOptions() {
  const res = await apiFetch<{ ok: boolean, members?: MemberOptionRow[], error?: string }>('/api/auth/member-options')
  if (res.ok && res.members) memberOptions.value = res.members
}

async function createUser() {
  if (isCreatingUser.value) return

  const payload = {
    username: form.value.username.trim(),
    password: form.value.password,
    is_active: form.value.is_active,
    must_change_password: form.value.must_change_password,
    member_id: form.value.member_id,
  }

  if (!payload.username || !payload.password) {
    toast.error(t('settings.users.missingFields'))
    return
  }

  if (passwordPolicyError(payload.password) === 'Password too long') {
    toast.error(t('settings.general.passwordTooLong', { max: MAX_PASSWORD_BYTES }))
    return
  }
  if (payload.password.length < MIN_PASSWORD_LENGTH) {
    toast.error(t('settings.users.setPasswordTooShort', { min: MIN_PASSWORD_LENGTH }))
    return
  }

  try {
    isCreatingUser.value = true
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/register', {
      method: 'POST',
      body: payload,
    })

    if (!res.ok) {
      if (res.error === 'Username already exists') {
        toast.error(t('settings.users.usernameExists'))
        return
      }
      if (res.error === 'Password too long') {
        toast.error(t('settings.general.passwordTooLong', { max: MAX_PASSWORD_BYTES }))
        return
      }
      if (res.error === 'Password too short') {
        toast.error(t('settings.users.setPasswordTooShort', { min: MIN_PASSWORD_LENGTH }))
        return
      }
      if (res.error === 'Member already linked to another user') {
        toast.error(t('settings.users.memberAlreadyLinked'))
        return
      }
      if (res.error === 'Member not found') {
        toast.error(t('settings.users.memberNotFound'))
        return
      }
      toast.error(`${t('settings.users.createFailed')}: ${res.error}`)
      return
    }

    toast.success(t('settings.users.created'))
    closeCreateModal()
    await Promise.all([loadUsers(), loadMemberOptions()])
  } finally {
    isCreatingUser.value = false
  }
}

async function saveUserEdit() {
  if (!editingUser.value || isSavingUserEdit.value) return

  const newUsername = editingUsernameInput.value.trim()

  if (!newUsername) {
    toast.error(t('settings.users.usernameRequired'))
    return
  }

  if (editingPasswordNew.value) {
    if (passwordPolicyError(editingPasswordNew.value) === 'Password too long') {
      toast.error(t('settings.general.passwordTooLong', { max: MAX_PASSWORD_BYTES }))
      return
    }
    if (editingPasswordNew.value.length < MIN_PASSWORD_LENGTH) {
      toast.error(t('settings.users.setPasswordTooShort', { min: MIN_PASSWORD_LENGTH }))
      return
    }
    if (editingPasswordNew.value !== editingPasswordConfirm.value) {
      toast.error(t('settings.users.setPasswordMismatch'))
      return
    }
  }

  try {
    isSavingUserEdit.value = true

    if (newUsername !== editingUser.value.username) {
      const res = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/change-username', {
        method: 'POST',
        body: { user_id: editingUser.value.id, username: newUsername },
      })
      if (!res.ok) {
        if (res.error === 'Username already exists') {
          toast.error(t('settings.users.usernameExists'))
          return
        }
        toast.error(`${t('settings.users.usernameSaveFailed')}: ${res.error}`)
        return
      }
    }

    if (editingPasswordNew.value) {
      const res = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/admin-set-password', {
        method: 'POST',
        body: {
          user_id: editingUser.value.id,
          newPassword: editingPasswordNew.value,
          confirmPassword: editingPasswordConfirm.value,
        },
      })
      if (!res.ok) {
        toast.error(`${t('settings.users.setPasswordFailed')}: ${res.error}`)
        return
      }
    }

    const memberRes = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/link-member', {
      method: 'POST',
      body: {
        user_id: editingUser.value.id,
        member_id: editingMemberId.value,
      },
    })
    if (!memberRes.ok) {
      if (memberRes.error === 'Member already linked to another user') {
        toast.error(t('settings.users.memberAlreadyLinked'))
        return
      }
      if (memberRes.error === 'Member not found') {
        toast.error(t('settings.users.memberNotFound'))
        return
      }
      toast.error(`${t('settings.users.memberSaveFailed')}: ${memberRes.error}`)
      return
    }

    if (editingIsActive.value !== Boolean(editingUser.value.is_active)) {
      const activeRes = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/activate', {
        method: 'POST',
        body: { id: editingUser.value.id, is_active: editingIsActive.value },
      })
      if (!activeRes.ok) {
        toast.error(`${t('settings.users.activationFailed')}: ${activeRes.error}`)
        await loadUsers()
        return
      }
    }

    toast.success(t('settings.users.userEditSaved'))
    isSavingUserEdit.value = false
    closeEditUserModal()
    await Promise.all([loadUsers(), loadMemberOptions()])
  } finally {
    isSavingUserEdit.value = false
  }
}

function openDeactivateModal(user: UserListRow) {
  deactivatingUser.value = user
}

async function confirmDeactivate() {
  if (!deactivatingUser.value) return
  const done = await setUserActive(deactivatingUser.value, false)
  if (done) deactivatingUser.value = null
}

async function setUserActive(user: UserListRow, isActive: boolean): Promise<boolean> {
  if (isTogglingActive.value) return false
  try {
    isTogglingActive.value = true
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/activate', {
      method: 'POST',
      body: { id: user.id, is_active: isActive },
    })

    if (!res.ok) {
      toast.error(`${t('settings.users.activationFailed')}: ${res.error}`)
      return false
    }

    toast.success(isActive
      ? t('settings.users.activated', { username: user.username })
      : t('settings.users.deactivated', { username: user.username }))
    await loadUsers()
    return true
  } finally {
    isTogglingActive.value = false
  }
}

async function requirePasswordChange(user: UserListRow) {
  const res = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/require-password-change', {
    method: 'POST',
    body: {
      user_id: user.id,
    },
  })

  if (!res.ok) {
    toast.error(`${t('settings.users.requirePasswordChangeFailed')}: ${res.error}`)
    return
  }

  toast.success(t('settings.users.requirePasswordChangeSaved'))
  if (currentUser.value?.id === user.id) {
    await fetchSession()
    return
  }
  await loadUsers()
}

onMounted(async () => {
  if (!hasAccess.value) {
    loading.value = false
    return
  }
  await loadSupportData()
})

// The online dot reflects the moment of loading, so keep it (and the relative times) fresh.
const ONLINE_REFRESH_MS = 60_000
let onlineRefreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  if (!hasAccess.value) return
  onlineRefreshTimer = setInterval(() => {
    if (document.hidden) return
    loadUsers().catch(() => {})
  }, ONLINE_REFRESH_MS)
})

onBeforeUnmount(() => {
  if (onlineRefreshTimer) clearInterval(onlineRefreshTimer)
})

useAppRefresh().onRefresh(async () => {
  if (!hasAccess.value) return
  await loadSupportData()
})

async function loadSupportData() {
  try {
    await Promise.all([loadUsers(), loadMemberOptions()])
  } finally {
    loading.value = false
  }
}
</script>
