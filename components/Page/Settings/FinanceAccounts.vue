<template>
  <CommonPageTableCard
    :title="t('settings.financeAccounts.title')"
    persist-key="settings-finance-accounts"
    :search-value="search"
    :can-create="true"
    :create-label="`+ ${t('settings.financeAccounts.new')}`"
    @update:search-value="search = $event"
    @create="addItem"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['finance_accounts']" />
    </template>

    <p class="mb-3 text-sm text-base-500">
      {{ t('settings.financeAccounts.intro') }}
    </p>
    <p
      v-if="!loading && !items.some(item => !item.archived)"
      class="mb-3 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800"
    >
      {{ t('settings.financeAccounts.noActiveAccount') }}
    </p>

    <CommonAdvancedTable
      v-model:search="search"
      :loading="loading"
      persist-key="settings-finance-accounts"
      :rows="items"
      :columns="columns"
      :empty-text="t('settings.financeAccounts.none')"
      @row-open="editItem($event)"
    >
      <template #cell-name="{ row }">
        <span class="inline-flex items-center gap-2">
          <span class="font-medium">{{ row.name }}</span>
          <span
            v-if="row.is_default"
            class="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-700"
          >{{ t('settings.financeAccounts.default') }}</span>
        </span>
      </template>

      <template #actions="{ row }">
        <button class="cursor-pointer text-link-600 hover:underline" @click="editItem(row)">
          {{ t('actions.edit') }}
        </button>
        <button
          v-if="!row.is_default && !row.archived && row.iban"
          class="cursor-pointer text-link-600 hover:underline"
          @click="saveFlags(row, { is_default: true })"
        >
          {{ t('settings.financeAccounts.makeDefault') }}
        </button>
        <button
          v-if="row.archived || canArchive(row)"
          class="cursor-pointer hover:underline"
          :class="row.archived ? 'text-base-500' : 'text-danger-500'"
          @click="row.archived ? saveFlags(row, { archived: false }) : askArchive(row)"
        >
          {{ row.archived ? t('settings.financeAccounts.unarchive') : t('settings.financeAccounts.archive') }}
        </button>
        <button
          v-if="!row.in_use"
          class="cursor-pointer text-danger-500 hover:underline"
          @click="askDelete(row)"
        >
          {{ t('actions.delete') }}
        </button>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonModal
    v-if="editingItem"
    v-model="showModal"
    :title="isNewItem ? t('settings.financeAccounts.new') : t('settings.financeAccounts.edit')"
    width-class="max-w-lg"
    @close="closeModal"
  >
    <CommonValidationSummary v-if="error" :errors="[error]" :title="t('common.validationBlocked')" />

    <div class="field">
      <label>{{ t('settings.financeAccounts.type') }}</label>
      <CommonSegmentedControl
        v-model="editingItem.account_type"
        :options="[
          { value: 'bank', label: t('settings.financeAccounts.types.bank') },
          { value: 'other', label: t('settings.financeAccounts.types.other') },
        ]"
      />
    </div>

    <div class="field">
      <label>{{ t('common.name') }}</label>
      <input v-model="editingItem.name" class="input" :placeholder="t('settings.financeAccounts.namePlaceholder')" />
    </div>

    <div class="field">
      <label>{{ t('reimbursement.accountHolder') }}</label>
      <input v-model="editingItem.account_holder" class="input" />
    </div>

    <template v-if="editingItem.account_type === 'bank'">
      <div class="field">
        <label>{{ t('settings.financeAccounts.iban') }}</label>
        <input v-model="editingItem.iban" class="input font-mono" autocomplete="off" />
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="field">
          <label>{{ t('settings.financeAccounts.bic') }}</label>
          <input v-model="editingItem.bic" class="input font-mono" autocomplete="off" />
        </div>
        <div class="field">
          <label>{{ t('reimbursement.bankname') }}</label>
          <input v-model="editingItem.bankname" class="input" />
        </div>
      </div>
    </template>
    <div v-else class="field">
      <label>{{ t('settings.financeAccounts.identifier') }}</label>
      <input v-model="editingItem.identifier" class="input" :placeholder="t('settings.financeAccounts.identifierPlaceholder')" />
    </div>

    <div class="field">
      <label>{{ t('settings.financeAccounts.notes') }}</label>
      <textarea v-model="editingItem.notes" rows="2" class="input resize-none" />
    </div>

    <label
      v-if="editingItem.account_type === 'bank' && !editingItem.archived"
      class="flex items-center gap-3 text-sm text-base-700"
      :class="currentIsDefault ? '' : 'cursor-pointer'"
    >
      <CommonToggleSwitch
        v-model="editingItem.is_default"
        :label="t('settings.financeAccounts.isDefault')"
        :disabled="currentIsDefault"
      />
      {{ t('settings.financeAccounts.isDefault') }}
    </label>
    <p v-if="currentIsDefault" class="text-xs text-base-500">{{ t('settings.financeAccounts.defaultHint') }}</p>

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

  <CommonModal
    v-if="confirming"
    :model-value="Boolean(confirming)"
    :title="confirming.title"
    width-class="max-w-md"
    @update:model-value="!$event && (confirming = null)"
    @close="confirming = null"
  >
    <p class="text-sm text-base-800">{{ confirming.message }}</p>
    <p v-if="confirming.hint" class="mt-2 text-xs text-base-500">{{ confirming.hint }}</p>

    <template #footer>
      <button class="btn-secondary" @click="confirming = null">{{ t('actions.cancel') }}</button>
      <button
        class="btn-primary"
        :disabled="confirmBusy"
        :class="{ 'cursor-not-allowed opacity-50': confirmBusy }"
        @click="runConfirmed"
      >
        {{ confirming.actionLabel }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useFinanceAccounts } from '~/composables/useFinanceAccounts'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import type { GetFinanceAccountsResponse } from '~/server/api/settings/finance-accounts.get'
import type { FinanceAccountSettingsRow, SaveFinanceAccountBody } from '~/types/financeAccount'

const { t } = useI18n()
const toast = useToast()
const financeAccounts = useFinanceAccounts()

const items = ref<FinanceAccountSettingsRow[]>([])
const loading = ref(true)
const search = ref('')

const showModal = ref(false)
const isNewItem = ref(false)
const isSaving = ref(false)
const error = ref('')
const editingItem = ref<SaveFinanceAccountBody | null>(null)
/** The edited account is the default: it cannot be switched off here, only replaced by another. */
const currentIsDefault = computed(() => Boolean(editingItem.value?.id && items.value.find(item => item.id === editingItem.value?.id)?.is_default))

function formatIban(iban: string | null) {
  return iban ? iban.replace(/(.{4})/g, '$1 ').trim() : ''
}

const columns = computed<AdvancedTableColumn<FinanceAccountSettingsRow>[]>(() => ([
  {
    key: 'name',
    label: t('common.name'),
    globalSearchable: true,
    getValue: row => row.name,
    mobile: 'title',
  },
  {
    key: 'account_type',
    label: t('settings.financeAccounts.type'),
    getValue: row => t(`settings.financeAccounts.types.${row.account_type}`),
    mobileLabel: true,
  },
  {
    key: 'details',
    label: t('settings.financeAccounts.details'),
    globalSearchable: true,
    getValue: row => row.account_type === 'bank'
      ? [formatIban(row.iban), row.bankname].filter(Boolean).join(' · ')
      : (row.identifier ?? ''),
    mobileLabel: true,
  },
  {
    key: 'status',
    label: t('common.status'),
    getValue: row => row.archived ? t('settings.financeAccounts.archived') : t('common.active'),
    mobileLabel: true,
  },
]))

async function loadItems() {
  try {
    const res = await apiFetch<GetFinanceAccountsResponse>('/api/settings/finance-accounts')
    items.value = res.ok ? res.accounts : []
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

/** Reloads the list and the app-wide account state (tabs, dropdowns depend on it). */
async function reloadAll() {
  await Promise.all([loadItems(), financeAccounts.refresh()])
}

function toBody(item: FinanceAccountSettingsRow): SaveFinanceAccountBody {
  return {
    id: item.id,
    name: item.name,
    account_type: item.account_type,
    account_holder: item.account_holder,
    iban: item.iban,
    bic: item.bic,
    bankname: item.bankname,
    identifier: item.identifier,
    notes: item.notes,
    is_default: item.is_default,
    archived: item.archived,
  }
}

function addItem() {
  editingItem.value = {
    name: '',
    account_type: 'bank',
    account_holder: null,
    iban: null,
    bic: null,
    bankname: null,
    identifier: null,
    notes: null,
    // The first account with an IBAN becomes the default anyway.
    is_default: !items.value.some(item => item.is_default),
    archived: false,
  }
  isNewItem.value = true
  error.value = ''
  showModal.value = true
}

function editItem(item: FinanceAccountSettingsRow) {
  editingItem.value = toBody(item)
  isNewItem.value = false
  error.value = ''
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  editingItem.value = null
}

async function save(body: SaveFinanceAccountBody) {
  const res = await apiFetch<{ ok: boolean, error?: string }>('/api/settings/finance-accounts.save', {
    method: 'POST',
    body: {
      ...body,
      // Only a bank account with an IBAN can be the default; the server enforces the same.
      is_default: body.is_default && body.account_type === 'bank' && Boolean(body.iban?.trim()),
    },
  })
  return res
}

async function saveItem() {
  if (!editingItem.value || isSaving.value) return
  isSaving.value = true
  error.value = ''
  try {
    const res = await save(editingItem.value)
    if (!res.ok) {
      error.value = res.error || t('settings.financeAccounts.saveFailed')
      return
    }
    closeModal()
    await reloadAll()
  } catch (err: any) {
    error.value = String(err)
  } finally {
    isSaving.value = false
  }
}

async function saveFlags(item: FinanceAccountSettingsRow, flags: Partial<Pick<SaveFinanceAccountBody, 'is_default' | 'archived'>>) {
  try {
    const res = await save({ ...toBody(item), ...flags })
    if (!res.ok) {
      toast.error(res.error || t('settings.financeAccounts.saveFailed'))
      return
    }
    await reloadAll()
  } catch (err: any) {
    toast.error(String(err))
  }
}

interface PendingConfirmation {
  title: string
  message: string
  hint?: string
  actionLabel: string
  run: () => Promise<void>
}

const confirming = ref<PendingConfirmation | null>(null)
const confirmBusy = ref(false)

async function runConfirmed() {
  if (!confirming.value || confirmBusy.value) return
  confirmBusy.value = true
  try {
    await confirming.value.run()
    confirming.value = null
  } finally {
    confirmBusy.value = false
  }
}

/**
 * The default can only be archived when no other active account with an IBAN could take over —
 * otherwise another account has to become the default first.
 */
function canArchive(item: FinanceAccountSettingsRow) {
  if (item.archived) return false
  if (!item.is_default) return true
  return !items.value.some(other => other.id !== item.id && !other.archived && other.iban)
}

function askArchive(item: FinanceAccountSettingsRow) {
  const isLastActive = !items.value.some(other => other.id !== item.id && !other.archived)
  if (!isLastActive) {
    void saveFlags(item, { archived: true })
    return
  }
  // Archiving the last active account switches every bank feature off — ask first.
  confirming.value = {
    title: t('settings.financeAccounts.archiveLastTitle'),
    message: t('settings.financeAccounts.archiveLastConfirm', { name: item.name }),
    hint: t('settings.financeAccounts.archiveLastHint'),
    actionLabel: t('settings.financeAccounts.archive'),
    run: () => saveFlags(item, { archived: true, is_default: false }),
  }
}

function askDelete(item: FinanceAccountSettingsRow) {
  confirming.value = {
    title: t('settings.financeAccounts.deleteTitle'),
    message: t('settings.financeAccounts.deleteConfirm', { name: item.name }),
    actionLabel: t('actions.delete'),
    run: () => deleteItem(item),
  }
}

async function deleteItem(item: FinanceAccountSettingsRow) {
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/settings/finance-accounts.delete', {
      method: 'POST',
      body: { id: item.id },
    })
    if (!res.ok) {
      toast.error(res.error || t('settings.financeAccounts.deleteFailed'))
      return
    }
    await reloadAll()
  } catch (err: any) {
    toast.error(String(err))
  }
}

onMounted(loadItems)
useAppRefresh().onRefresh(loadItems)
</script>
