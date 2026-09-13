<template>
  <CommonCard
    :title="t('settings.viewAs.title')"
    :description="t('settings.viewAs.intro')"
    icon="material-symbols:visibility-outline-rounded"
    :tone="isActive ? 'warning' : 'default'"
  >
    <!-- Active simulation state -->
    <div v-if="isActive" class="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-warning-300 bg-warning-100/70 p-3">
      <div class="flex min-w-0 items-start gap-2.5">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-200 text-warning-800">
          <Icon name="material-symbols:visibility-outline-rounded" class="h-5 w-5" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-warning-900">{{ t('settings.viewAs.activeTitle') }}</p>
          <div class="mt-1 flex flex-wrap gap-1">
            <span
              v-for="label in activeLabels"
              :key="label"
              class="inline-flex items-center rounded-md bg-white/80 px-2 py-0.5 text-xs font-medium text-warning-900"
            >{{ label }}</span>
          </div>
        </div>
      </div>
      <button class="btn-secondary inline-flex shrink-0 items-center gap-1.5" @click="handleStop">
        <Icon name="material-symbols:visibility-off-outline-rounded" class="text-base" aria-hidden="true" />
        {{ t('settings.viewAs.stopButton') }}
      </button>
    </div>

    <p class="flex items-start gap-1.5 text-xs text-base-500">
      <Icon name="material-symbols:lock-outline" class="mt-px shrink-0 text-sm" aria-hidden="true" />
      {{ t('settings.viewAs.eligibilityHint') }}
    </p>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <!-- Selection -->
      <div class="min-w-0 space-y-5">
        <section>
          <div class="mb-2 flex items-center gap-2">
            <Icon name="material-symbols:badge-rounded" class="text-base text-base-400" aria-hidden="true" />
            <h4 class="text-sm font-semibold text-base-800">{{ t('settings.viewAs.rolesLabel') }}</h4>
            <span v-if="selectedRoleIds.length" class="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-700">
              {{ selectedRoleIds.length }}
            </span>
          </div>
          <p v-if="!roles.length" class="text-sm text-base-400">{{ t('settings.viewAs.noRoles') }}</p>
          <div v-else class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="role in roles"
              :key="role.id"
              type="button"
              :disabled="!roleEligible(role)"
              :title="roleEligible(role) ? undefined : t('settings.viewAs.notEligible')"
              :class="tileClass(selectedRoleIds.includes(role.id), roleEligible(role))"
              @click="toggle(selectedRoleIds, role.id)"
            >
              <span :class="markerClass(selectedRoleIds.includes(role.id), roleEligible(role))">
                <Icon v-if="selectedRoleIds.includes(role.id)" name="material-symbols:check-rounded" class="text-sm" aria-hidden="true" />
                <Icon v-else-if="!roleEligible(role)" name="material-symbols:lock-outline" class="text-xs" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-base-800">{{ role.name }}</span>
                <span class="block truncate text-xs text-base-500">
                  {{ role.code }} · {{ t('settings.viewAs.permissionCount', { count: role.permissions.length }) }}
                </span>
              </span>
            </button>
          </div>
        </section>

        <section>
          <div class="mb-2 flex items-center gap-2">
            <Icon name="material-symbols:group-rounded" class="text-base text-base-400" aria-hidden="true" />
            <h4 class="text-sm font-semibold text-base-800">{{ t('settings.viewAs.positionsLabel') }}</h4>
            <span v-if="selectedPositionIds.length" class="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-700">
              {{ selectedPositionIds.length }}
            </span>
          </div>
          <p v-if="!positions.length" class="text-sm text-base-400">{{ t('settings.viewAs.noPositions') }}</p>
          <div v-else class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="position in positions"
              :key="position.id"
              type="button"
              :disabled="!positionEligible(position)"
              :title="positionEligible(position) ? undefined : t('settings.viewAs.notEligible')"
              :class="tileClass(selectedPositionIds.includes(position.id), positionEligible(position))"
              @click="toggle(selectedPositionIds, position.id)"
            >
              <span :class="markerClass(selectedPositionIds.includes(position.id), positionEligible(position))">
                <Icon v-if="selectedPositionIds.includes(position.id)" name="material-symbols:check-rounded" class="text-sm" aria-hidden="true" />
                <Icon v-else-if="!positionEligible(position)" name="material-symbols:lock-outline" class="text-xs" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-base-800">{{ position.name }}</span>
                <span class="block truncate text-xs text-base-500">
                  {{ position.code }} · {{ t('settings.viewAs.permissionCount', { count: position.permissions.length }) }}
                </span>
              </span>
            </button>
          </div>
        </section>

        <!-- Individual permissions (collapsed by default: long list, optional refinement) -->
        <section class="overflow-hidden rounded-lg border border-base-200">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 p-3 text-left transition-colors hover:bg-base-50"
            @click="showCustom = !showCustom"
          >
            <Icon name="material-symbols:tune-rounded" class="text-base text-base-400" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-base-800">{{ t('settings.viewAs.customPermissionsLabel') }}</span>
              <span class="block text-xs text-base-500">{{ t('settings.viewAs.customPermissionsHint') }}</span>
            </span>
            <span v-if="selectedCustomPermissions.length" class="shrink-0 rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-700">
              {{ selectedCustomPermissions.length }}
            </span>
            <Icon
              :name="showCustom ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
              class="shrink-0 text-lg text-base-400"
              aria-hidden="true"
            />
          </button>

          <div v-if="showCustom" class="scroll-panel max-h-80 overflow-y-auto border-t border-base-200 p-3">
            <div class="grid gap-4 sm:grid-cols-2">
              <div v-for="group in customPermissionGroups" :key="group.categoryKey">
                <div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-base-400">{{ group.categoryLabel }}</div>
                <div class="grid gap-1">
                  <label
                    v-for="perm in group.permissions"
                    :key="perm.key"
                    class="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors"
                    :class="ownedPermissions.has(perm.key) ? 'cursor-pointer text-base-700 hover:bg-base-50' : 'cursor-not-allowed text-base-300'"
                    :title="ownedPermissions.has(perm.key) ? undefined : t('settings.viewAs.notEligible')"
                  >
                    <input
                      type="checkbox"
                      class="checkbox"
                      :value="perm.key"
                      :disabled="!ownedPermissions.has(perm.key)"
                      v-model="selectedCustomPermissions"
                    />
                    <span class="min-w-0 truncate">{{ t(perm.labelKey) }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- Live preview of the resulting permission set -->
      <aside class="lg:sticky lg:top-6 lg:self-start">
        <div class="rounded-xl border border-base-200 bg-base-50/70 p-4">
          <div class="flex items-baseline justify-between gap-2">
            <h4 class="text-sm font-semibold text-base-800">{{ t('settings.viewAs.previewTitle') }}</h4>
            <span class="text-2xl font-semibold tabular-nums text-base-900">{{ effectivePermissions.length }}</span>
          </div>
          <p class="mt-0.5 text-xs text-base-500">{{ t('settings.viewAs.impliedHint') }}</p>

          <p v-if="!previewGroups.length" class="mt-3 text-sm text-base-400">{{ t('settings.viewAs.previewEmpty') }}</p>
          <div v-else class="scroll-panel mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
            <div v-for="group in previewGroups" :key="group.categoryKey">
              <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-base-400">{{ group.categoryLabel }}</div>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="perm in group.permissions"
                  :key="perm.key"
                  class="inline-flex items-center rounded-md border border-base-200 bg-white px-1.5 py-0.5 text-xs text-base-700"
                >{{ t(perm.labelKey) }}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Actions -->
    <div class="flex flex-wrap items-center gap-3 border-t border-base-200 pt-4">
      <button
        class="btn-primary inline-flex items-center gap-1.5"
        :disabled="!hasSelection"
        :class="{ 'opacity-50 cursor-not-allowed': !hasSelection }"
        @click="applySimulation"
      >
        <Icon name="material-symbols:play-arrow-rounded" class="text-base" aria-hidden="true" />
        {{ isActive ? t('settings.viewAs.updateButton') : t('settings.viewAs.startButton') }}
      </button>
      <button
        v-if="hasSelection"
        type="button"
        class="cursor-pointer text-sm text-base-500 transition-colors hover:text-base-800"
        @click="resetSelection"
      >
        {{ t('settings.viewAs.resetSelection') }}
      </button>
      <p v-if="!hasSelection" class="text-sm text-base-500">{{ t('settings.viewAs.noneSelected') }}</p>
    </div>
  </CommonCard>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useAppRefresh } from '~/composables/useAppRefresh'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { expandPermissions, useViewAsSimulation } from '~/composables/useViewAsSimulation'
import type { PermissionDefinition, PermissionKey } from '~/config/permissions'

interface OptionRow {
  id: number
  code: string
  name: string
  permissions: string[]
}

const { t } = useI18n()
const { user } = useAuth()
const { simulation, isActive, start, stop } = useViewAsSimulation()
const { refreshCurrentPage } = useAppRefresh()

const permissions = ref<PermissionDefinition[]>([])
const roles = ref<OptionRow[]>([])
const positions = ref<OptionRow[]>([])
const selectedRoleIds = ref<number[]>([])
const selectedPositionIds = ref<number[]>([])
const selectedCustomPermissions = ref<PermissionKey[]>([])
const showCustom = ref(false)

// A role/position can only be simulated if it doesn't grant anything beyond what you
// actually have yourself — otherwise "View As" could be used to preview access you don't hold.
const ownedPermissions = computed(() => new Set<string>(user.value?.permissions ?? []))

function roleEligible(role: OptionRow) {
  return role.permissions.every(p => ownedPermissions.value.has(p))
}

function positionEligible(position: OptionRow) {
  return position.permissions.every(p => ownedPermissions.value.has(p))
}

function toggle(list: number[], id: number) {
  const index = list.indexOf(id)
  if (index === -1) list.push(id)
  else list.splice(index, 1)
}

function tileClass(selected: boolean, eligible: boolean) {
  const base = 'flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors'
  if (!eligible) return `${base} cursor-not-allowed border-base-200 bg-base-50 opacity-60`
  if (selected) return `${base} cursor-pointer border-accent-500 bg-accent-50`
  return `${base} cursor-pointer border-base-200 bg-white hover:border-accent-300 hover:bg-accent-50/40`
}

function markerClass(selected: boolean, eligible: boolean) {
  const base = 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border'
  if (!eligible) return `${base} border-base-200 bg-base-100 text-base-400`
  if (selected) return `${base} border-accent-500 bg-accent-500 text-white`
  return `${base} border-base-300 bg-white`
}

const hasSelection = computed(() => selectedRoleIds.value.length > 0 || selectedPositionIds.value.length > 0 || selectedCustomPermissions.value.length > 0)

const activeLabels = computed(() => {
  const labels = [...(simulation.value?.roleNames ?? []), ...(simulation.value?.positionNames ?? [])]
  const customCount = simulation.value?.customPermissions.length ?? 0
  if (customCount) labels.push(t('settings.viewAs.customPermissionsCount', { count: customCount }))
  return labels
})

const customPermissionGroups = computed(() => groupByCategory(permissions.value))

// Mirrors what start() will actually apply: raw selection, expanded via the implied map,
// then clamped to what the real user holds — so the preview is what you get.
const effectivePermissions = computed(() => {
  const selected = new Set<string>()
  roles.value.filter(r => selectedRoleIds.value.includes(r.id)).forEach(r => r.permissions.forEach(p => selected.add(p)))
  positions.value.filter(p => selectedPositionIds.value.includes(p.id)).forEach(p => p.permissions.forEach(pk => selected.add(pk)))
  selectedCustomPermissions.value.forEach(p => selected.add(p))
  return expandPermissions(Array.from(selected)).filter(p => ownedPermissions.value.has(p))
})

const previewGroups = computed(() => {
  const granted = new Set<string>(effectivePermissions.value)
  return groupByCategory(permissions.value.filter(perm => granted.has(perm.key)))
})

function groupByCategory(defs: PermissionDefinition[]) {
  const map = new Map<string, PermissionDefinition[]>()
  for (const perm of defs) {
    if (!map.has(perm.categoryKey)) map.set(perm.categoryKey, [])
    map.get(perm.categoryKey)!.push(perm)
  }
  return Array.from(map.entries()).map(([categoryKey, perms]) => ({
    categoryKey,
    categoryLabel: t(categoryKey),
    permissions: perms,
  }))
}

async function loadDefinitions() {
  const res = await $fetch('/api/permissions/definitions')
  if (res.ok) permissions.value = res.permissions
}

async function loadOptions() {
  const res = await $fetch('/api/permissions/view-as-options')
  if (res.ok) {
    roles.value = res.roles
    positions.value = res.positions
  }
}

function resetSelection() {
  selectedRoleIds.value = []
  selectedPositionIds.value = []
  selectedCustomPermissions.value = []
}

function applySimulation() {
  if (!hasSelection.value) return
  start({
    roles: roles.value.filter(r => selectedRoleIds.value.includes(r.id) && roleEligible(r)),
    positions: positions.value.filter(p => selectedPositionIds.value.includes(p.id) && positionEligible(p)),
    customPermissions: selectedCustomPermissions.value.filter(p => ownedPermissions.value.has(p)),
  })
  refreshCurrentPage()
}

function handleStop() {
  stop()
  refreshCurrentPage()
}

onMounted(async () => {
  await Promise.all([loadDefinitions(), loadOptions()])
  if (simulation.value) {
    selectedRoleIds.value = simulation.value.roleIds.filter(id => roles.value.some(r => r.id === id && roleEligible(r)))
    selectedPositionIds.value = simulation.value.positionIds.filter(id => positions.value.some(p => p.id === id && positionEligible(p)))
    selectedCustomPermissions.value = [...simulation.value.customPermissions]
    showCustom.value = selectedCustomPermissions.value.length > 0
  }
})

useAppRefresh().onRefresh(async () => { await Promise.all([loadDefinitions(), loadOptions()]) })
</script>
