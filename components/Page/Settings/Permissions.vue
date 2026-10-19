<template>
  <div v-if="hasAccess" class="contents">
    <CommonCard v-if="canManagePermissions" :title="t('settings.permissions.rolesTitle')">
      <template #actions>
        <PageAuditTableHistoryButton :tables="['roles', 'role_permissions']" restricted />
        <CommonAdvancedTableViewToggle persist-key="settings-permissions-roles" />
        <CommonGlobalSearchBar v-model="roleSearchInput" />
        <button class="btn-primary" @click="openRoleEditor()">
          + {{ t('settings.permissions.newRole') }}
        </button>
      </template>

      <CommonAdvancedTable
        v-model:search="roleSearchInput"
        persist-key="settings-permissions-roles"
        :rows="roles"
        :columns="roleColumns"
        :empty-text="t('settings.permissions.noRoles')"
        @row-open="openRoleEditor($event)"
      >
        <template #cell-description="{ row }">
          <span class="text-base-600">{{ row.description || '-' }}</span>
        </template>
        <template #actions="{ row }">
          <button class="text-link-600 hover:underline cursor-pointer" @click="openRoleEditor(row)">
            {{ t('actions.edit') }}
          </button>
          <button class="text-warning-600 hover:underline cursor-pointer" @click="openRolePermissions(row)">
            {{ t('settings.permissions.editPermissions') }}
          </button>
        </template>
      </CommonAdvancedTable>
    </CommonCard>

    <CommonCard v-if="canManagePermissions" :title="t('settings.permissions.positionsTitle')">
      <template #actions>
        <PageAuditTableHistoryButton :tables="['position_permissions']" />
        <CommonAdvancedTableViewToggle persist-key="settings-permissions-positions" />
        <CommonGlobalSearchBar v-model="positionSearchInput" />
      </template>

      <CommonAdvancedTable
        v-model:search="positionSearchInput"
        persist-key="settings-permissions-positions"
        :rows="positions"
        :columns="positionColumns"
        :empty-text="t('settings.permissions.noPositions')"
        @row-open="openPositionPermissions($event)"
      >
        <template #actions="{ row }">
          <button class="text-warning-600 hover:underline cursor-pointer" @click="openPositionPermissions(row)">
            {{ t('settings.permissions.editPermissions') }}
          </button>
        </template>
      </CommonAdvancedTable>
    </CommonCard>

    <CommonCard v-if="canManagePermissions" :title="t('settings.permissions.usersTitle')">
      <template #actions>
        <PageAuditTableHistoryButton :tables="['user_permissions', 'user_roles']" restricted />
        <CommonAdvancedTableViewToggle persist-key="settings-permissions-users" />
        <CommonGlobalSearchBar v-model="userSearchInput" />
      </template>

      <CommonAdvancedTable
        v-model:search="userSearchInput"
        persist-key="settings-permissions-users"
        :rows="users"
        :columns="userColumns"
        :empty-text="t('settings.permissions.noUsers')"
        @row-open="openUserAccess($event)"
      >
        <template #actions="{ row }">
          <button class="text-warning-600 hover:underline cursor-pointer" @click="openUserAccess(row)">
            {{ t('settings.permissions.editAccess') }}
          </button>
        </template>
      </CommonAdvancedTable>
    </CommonCard>

    <CommonModal
      v-if="canManagePermissions"
      v-model="showRoleModal"
      :title="roleForm.isNew ? t('settings.permissions.newRole') : t('settings.permissions.editRole')"
      width-class="max-w-lg"
      @close="closeRoleModal"
    >
      <div class="field">
        <label>{{ t('common.code') }}</label>
        <input v-model="roleForm.code" class="input" />
      </div>
      <div class="field">
        <label>{{ t('common.name') }}</label>
        <input v-model="roleForm.name" class="input" />
      </div>
      <div class="field">
        <label>{{ t('common.description') }}</label>
        <textarea v-model="roleForm.description" rows="3" class="input resize-none" />
      </div>
      <div class="flex gap-4">
        <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
          <input v-model="roleForm.is_active" type="checkbox" class="checkbox" />
          {{ t('settings.permissions.roleActive') }}
        </label>
        <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
          <input v-model="roleForm.is_default" type="checkbox" class="checkbox" />
          {{ t('settings.permissions.defaultRole') }}
        </label>
      </div>

      <template #footer>
        <button class="btn-secondary" @click="closeRoleModal">{{ t('actions.cancel') }}</button>
        <button class="btn-primary" :disabled="savingRole" :class="{ 'opacity-50 cursor-not-allowed': savingRole }" @click="saveRole">{{ t('actions.save') }}</button>
      </template>
    </CommonModal>

    <CommonModal
      v-if="permissionModal"
      :model-value="!!permissionModal"
      :title="t('settings.permissions.permissionsFor', { name: permissionModal.title })"
      width-class="max-w-2xl"
      body-class="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-2"
      @update:model-value="permissionModal = null"
    >
      <div
        v-for="group in permissionGroups"
        :key="group.categoryKey"
        class="border rounded-lg p-4"
      >
        <h4 class="font-semibold mb-2">{{ group.categoryLabel }}</h4>
        <div class="grid md:grid-cols-2 gap-2">
          <label v-for="perm in group.permissions" :key="perm.key" class="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              :value="perm.key"
              v-model="permissionModal.selected"
            />
            <span>{{ t(perm.labelKey) }}</span>
          </label>
        </div>
      </div>

      <template #footer>
        <button class="btn-secondary" @click="permissionModal = null">{{ t('actions.cancel') }}</button>
        <button class="btn-primary" :disabled="savingPermissions" :class="{ 'opacity-50 cursor-not-allowed': savingPermissions }" @click="savePermissionModal">{{ t('actions.save') }}</button>
      </template>
    </CommonModal>

    <CommonModal
      v-if="userModal"
      :model-value="!!userModal"
      :title="t('settings.permissions.accessFor', { name: userModal.username })"
      width-class="max-w-2xl"
      body-class="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-2"
      @update:model-value="userModal = null"
    >
      <div class="border rounded-lg p-4">
        <h4 class="font-semibold mb-2">{{ t('settings.permissions.roles') }}</h4>
        <div class="grid md:grid-cols-2 gap-2">
          <label v-for="role in roles" :key="role.id" class="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              :value="role.id"
              :disabled="!role.is_active && !userModal.roles.includes(role.id)"
              v-model="userModal.roles"
            />
            <span>{{ formatRoleOptionLabel(role) }}</span>
          </label>
        </div>
      </div>

      <div
        v-for="group in permissionGroups"
        :key="group.categoryKey"
        class="border rounded-lg p-4"
      >
        <h4 class="font-semibold mb-2">{{ group.categoryLabel }}</h4>
        <div class="grid md:grid-cols-2 gap-2">
          <label v-for="perm in group.permissions" :key="perm.key" class="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              class="checkbox"
              :value="perm.key"
              v-model="userModal.permissions"
            />
            <span>{{ t(perm.labelKey) }}</span>
          </label>
        </div>
      </div>

      <template #footer>
        <button class="btn-secondary" @click="userModal = null">{{ t('actions.cancel') }}</button>
        <button class="btn-primary" :disabled="savingUserAccess" :class="{ 'opacity-50 cursor-not-allowed': savingUserAccess }" @click="saveUserAccess">{{ t('actions.save') }}</button>
      </template>
    </CommonModal>

    <SettingsViewAs v-if="canUseViewAs" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { PermissionDefinition } from '~/config/permissions'
import SettingsViewAs from './ViewAs.vue'

interface RoleRow {
  id: number
  code: string
  name: string
  is_active: boolean
  is_default: boolean
  description: string | null
  permissions: string[]
}

interface PositionRow {
  id: number
  code: string
  name: string
  is_active: boolean
  permissions: string[]
}

interface UserRow {
  id: number
  username: string
  is_active: boolean
  roles: number[]
  permissions: string[]
}

const { t } = useI18n()
const { hasPermission } = useAuth()
const toast = useToast()

const canManagePermissions = computed(() => hasPermission('permissions.manage'))
const canUseViewAs = computed(() => hasPermission('settings.viewAs'))

const permissions = ref<PermissionDefinition[]>([])
const roles = ref<RoleRow[]>([])
const positions = ref<PositionRow[]>([])
const users = ref<UserRow[]>([])
const hasAccess = ref(true)
const savingRole = ref(false)
const savingPermissions = ref(false)
const savingUserAccess = ref(false)

const showRoleModal = ref(false)
const roleForm = ref({
  id: null as number | null,
  code: '',
  name: '',
  description: '',
  is_active: true,
  is_default: false,
  isNew: true,
})

const permissionModal = ref<null | {
  type: 'role' | 'position'
  title: string
  roleId?: number
  positionId?: number
  selected: string[]
}>(null)

const userModal = ref<null | {
  id: number
  username: string
  roles: number[]
  permissions: string[]
}>(null)

const permissionGroups = computed(() => {
  const map = new Map<string, PermissionDefinition[]>()
  for (const perm of permissions.value) {
    if (!map.has(perm.categoryKey)) map.set(perm.categoryKey, [])
    map.get(perm.categoryKey)!.push(perm)
  }
  return Array.from(map.entries()).map(([categoryKey, perms]) => ({
    categoryKey,
    categoryLabel: t(categoryKey),
    permissions: perms,
  }))
})

const activeRoleIds = computed(() => new Set(
  roles.value
    .filter(role => role.is_active)
    .map(role => role.id)
))

const roleSearchInput = ref('')
const positionSearchInput = ref('')
const userSearchInput = ref('')

const roleColumns = computed<AdvancedTableColumn<RoleRow>[]>(() => [
  {
    key: 'code',
    label: t('common.code'),
    filterable: false,
    globalSearchable: true,
    getValue: role => role.code,
  },
  {
    key: 'name',
    label: t('common.name'),
    filterable: false,
    globalSearchable: true,
    getValue: role => role.name,
    mobile: 'title',
  },
  {
    key: 'status',
    label: t('settings.permissions.roleStatus'),
    filterType: 'text',
    globalSearchable: true,
    getValue: role => roleStatusLabel(role),
    mobileLabel: true,
  },
  {
    key: 'default',
    label: t('settings.permissions.defaultRole'),
    filterable: false,
    globalSearchable: true,
    getValue: role => yesNoLabel(role.is_default),
    mobileLabel: true,
  },
  {
    key: 'description',
    label: t('common.description'),
    filterable: false,
    globalSearchable: true,
    getValue: role => role.description || '-',
    mobileLabel: true,
    mobileMinBreakpoint: 'lg',
  },
])

const positionColumns = computed<AdvancedTableColumn<PositionRow>[]>(() => [
  {
    key: 'code',
    label: t('common.code'),
    filterable: false,
    globalSearchable: true,
    getValue: position => position.code,
  },
  {
    key: 'name',
    label: t('common.name'),
    filterable: false,
    globalSearchable: true,
    getValue: position => position.name,
    mobile: 'title',
  },
  {
    key: 'status',
    label: t('settings.permissions.positionStatus'),
    filterType: 'text',
    globalSearchable: true,
    getValue: position => positionStatusLabel(position),
    mobileLabel: true,
  },
])

const userColumns = computed<AdvancedTableColumn<UserRow>[]>(() => [
  {
    key: 'username',
    label: t('settings.permissions.username'),
    filterable: false,
    globalSearchable: true,
    getValue: user => user.username,
    mobile: 'title',
  },
  {
    key: 'roles',
    label: t('settings.permissions.roles'),
    filterType: 'text',
    globalSearchable: true,
    getValue: user => roleNamesForUser(user),
    mobileLabel: true,
  },
])

function roleStatusLabel(role: RoleRow) {
  return role.is_active ? t('common.active') : t('common.inactive')
}

function positionStatusLabel(position: PositionRow) {
  return position.is_active ? t('common.active') : t('common.inactive')
}

function yesNoLabel(value: boolean) {
  return value ? t('common.yes') : t('common.no')
}

function roleNamesForUser(user: UserRow) {
  return roles.value
    .filter(role => user.roles.includes(role.id))
    .map(role => role.name)
    .join(', ') || '-'
}

function formatRoleOptionLabel(role: RoleRow) {
  const status = roleStatusLabel(role)
  return `${role.name} (${role.code}) - ${status}`
}

async function loadDefinitions() {
  const res = await apiFetch<ApiResponse<'/api/permissions/definitions'>>('/api/permissions/definitions')
  if (res.ok) {
    permissions.value = res.permissions
  } else console.log(res.error)
}

async function loadRoles() {
  const res = await apiFetch<ApiResponse<'/api/permissions/roles'>>('/api/permissions/roles')
  if (res.ok) {
    roles.value = res.roles
  } else console.log(res.error)
}

async function loadPositions() {
  const res = await apiFetch<ApiResponse<'/api/permissions/positions'>>('/api/permissions/positions')
  if (res.ok) {
    positions.value = res.positions
  } else console.log(res.error)
}

async function loadUsers() {
  const res = await apiFetch<ApiResponse<'/api/permissions/users'>>('/api/permissions/users')
  if (res.ok) {
    users.value = res.users
  } else console.log(res.error)
}

function openRoleEditor(role?: RoleRow) {
  if (role) {
    roleForm.value = {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description || '',
      is_active: role.is_active,
      is_default: role.is_default,
      isNew: false,
    }
  } else {
    roleForm.value = {
      id: null,
      code: '',
      name: '',
      description: '',
      is_active: true,
      is_default: false,
      isNew: true,
    }
  }
  showRoleModal.value = true
}

function closeRoleModal() {
  showRoleModal.value = false
}

async function saveRole() {
  if (savingRole.value) return
  const payload = {
    id: roleForm.value.id,
    code: roleForm.value.code,
    name: roleForm.value.name,
    description: roleForm.value.description || null,
    is_active: roleForm.value.is_active,
    is_default: roleForm.value.is_default,
  }
  try {
    savingRole.value = true
    const res = await apiFetch<ApiResponse<'/api/permissions/roles.save', 'post'>>('/api/permissions/roles.save', {
      method: 'POST',
      body: payload,
    })
    if (!res.ok) {
      toast.error(`${t('settings.permissions.saveFailed')}: ${res.error}`)
      return
    }
    showRoleModal.value = false
    await loadRoles()
  } finally {
    savingRole.value = false
  }
}

function openRolePermissions(role: RoleRow) {
  permissionModal.value = {
    type: 'role',
    title: `${role.name} (${role.code})`,
    roleId: role.id,
    selected: [...role.permissions],
  }
}

function openPositionPermissions(position: PositionRow) {
  permissionModal.value = {
    type: 'position',
    title: `${position.name} (${position.code})`,
    positionId: position.id,
    selected: [...position.permissions],
  }
}

async function savePermissionModal() {
  if (!permissionModal.value || savingPermissions.value) return
  const modal = permissionModal.value
  const payload = { permissions: modal.selected }
  const endpoint = modal.type === 'role'
    ? '/api/permissions/roles.set_permissions'
    : '/api/permissions/positions.set_permissions'

  const body = modal.type === 'role'
    ? { ...payload, role_id: modal.roleId }
    : { ...payload, position_id: modal.positionId }

  try {
    savingPermissions.value = true
    const res = await apiFetch<ApiResponse<'/api/permissions/roles.set_permissions', 'post'>>(endpoint, {
      method: 'POST',
      body,
    })
    if (!res.ok) {
      toast.error(`${t('settings.permissions.saveFailed')}: ${res.error}`)
      return
    }
    permissionModal.value = null
    await Promise.all([loadRoles(), loadPositions()])
  } finally {
    savingPermissions.value = false
  }
}

function openUserAccess(user: UserRow) {
  userModal.value = {
    id: user.id,
    username: user.username,
    roles: user.roles.filter(roleId => activeRoleIds.value.has(roleId)),
    permissions: [...user.permissions],
  }
}

async function saveUserAccess() {
  if (!userModal.value || savingUserAccess.value) return
  const payload = {
    user_id: userModal.value.id,
    roles: userModal.value.roles,
    permissions: userModal.value.permissions,
  }
  try {
    savingUserAccess.value = true
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/permissions/users.update', {
      method: 'POST',
      body: payload,
    })
    if (!res.ok) {
      toast.error(`${t('settings.permissions.saveFailed')}: ${res.error}`)
      return
    }
    userModal.value = null
    await loadUsers()
  } finally {
    savingUserAccess.value = false
  }
}

onMounted(async () => {
  await loadSupportData()
})

useAppRefresh().onRefresh(loadSupportData)

async function loadSupportData() {
  // Reachable with only settings.viewAs, where these endpoints would reject the request.
  if (!canManagePermissions.value) return
  await Promise.all([loadDefinitions(), loadRoles(), loadPositions(), loadUsers()])
}
</script>
