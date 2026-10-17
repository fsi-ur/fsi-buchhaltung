<template>
  <CommonPageTableCard
    :title="t('settings.apiKeys.title')"
    persist-key="settings-api-keys"
    :search-value="search"
    :can-create="true"
    :create-label="`+ ${t('settings.apiKeys.new')}`"
    @update:search-value="search = $event"
    @create="openCreate"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['api_keys']" />
    </template>

    <p class="mb-4 text-sm text-base-500">{{ t('settings.apiKeys.intro') }}</p>

    <CommonAdvancedTable
      v-model:search="search"
      :loading="loading"
      persist-key="settings-api-keys"
      :rows="apiKeys"
      :columns="columns"
      :empty-text="t('settings.apiKeys.none')"
    >
      <template #cell-keyPrefix="{ row }">
        <code class="rounded bg-base-100 px-1.5 py-0.5 text-xs text-base-700">{{ row.keyPrefix }}…</code>
      </template>

      <template #cell-status="{ row }">
        <span
          class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
          :class="row.revokedAt ? 'bg-base-100 text-base-500' : 'bg-success-100 text-success-700'"
        >
          {{ row.revokedAt ? t('settings.apiKeys.revoked') : t('settings.apiKeys.active') }}
        </span>
      </template>

      <template #actions="{ row }">
        <button
          v-if="!row.revokedAt"
          class="cursor-pointer text-danger-500 hover:underline"
          @click="revokeTarget = row"
        >
          {{ t('settings.apiKeys.revoke') }}
        </button>
      </template>
    </CommonAdvancedTable>
  </CommonPageTableCard>

  <CommonModal
    v-model="showCreate"
    :title="t('settings.apiKeys.new')"
    width-class="max-w-lg"
    @close="closeCreate"
  >
    <CommonValidationSummary v-if="createError" :errors="[createError]" :title="t('calendar.validation.summaryTitle')" />

    <div class="field">
      <label>{{ t('settings.apiKeys.name') }}</label>
      <input v-model="newName" class="input" maxlength="127" :placeholder="t('settings.apiKeys.namePlaceholder')" @keydown.enter="createKey">
    </div>

    <template #footer>
      <button class="btn-secondary" @click="closeCreate">{{ t('actions.cancel') }}</button>
      <button
        class="btn-primary"
        :disabled="saving"
        :class="{ 'cursor-not-allowed opacity-50': saving }"
        @click="createKey"
      >
        {{ t('settings.apiKeys.create') }}
      </button>
    </template>
  </CommonModal>

  <CommonModal
    :model-value="createdKey !== null"
    :title="t('settings.apiKeys.createdTitle')"
    width-class="max-w-xl"
    @update:model-value="!$event && (createdKey = null)"
    @close="createdKey = null"
  >
    <p class="text-sm text-base-600">{{ t('settings.apiKeys.createdText') }}</p>
    <div class="mt-3 flex items-center gap-2">
      <input
        type="text"
        readonly
        :value="createdKey ?? ''"
        class="input flex-1 font-mono text-xs"
        @focus="($event.target as HTMLInputElement)?.select()"
      >
      <button type="button" class="btn-secondary shrink-0 px-3!" :title="t('settings.apiKeys.copy')" @click="copyKey">
        <Icon name="material-symbols:content-copy-outline-rounded" class="text-base" />
      </button>
    </div>

    <template #footer>
      <button class="btn-primary" @click="createdKey = null">{{ t('actions.close') }}</button>
    </template>
  </CommonModal>

  <CommonModal
    :model-value="revokeTarget !== null"
    :title="t('settings.apiKeys.revokeConfirmTitle')"
    footer-class="relative z-10 mt-4 flex justify-end gap-3 bg-white pt-2"
    @update:model-value="!$event && (revokeTarget = null)"
    @close="revokeTarget = null"
  >
    <p class="text-sm text-base-600">{{ t('settings.apiKeys.revokeConfirmText', { name: revokeTarget?.name ?? '' }) }}</p>

    <template #footer>
      <button class="btn-secondary" @click="revokeTarget = null">{{ t('actions.cancel') }}</button>
      <button
        class="cursor-pointer rounded-lg bg-danger-500 px-4 py-2 text-sm text-white transition-colors hover:bg-danger-600"
        :disabled="saving"
        :class="{ 'cursor-not-allowed opacity-50': saving }"
        @click="revokeKey"
      >
        {{ t('settings.apiKeys.revoke') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import type { GetApiKeysResponse } from '~/server/api/api-keys/index.get'
import type { CreateApiKeyResponse } from '~/server/api/api-keys/create.post'
import type { RevokeApiKeyResponse } from '~/server/api/api-keys/[id]/revoke.post'
import type { ApiKey } from '~/types/apiKey'

const { t } = useI18n()
const { formatDateTime } = useLocaleFormatters()
const toast = useToast()

const apiKeys = ref<ApiKey[]>([])
const loading = ref(true)
const search = ref('')
const saving = ref(false)

const showCreate = ref(false)
const newName = ref('')
const createError = ref('')
const createdKey = ref<string | null>(null)
const revokeTarget = ref<ApiKey | null>(null)

const columns = computed<AdvancedTableColumn<ApiKey>[]>(() => ([
  {
    key: 'name',
    label: t('settings.apiKeys.name'),
    globalSearchable: true,
    getValue: row => row.name,
    mobile: 'title',
  },
  {
    key: 'keyPrefix',
    label: t('settings.apiKeys.key'),
    filterable: false,
    sortable: false,
    getValue: row => row.keyPrefix,
  },
  {
    key: 'createdAt',
    label: t('settings.apiKeys.createdAt'),
    filterable: false,
    getValue: row => row.createdAt,
    format: row => formatDateTime(row.createdAt),
    mobileLabel: true,
  },
  {
    key: 'createdBy',
    label: t('settings.apiKeys.createdBy'),
    getValue: row => row.createdBy ?? '',
  },
  {
    key: 'lastUsedAt',
    label: t('settings.apiKeys.lastUsedAt'),
    filterable: false,
    getValue: row => row.lastUsedAt ?? '',
    format: row => (row.lastUsedAt ? formatDateTime(row.lastUsedAt) : t('settings.apiKeys.never')),
    mobileLabel: true,
  },
  {
    key: 'status',
    label: t('common.status'),
    getValue: row => (row.revokedAt ? t('settings.apiKeys.revoked') : t('settings.apiKeys.active')),
    mobileLabel: true,
  },
]))

async function loadKeys() {
  try {
    const res = await $fetch<GetApiKeysResponse>('/api/api-keys')
    apiKeys.value = res.ok ? res.apiKeys : []
  } catch {
    apiKeys.value = []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  newName.value = ''
  createError.value = ''
  showCreate.value = true
}

function closeCreate() {
  showCreate.value = false
}

async function createKey() {
  if (saving.value) return
  if (!newName.value.trim()) {
    createError.value = t('settings.apiKeys.nameRequired')
    return
  }

  saving.value = true
  createError.value = ''
  try {
    const res = await $fetch<CreateApiKeyResponse>('/api/api-keys/create', {
      method: 'POST',
      body: { name: newName.value },
    })
    if (!res.ok) {
      createError.value = res.error || t('settings.apiKeys.createFailed')
      return
    }
    showCreate.value = false
    createdKey.value = res.key
    await loadKeys()
  } catch {
    createError.value = t('settings.apiKeys.createFailed')
  } finally {
    saving.value = false
  }
}

async function revokeKey() {
  const target = revokeTarget.value
  if (!target || saving.value) return

  saving.value = true
  try {
    const res = await $fetch<RevokeApiKeyResponse>(`/api/api-keys/${target.id}/revoke`, { method: 'POST' })
    if (!res.ok) {
      toast.error(res.error || t('settings.apiKeys.revokeFailed'))
      return
    }
    toast.success(t('settings.apiKeys.revokedToast'))
    revokeTarget.value = null
    await loadKeys()
  } catch {
    toast.error(t('settings.apiKeys.revokeFailed'))
  } finally {
    saving.value = false
  }
}

async function copyKey() {
  if (!createdKey.value) return
  try {
    await navigator.clipboard.writeText(createdKey.value)
    toast.success(t('settings.apiKeys.copied'))
  } catch {
    toast.error(t('settings.apiKeys.copyError'))
  }
}

onMounted(loadKeys)
useAppRefresh().onRefresh(loadKeys)
</script>
