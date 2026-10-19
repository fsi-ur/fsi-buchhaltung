<template>
  <PageSettingsEntityManager
    ref="entityManagerRef"
    :title="t('settings.entities.costCentres')"
    :singular-label="t('settings.entities.costCentre')"
    :add-label="t('settings.entities.newCostCentre')"
    :empty-label="t('settings.entities.noCostCentres')"
    persist-key="settings-cost-centres"
    list-endpoint="/api/cost_centres"
    save-endpoint="/api/cost_centres/save"
    activate-endpoint="/api/cost_centres/activate"
    response-list-key="costCentres"
    :history-tables="['cost_centres']"
    :extra-columns="tableColumns"
    :create-item="createItem"
    :map-edit-item="mapEditItem"
    :transform-items="flattenCostCentres"
    :on-error="handleError"
  >
    <template #actions="{ item, items, edit, reload }">
      <button class="text-link-600 hover:underline cursor-pointer" @click="edit()">
        {{ t('actions.edit') }}
      </button>

      <button
        class="hover:underline cursor-pointer"
        :class="item.is_active ? 'text-danger-500' : 'text-base-500'"
        @click="item.is_active ? openDeactivateModal(item, items, reload) : toggleCostCentre(item, true, false, reload)"
      >
        {{ item.is_active ? t('actions.deactivate') : t('actions.activate') }}
      </button>
    </template>

    <template #cell-name="{ item }">
      <div
        class="flex items-center gap-2"
        :style="{ paddingLeft: `${itemDepth(item) * 1.25}rem` }"
      >
        <span v-if="itemDepth(item) > 0" class="text-base-400">|-</span>
        <span>{{ item.name }}</span>
      </div>
    </template>

    <template #cell-parent="{ item, items }">
      {{ parentLabel(itemParentId(item), items) }}
    </template>

    <template #modal-fields-before-description="{ editingItem, items }">
      <div class="field">
        <label>{{ t('settings.entities.parentCostCentre') }}</label>
        <CommonSearchSelect
          v-model="parentQuery"
          :options="parentSearchOptions(editingItem, items)"
          :selected-label="selectedParentLabel(editingItem, items)"
          :placeholder="t('settings.entities.noParentCostCentre')"
          :empty-text="t('settings.entities.noCostCentres')"
          @select="selectParent($event, editingItem, items)"
          @clear-selection="clearParent(editingItem)"
        />
      </div>
    </template>
  </PageSettingsEntityManager>

  <CommonModal
    v-if="deactivateTarget"
    v-model="deactivateModalOpen"
    :title="t('settings.costCentres.deactivateConfirm.title')"
    width-class="max-w-xl"
    @close="closeDeactivateModal"
  >
    <p class="text-sm text-base-600">
      {{ t('settings.costCentres.deactivateConfirm.intro', { costCentre: `${deactivateTarget.code} - ${deactivateTarget.name}` }) }}
    </p>

    <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-200 p-3 transition-colors hover:border-base-300 hover:bg-base-50">
      <input
        v-model="removeAsParent"
        type="checkbox"
        class="checkbox"
      >
      <span class="text-sm text-base-700">
        {{ t('settings.costCentres.deactivateConfirm.removeParentAssignments') }}
      </span>
    </label>

    <div v-if="deactivateChildCostCentres.length" class="space-y-2">
      <div class="text-sm font-medium text-base-700">
        {{ t('settings.costCentres.deactivateConfirm.childCostCentresTitle') }}
      </div>
      <div class="max-h-48 overflow-y-auto rounded-lg border border-base-200 bg-base-50 p-3">
        <div
          v-for="child in deactivateChildCostCentres"
          :key="child.id"
          class="text-sm text-base-700"
        >
          {{ child.code }} - {{ child.name }}
        </div>
      </div>
    </div>

    <p v-else class="text-sm text-base-500">
      {{ t('settings.costCentres.deactivateConfirm.noChildCostCentres') }}
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
import type {
  EntityManagerColumn,
  SaveSettingsEntityBody,
  SettingsEntityRow,
} from '~/components/Page/Settings/EntityManager.vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { CostCentreRow, SaveCostCentreBody } from '~/types/costCentre'

interface CostCentreDisplayRow extends CostCentreRow {
  depth: number
}

interface ParentOption {
  id: number
  label: string
}

const { t } = useI18n()
const toast = useToast()

const entityManagerRef = ref<{ loadItems: () => Promise<void> } | null>(null)
const parentQuery = ref('')
const deactivateModalOpen = ref(false)
const deactivateTarget = ref<CostCentreRow | null>(null)
const deactivateChildCostCentres = ref<CostCentreRow[]>([])
const removeAsParent = ref(false)
const reloadAfterToggle = ref<null | (() => Promise<void>)>(null)

const tableColumns = computed<EntityManagerColumn[]>(() => [
  {
    key: 'parent',
    label: t('common.parent'),
    filterable: false,
    getValue: (item, items) => parentLabel(itemParentId(item), items),
  },
])

function sortCostCentres(left: CostCentreRow, right: CostCentreRow) {
  return left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' })
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function itemDepth(item: SettingsEntityRow) {
  return (item as CostCentreDisplayRow).depth
}

function itemParentId(item: SettingsEntityRow) {
  return (item as CostCentreRow).parent_id
}

function costCentreBody(editingItem: SaveSettingsEntityBody) {
  return editingItem as SaveCostCentreBody
}

function flattenCostCentres(source: SettingsEntityRow[]) {
  const costCentres = source as CostCentreRow[]
  const itemMap = new Map(costCentres.map(item => [item.id, item]))
  const buckets = new Map<number | null, CostCentreRow[]>()
  const sorted = [...costCentres].sort(sortCostCentres)

  for (const item of sorted) {
    const parentId = item.parent_id !== null && item.parent_id !== item.id && itemMap.has(item.parent_id)
      ? item.parent_id
      : null
    const bucket = buckets.get(parentId) ?? []
    bucket.push(item)
    buckets.set(parentId, bucket)
  }

  const ordered: CostCentreDisplayRow[] = []
  const visited = new Set<number>()

  const visit = (parentId: number | null, depth: number) => {
    const children = buckets.get(parentId) ?? []

    for (const child of children) {
      if (visited.has(child.id)) continue

      visited.add(child.id)
      ordered.push({ ...child, depth })
      visit(child.id, depth + 1)
    }
  }

  visit(null, 0)

  for (const item of sorted) {
    if (visited.has(item.id)) continue
    ordered.push({ ...item, depth: 0 })
    visit(item.id, 1)
  }

  return ordered
}

function collectDescendantIds(rootId: number, source: CostCentreRow[]) {
  const byParent = new Map<number, number[]>()

  for (const item of source) {
    if (item.parent_id === null) continue
    const bucket = byParent.get(item.parent_id) ?? []
    bucket.push(item.id)
    byParent.set(item.parent_id, bucket)
  }

  const descendants = new Set<number>()
  const stack = [...(byParent.get(rootId) ?? [])]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || descendants.has(current)) continue

    descendants.add(current)
    stack.push(...(byParent.get(current) ?? []))
  }

  return descendants
}

function parentOptions(editingItem: SaveSettingsEntityBody, items: SettingsEntityRow[]) {
  const costCentres = items as CostCentreRow[]
  const currentId = typeof costCentreBody(editingItem).id === 'number' ? costCentreBody(editingItem).id : null
  const excludedIds = currentId ? collectDescendantIds(currentId, costCentres) : new Set<number>()
  if (currentId) excludedIds.add(currentId)

  return flattenCostCentres(costCentres)
    .filter(item => !excludedIds.has(item.id))
    .map(item => ({
      id: item.id,
      label: `${'-- '.repeat(item.depth)}${item.code} - ${item.name}`,
    }))
}

function parentSearchOptions(editingItem: SaveSettingsEntityBody, items: SettingsEntityRow[]) {
  return parentOptions(editingItem, items).map<SearchSelectOption<number>>(option => ({
    key: option.id,
    label: option.label,
    value: option.id,
    searchText: option.label,
  }))
}

function parentLabel(parentId: number | null | undefined, items: SettingsEntityRow[]) {
  if (parentId === null || parentId === undefined) return t('settings.entities.noParentCostCentre')

  const parent = (items as CostCentreRow[]).find(item => item.id === parentId)
  return parent ? `${parent.code} - ${parent.name}` : t('settings.entities.noParentCostCentre')
}

function selectedParentLabel(editingItem: SaveSettingsEntityBody, items: SettingsEntityRow[]) {
  const parentId = costCentreBody(editingItem).parent_id
  return parentLabel(parentId, items) === t('settings.entities.noParentCostCentre')
    ? ''
    : parentLabel(parentId, items)
}

function createItem(): SaveCostCentreBody {
  parentQuery.value = ''
  return {
    code: '',
    name: '',
    description: '',
    parent_id: null,
  }
}

function mapEditItem(item: SettingsEntityRow): SaveCostCentreBody {
  parentQuery.value = ''
  const costCentre = item as CostCentreRow
  return {
    id: costCentre.id,
    code: costCentre.code,
    name: costCentre.name,
    description: costCentre.description,
    is_active: costCentre.is_active,
    parent_id: costCentre.parent_id,
  }
}

function selectParent(value: unknown, editingItem: SaveSettingsEntityBody, items: SettingsEntityRow[]) {
  const parentId = Number(value)
  if (!Number.isInteger(parentId) || parentId <= 0) return

  const selected = parentOptions(editingItem, items).find(option => option.id === parentId)
  costCentreBody(editingItem).parent_id = parentId
  parentQuery.value = selected?.label || ''
}

function clearParent(editingItem: SaveSettingsEntityBody) {
  costCentreBody(editingItem).parent_id = null
  parentQuery.value = ''
}

function openDeactivateModal(item: SettingsEntityRow, items: SettingsEntityRow[], reload: () => Promise<void>) {
  const costCentre = item as CostCentreRow
  deactivateTarget.value = costCentre
  deactivateChildCostCentres.value = (items as CostCentreRow[]).filter(entry => entry.parent_id === costCentre.id)
  removeAsParent.value = deactivateChildCostCentres.value.length > 0
  reloadAfterToggle.value = reload
  deactivateModalOpen.value = true
}

function closeDeactivateModal() {
  deactivateModalOpen.value = false
  deactivateTarget.value = null
  deactivateChildCostCentres.value = []
  removeAsParent.value = false
  reloadAfterToggle.value = null
}

async function toggleCostCentre(
  item: SettingsEntityRow,
  isActive: boolean,
  clearChildParents: boolean,
  reload: () => Promise<void>,
) {
  const res = await apiFetch<{ ok: boolean, error?: string }>('/api/cost_centres/activate', {
    method: 'POST',
    body: {
      id: item.id,
      is_active: isActive,
      clear_child_parent_links: clearChildParents,
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

  const ok = await toggleCostCentre(
    deactivateTarget.value,
    false,
    removeAsParent.value,
    reloadAfterToggle.value,
  )
  if (ok) closeDeactivateModal()
}

useAppRefresh().onRefresh(async () => {
  await entityManagerRef.value?.loadItems()
})

function handleError({ phase, message, error }: { phase: 'load' | 'save' | 'toggle', message?: string, error?: unknown }) {
  if (error) console.error(error)

  if (phase === 'load') {
    toast.error(message || 'Failed to load cost centres')
    return
  }

  if (phase === 'save') {
    toast.error(message || 'Failed to save cost centre')
    return
  }

  toast.error(message || 'Failed to update cost centre')
}
</script>
