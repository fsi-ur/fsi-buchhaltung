<template>
  <CommonPageTableCard
    v-if="canManage"
    :title="title"
    :persist-key="persistKey"
    :search-value="search"
    :can-create="true"
    :create-label="`+ ${addLabel}`"
    @update:search-value="search = $event"
    @create="addItem"
  >
    <template v-if="props.historyTables?.length" #actions>
      <PageAuditTableHistoryButton :tables="props.historyTables" />
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      :persist-key="persistKey"
      :rows="displayItems"
      :columns="columns"
      :empty-text="emptyLabel"
      @row-open="editItem($event)"
    >
      <template
        v-for="column in columnsWithSlot"
        :key="column.key"
        #[cellSlotName(column.key)]="{ row }"
      >
        <slot
          :name="`cell-${column.key}`"
          :item="row"
          :items="items"
          :display-items="displayItems"
        />
      </template>

      <template #actions="{ row }">
        <slot
          name="actions"
          :item="row"
          :items="items"
          :display-items="displayItems"
          :edit="() => editItem(row)"
          :toggle="() => toggleActive(row)"
          :reload="loadItems"
        >
          <button class="text-link-600 hover:underline cursor-pointer" @click="editItem(row)">
            {{ t('actions.edit') }}
          </button>

          <button
            class="hover:underline cursor-pointer"
            :class="row.is_active ? 'text-danger-500' : 'text-base-500'"
            @click="toggleActive(row)"
          >
            {{ row.is_active ? t('actions.deactivate') : t('actions.activate') }}
          </button>
        </slot>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonModal
    v-if="editingItem"
    v-model="showModal"
    :title="isNewItem ? t('settings.entities.newItem', { label: singularLabel }) : t('settings.entities.editItem', { label: singularLabel })"
    :width-class="modalWidthClass"
    @close="closeModal"
  >
    <div class="field">
      <label>{{ t('common.code') }}</label>
      <input v-model="editingItem.code" class="input" />
    </div>

    <div class="field">
      <label>{{ t('common.name') }}</label>
      <input v-model="editingItem.name" class="input" />
    </div>

    <slot
      name="modal-fields-before-description"
      :editing-item="editingItem"
      :is-new-item="isNewItem"
      :items="items"
      :display-items="displayItems"
    />

    <div v-if="showDescriptionField" class="field">
      <label>{{ t('common.description') }}</label>
      <textarea
        v-model="editingItem.description"
        rows="3"
        class="input resize-none"
      />
    </div>

    <slot
      name="modal-fields-after-description"
      :editing-item="editingItem"
      :is-new-item="isNewItem"
      :items="items"
      :display-items="displayItems"
    />

    <template #footer>
      <button class="btn-secondary" @click="closeModal">
        {{ t('actions.cancel') }}
      </button>

      <button class="btn-primary" :disabled="isSaving" :class="{ 'opacity-50 cursor-not-allowed': isSaving }" @click="saveItem">
        {{ t('actions.save') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useSlots } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { AdvancedTableColumn, TableFilterType } from '~/composables/useAdvancedTable'

export interface SettingsEntityRow {
  id: number
  code: string
  name: string
  is_active: boolean
  description?: string | null
}

export interface SaveSettingsEntityBody {
  id?: number
  code: string
  name: string
  is_active?: boolean
  description?: string | null
}

export interface EntityManagerColumn {
  key: string
  label: string
  headerClass?: string
  filterType?: TableFilterType
  sortable?: boolean
  filterable?: boolean
  globalSearchable?: boolean
  getValue?: (item: SettingsEntityRow, items: SettingsEntityRow[]) => unknown
}

interface EntityManagerErrorContext {
  phase: 'load' | 'save' | 'toggle'
  message?: string
  error?: unknown
}

const props = withDefaults(defineProps<{
  title: string
  singularLabel: string
  addLabel: string
  emptyLabel: string
  /** Unique, stable key to persist this table's sort/filter/search state across page navigation. */
  persistKey?: string
  listEndpoint: string
  saveEndpoint: string
  activateEndpoint: string
  responseListKey: string
  extraColumns?: EntityManagerColumn[]
  canManage?: boolean
  showDescriptionField?: boolean
  createItem?: () => SaveSettingsEntityBody
  mapEditItem?: (item: SettingsEntityRow) => SaveSettingsEntityBody
  transformItems?: (items: SettingsEntityRow[]) => SettingsEntityRow[]
  onError?: (context: EntityManagerErrorContext) => void
  modalWidthClass?: string
  /** Table name(s) backing this list, for the "view change log" button. Omit to hide the button. */
  historyTables?: string[]
}>(), {
  extraColumns: () => [],
  persistKey: undefined,
  canManage: true,
  showDescriptionField: true,
  createItem: () => ({
    code: '',
    name: '',
    description: '',
  }),
  mapEditItem: (item: SettingsEntityRow) => ({ ...item }),
  transformItems: (items: SettingsEntityRow[]) => items,
  onError: undefined,
  modalWidthClass: 'max-w-lg',
})

defineSlots<{
  [key: `cell-${string}`]: (props: {
    item: SettingsEntityRow
    items: SettingsEntityRow[]
    displayItems: SettingsEntityRow[]
  }) => any
  'actions'?: (props: {
    item: SettingsEntityRow
    items: SettingsEntityRow[]
    displayItems: SettingsEntityRow[]
    edit: () => void
    toggle: () => Promise<void>
    reload: () => Promise<void>
  }) => any
  'modal-fields-before-description'?: (props: {
    editingItem: SaveSettingsEntityBody
    isNewItem: boolean
    items: SettingsEntityRow[]
    displayItems: SettingsEntityRow[]
  }) => any
  'modal-fields-after-description'?: (props: {
    editingItem: SaveSettingsEntityBody
    isNewItem: boolean
    items: SettingsEntityRow[]
    displayItems: SettingsEntityRow[]
  }) => any
}>()

const slots = useSlots()
const { t } = useI18n()
const items = ref<SettingsEntityRow[]>([])
const loading = ref(true)
const displayItems = computed(() => props.transformItems(items.value))
const search = ref('')

function getFallbackColumnValue(item: SettingsEntityRow, key: string) {
  return (item as unknown as Record<string, unknown>)[key] ?? '-'
}

function cellSlotName(key: string) {
  return `cell-${key}`
}

const columns = computed<AdvancedTableColumn<SettingsEntityRow>[]>(() => [
  {
    key: 'code',
    label: t('common.code'),
    filterable: false,
    globalSearchable: true,
    getValue: item => item.code,
  },
  {
    key: 'name',
    label: t('common.name'),
    filterable: false,
    globalSearchable: true,
    getValue: item => item.name,
    mobile: 'title',
  },
  ...props.extraColumns.map(column => ({
    key: column.key,
    label: column.label,
    headerClass: column.headerClass,
    filterType: column.filterType || ('text' as const),
    sortable: column.sortable,
    filterable: column.filterable,
    globalSearchable: column.globalSearchable ?? true,
    getValue: (item: SettingsEntityRow) => column.getValue?.(item, items.value) ?? getFallbackColumnValue(item, column.key),
    mobileLabel: true,
  })),
])

const columnsWithSlot = computed(() => columns.value.filter(column => !!slots[cellSlotName(column.key)]))

const showModal = ref(false)
const editingItem = ref<SaveSettingsEntityBody | null>(null)
const isNewItem = ref(false)
const isSaving = ref(false)

function reportError(phase: EntityManagerErrorContext['phase'], message?: string, error?: unknown) {
  if (props.onError) {
    props.onError({ phase, message, error })
    return
  }

  if (error) {
    console.error(error)
    return
  }

  if (message) {
    console.error(message)
  }
}

async function loadItems() {
  try {
    const res = await apiFetch<Record<string, any>>(props.listEndpoint)
    if (res.ok) {
      items.value = (res[props.responseListKey] ?? []) as SettingsEntityRow[]
      return
    }

    reportError('load', res.error)
  } catch (error) {
    reportError('load', undefined, error)
  } finally {
    loading.value = false
  }
}

function addItem() {
  editingItem.value = props.createItem()
  isNewItem.value = true
  showModal.value = true
}

function editItem(item: SettingsEntityRow) {
  editingItem.value = props.mapEditItem(item)
  isNewItem.value = false
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingItem.value = null
}

async function saveItem() {
  if (!editingItem.value || isSaving.value) return

  try {
    isSaving.value = true
    const res = await apiFetch<{ ok: boolean, error?: string }>(props.saveEndpoint, {
      method: 'POST',
      body: editingItem.value,
    })
    if (!res.ok) {
      reportError('save', res.error)
      return
    }

    closeModal()
    await loadItems()
  } catch (error) {
    reportError('save', undefined, error)
  } finally {
    isSaving.value = false
  }
}

async function toggleActive(item: SettingsEntityRow) {
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>(props.activateEndpoint, {
      method: 'POST',
      body: { id: item.id, is_active: !item.is_active },
    })
    if (!res.ok) {
      reportError('toggle', res.error)
      return
    }

    await loadItems()
  } catch (error) {
    reportError('toggle', undefined, error)
  }
}

watch(() => props.canManage, async (canManage) => {
  if (!canManage) {
    items.value = []
    loading.value = false
    closeModal()
    return
  }

  await loadItems()
}, { immediate: true })

defineExpose({
  loadItems,
})
</script>
