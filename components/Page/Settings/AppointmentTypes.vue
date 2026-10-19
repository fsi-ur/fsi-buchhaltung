<template>
  <CommonPageTableCard
    :title="t('settings.entities.appointmentTypes')"
    persist-key="settings-appointment-types"
    :search-value="search"
    :can-create="true"
    :create-label="`+ ${t('settings.entities.newAppointmentType')}`"
    @update:search-value="search = $event"
    @create="addItem"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['appointment_types']" />
    </template>

    <CommonAdvancedTable
      v-model:search="search"
      :loading="loading"
      persist-key="settings-appointment-types"
      :rows="items"
      :columns="columns"
      :empty-text="t('settings.entities.noAppointmentTypes')"
      @row-open="editItem($event)"
    >
      <template #cell-color="{ row }">
        <span class="inline-flex items-center gap-2">
          <span class="h-4 w-4 rounded-full border border-base-200" :style="{ backgroundColor: row.color }" />
          <span class="tabular-nums text-xs text-base-500">{{ row.color }}</span>
        </span>
      </template>

      <template #cell-icon="{ row }">
        <Icon v-if="row.icon" :name="row.icon" class="text-lg text-base-600" />
        <span v-else class="text-base-400">-</span>
      </template>

      <template #actions="{ row }">
        <button class="cursor-pointer text-link-600 hover:underline" @click="editItem(row)">
          {{ t('actions.edit') }}
        </button>

        <button
          class="cursor-pointer hover:underline"
          :class="row.is_active ? 'text-danger-500' : 'text-base-500'"
          @click="toggleActive(row)"
        >
          {{ row.is_active ? t('actions.deactivate') : t('actions.activate') }}
        </button>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonModal
    v-if="editingItem"
    v-model="showModal"
    :title="isNewItem
      ? t('settings.entities.newItem', { label: t('settings.entities.appointmentType') })
      : t('settings.entities.editItem', { label: t('settings.entities.appointmentType') })"
    width-class="max-w-lg"
    @close="closeModal"
  >
    <CommonValidationSummary v-if="error" :errors="[error]" :title="t('calendar.validation.summaryTitle')" />

    <div class="field">
      <label>{{ t('common.name') }}</label>
      <input v-model="editingItem.name" class="input" />
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div class="field">
        <label>{{ t('settings.entities.color') }}</label>
        <div class="flex items-center gap-2">
          <input v-model="editingItem.color" type="color" class="h-9 w-12 cursor-pointer rounded border border-base-200" />
          <input v-model="editingItem.color" class="input flex-1" placeholder="#3b82f6" />
        </div>
      </div>

      <div class="field">
        <label>{{ t('settings.entities.sortOrder') }}</label>
        <input v-model.number="editingItem.sort_order" type="number" min="0" max="65535" class="input" />
      </div>
    </div>

    <div class="field">
      <label>{{ t('settings.entities.icon') }}</label>
      <div class="flex items-center gap-2">
        <Icon v-if="editingItem.icon" :name="editingItem.icon" class="shrink-0 text-xl text-base-600" />
        <input v-model="editingItem.icon" class="input flex-1" placeholder="material-symbols:groups-rounded" />
      </div>
    </div>

    <div class="field">
      <label>{{ t('common.description') }}</label>
      <textarea v-model="editingItem.description" rows="3" class="input resize-none" />
    </div>

    <template #footer>
      <button class="btn-secondary" @click="closeModal">{{ t('actions.cancel') }}</button>
      <button
        class="btn-primary"
        :disabled="isSaving"
        :class="{ 'cursor-not-allowed opacity-50': isSaving }"
        @click="saveItem"
      >
        {{ t('actions.save') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import type { GetAppointmentTypesResponse } from '~/server/api/appointment-types/index.get'
import type { AppointmentTypeRow, SaveAppointmentTypeBody } from '~/types/appointment'

const { t } = useI18n()
const toast = useToast()

const items = ref<AppointmentTypeRow[]>([])
const loading = ref(true)
const search = ref('')

const showModal = ref(false)
const isNewItem = ref(false)
const isSaving = ref(false)
const error = ref('')
const editingItem = ref<SaveAppointmentTypeBody | null>(null)

const columns = computed<AdvancedTableColumn<AppointmentTypeRow>[]>(() => ([
  {
    key: 'name',
    label: t('common.name'),
    globalSearchable: true,
    getValue: row => row.name,
    mobile: 'title',
  },
  {
    key: 'color',
    label: t('settings.entities.color'),
    filterable: false,
    getValue: row => row.color,
  },
  {
    key: 'icon',
    label: t('settings.entities.icon'),
    filterable: false,
    sortable: false,
    getValue: row => row.icon ?? '',
  },
  {
    key: 'sort_order',
    label: t('settings.entities.sortOrder'),
    filterType: 'number',
    getValue: row => row.sort_order,
    mobileLabel: true,
  },
  {
    key: 'is_active',
    label: t('common.status'),
    getValue: row => (row.is_active ? t('common.active') : t('common.inactive')),
    mobileLabel: true,
  },
]))

async function loadItems() {
  try {
    const res = await apiFetch<GetAppointmentTypesResponse>('/api/appointment-types')
    items.value = res.ok ? res.appointmentTypes : []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

function addItem() {
  editingItem.value = { name: '', color: '#3b82f6', icon: null, sort_order: nextSortOrder(), description: null }
  isNewItem.value = true
  error.value = ''
  showModal.value = true
}

function editItem(item: AppointmentTypeRow) {
  editingItem.value = {
    id: item.id,
    name: item.name,
    color: item.color,
    icon: item.icon,
    sort_order: item.sort_order,
    description: item.description,
  }
  isNewItem.value = false
  error.value = ''
  showModal.value = true
}

/** New types land at the end of the list rather than sharing position 0 with everything else. */
function nextSortOrder() {
  return items.value.reduce((max, item) => Math.max(max, item.sort_order), 0) + 10
}

function closeModal() {
  showModal.value = false
  editingItem.value = null
}

async function saveItem() {
  if (!editingItem.value || isSaving.value) return

  isSaving.value = true
  error.value = ''

  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/appointment-types/save', {
      method: 'POST',
      body: editingItem.value,
    })

    if (!res.ok) {
      error.value = res.error || ''
      return
    }

    closeModal()
    await loadItems()
  } catch (err: any) {
    error.value = String(err)
  } finally {
    isSaving.value = false
  }
}

async function toggleActive(item: AppointmentTypeRow) {
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/appointment-types/activate', {
      method: 'POST',
      body: { id: item.id, is_active: !item.is_active },
    })

    if (!res.ok) {
      toast.error(res.error || '')
      return
    }

    await loadItems()
  } catch (err: any) {
    toast.error(String(err))
  }
}

onMounted(loadItems)
useAppRefresh().onRefresh(loadItems)
</script>
