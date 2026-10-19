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
      @row-open="openEditUserModal($event)"
    >
      <template #cell-username="{ row }">
        <div class="flex flex-col gap-1">
          <span>{{ row.username }}</span>
          <span
            v-if="row.must_change_password"
            class="w-fit rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-800"
          >
            {{ t('settings.users.passwordChangeRequired') }}
          </span>
        </div>
      </template>
      <template #actions="{ row }">
        <button class="text-link-600 hover:underline cursor-pointer" @click="openEditUserModal(row)">
          {{ t('actions.edit') }}
        </button>

        <button
          v-if="!row.must_change_password"
          class="text-warning-700 hover:underline cursor-pointer"
          @click="requirePasswordChange(row)"
        >
          {{ t('settings.users.requirePasswordChange') }}
        </button>

        <button
          class="hover:underline cursor-pointer"
          :class="row.is_active ? 'text-danger-500' : 'text-base-500'"
          @click="toggleUserActive(row)"
        >
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
    <div class="grid gap-4">
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
        <label>{{ t('login.password') }}</label>
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
    </div>

    <div class="flex gap-3">
      <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
        <input v-model="form.is_active" type="checkbox" class="checkbox">
        {{ t('settings.users.active') }}
      </label>

      <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
        <input v-model="form.must_change_password" type="checkbox" class="checkbox">
        {{ t('settings.users.mustChangePassword') }}
      </label>
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
    <div class="grid gap-4">
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
</template>

<script setup lang="ts">
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import { MIN_PASSWORD_LENGTH } from '~/config/validation'

interface UserListRow {
  id: number
  username: string
  is_active: number | boolean
  must_change_password: number | boolean
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

    toast.success(t('settings.users.userEditSaved'))
    isSavingUserEdit.value = false
    closeEditUserModal()
    await Promise.all([loadUsers(), loadMemberOptions()])
  } finally {
    isSavingUserEdit.value = false
  }
}

async function toggleUserActive(user: UserListRow) {
  const res = await apiFetch<{ ok: boolean, error?: string }>('/api/auth/activate', {
    method: 'POST',
    body: {
      id: user.id,
      is_active: !Boolean(user.is_active),
    },
  })

  if (!res.ok) {
    toast.error(`${t('settings.users.activationFailed')}: ${res.error}`)
    return
  }

  await loadUsers()
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
