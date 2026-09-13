<template>
  <CommonCard
    :title="editingId ? t('wiki.admin.tags.editTitle') : t('wiki.admin.tags.addTitle')"
    :description="t('wiki.admin.tags.hint')"
  >
    <CommonValidationSummary v-if="errors.length" :errors="errors" :title="t('common.validationBlocked')" />

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="field">
        <label for="wiki-tag-label">{{ t('wiki.admin.tags.fields.label') }}</label>
        <input id="wiki-tag-label" v-model="label" class="input" maxlength="80" @input="onLabelInput" />
      </div>

      <div class="field">
        <label for="wiki-tag-slug">{{ t('wiki.admin.tags.fields.slug') }}</label>
        <input
          id="wiki-tag-slug"
          v-model="slug"
          class="input"
          maxlength="60"
          :placeholder="t('wiki.admin.tags.fields.slugPlaceholder')"
          @input="slugTouched = true"
        />
        <p class="mt-1 text-xs text-base-400">{{ t('wiki.admin.tags.fields.slugHint') }}</p>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-primary" :disabled="!canSave || saving" @click="save">
        {{ editingId ? t('actions.save') : t('wiki.admin.tags.add') }}
      </button>
      <button v-if="editingId" type="button" class="btn-secondary" @click="resetForm">
        {{ t('actions.cancel') }}
      </button>
    </div>
  </CommonCard>

  <CommonCard :title="t('wiki.admin.tags.listTitle')">
    <template #actions>
      <PageAuditTableHistoryButton :tables="['wiki_tags']" :return-meta="{ tab: 'tags' }" />
    </template>

    <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
    <p v-else-if="!tags.length" class="text-sm text-base-500">{{ t('wiki.admin.tags.empty') }}</p>

    <ul v-else class="divide-y divide-base-100">
      <li v-for="entry in tags" :key="entry.id" class="flex flex-wrap items-start gap-2 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-semibold text-base-900">{{ entry.label }}</span>
            <code class="rounded bg-base-100 px-1.5 py-0.5 text-xs text-base-600">{{ entry.slug }}</code>
          </div>
          <p class="mt-1 text-xs text-base-500">{{ t('wiki.admin.tags.usage', { count: entry.articleCount }) }}</p>
        </div>

        <div class="flex shrink-0 gap-3 text-xs">
          <button type="button" class="cursor-pointer text-accent-700 hover:underline" @click="edit(entry)">
            {{ t('actions.edit') }}
          </button>
          <button type="button" class="cursor-pointer text-danger-700 hover:underline" @click="askRemove(entry)">
            {{ t('actions.delete') }}
          </button>
        </div>
      </li>
    </ul>
  </CommonCard>

  <CommonModal v-model="confirmOpen" :title="t('wiki.admin.tags.removeConfirmTitle')">
    <p class="text-sm text-base-600">
      {{ t('wiki.admin.tags.removeConfirmText', { count: pendingRemoval?.articleCount ?? 0 }) }}
    </p>
    <template #footer>
      <button type="button" class="btn-secondary" @click="confirmOpen = false">{{ t('actions.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="remove">{{ t('actions.delete') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { WikiTagsResponse } from '~/server/api/wiki/tags/index.get'
import type { WikiTagView } from '~/server/utils/wiki/tags'

const { t } = useI18n()
const toast = useToast()

const tags = ref<WikiTagView[]>([])
const loading = ref(true)
const saving = ref(false)
const errors = ref<string[]>([])

const editingId = ref<number | null>(null)
const label = ref('')
const slug = ref('')
// Once the slug is typed by hand, the label stops rewriting it.
const slugTouched = ref(false)

const confirmOpen = ref(false)
const pendingRemoval = ref<WikiTagView | null>(null)

const canSave = computed(() => Boolean(label.value.trim()))

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function onLabelInput() {
  if (!slugTouched.value) slug.value = slugify(label.value)
}

function resetForm() {
  editingId.value = null
  label.value = ''
  slug.value = ''
  slugTouched.value = false
  errors.value = []
}

function edit(entry: WikiTagView) {
  editingId.value = entry.id
  label.value = entry.label
  slug.value = entry.slug
  slugTouched.value = true
  errors.value = []
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<WikiTagsResponse>('/api/wiki/tags')
    if (!res.ok) {
      errors.value = [res.error]
      return
    }
    tags.value = res.tags
    errors.value = []
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canSave.value || saving.value) return

  saving.value = true
  errors.value = []

  const body = { label: label.value.trim(), slug: slug.value.trim() }

  try {
    const res = editingId.value
      ? await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/tags/${editingId.value}`, { method: 'PUT', body })
      : await $fetch<{ ok: boolean, error?: string }>('/api/wiki/tags/create', { method: 'POST', body })

    if (!res.ok) {
      errors.value = [res.error ?? t('wiki.errors.saveFailed')]
      return
    }

    toast.success(t('wiki.admin.tags.savedToast'))
    resetForm()
    await load()
  } finally {
    saving.value = false
  }
}

function askRemove(entry: WikiTagView) {
  pendingRemoval.value = entry
  confirmOpen.value = true
}

async function remove() {
  const entry = pendingRemoval.value
  if (!entry || saving.value) return

  saving.value = true
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/tags/${entry.id}`, { method: 'DELETE' })

    if (!res.ok) {
      errors.value = [res.error ?? t('wiki.errors.saveFailed')]
      return
    }

    if (editingId.value === entry.id) resetForm()
    toast.success(t('wiki.admin.tags.removedToast'))
    await load()
  } finally {
    saving.value = false
    confirmOpen.value = false
    pendingRemoval.value = null
  }
}

load()

useAppRefresh().onRefresh(load)
</script>
