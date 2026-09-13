<template>
  <CommonCard :title="t('wiki.admin.spaces.title')" :description="t('wiki.admin.spaces.hint')">
    <template #actions>
      <PageAuditTableHistoryButton :tables="['wiki_spaces']" :return-meta="{ tab: 'spaces' }" />
      <button type="button" class="btn-primary" @click="openCreate">{{ t('wiki.space.create') }}</button>
    </template>

    <CommonValidationSummary v-if="error" :errors="[error]" :title="t('common.validationBlocked')" />

    <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
    <p v-else-if="!spaces.length" class="text-sm text-base-500">{{ t('wiki.home.noSpaces') }}</p>

    <ul v-else class="space-y-2">
      <li
        v-for="(space, position) in spaces"
        :key="space.id"
        class="flex flex-wrap items-start gap-3 rounded-lg border border-base-200 p-3"
        :class="space.isArchived ? 'bg-base-50' : ''"
      >
        <Icon :name="space.icon" class="mt-0.5 shrink-0 text-xl text-base-500" aria-hidden="true" />

        <div class="min-w-0 flex-1">
          <p class="font-medium text-base-900">
            {{ space.title }}
            <span v-if="space.isArchived" class="ml-2 text-xs font-normal text-base-500">{{ t('wiki.admin.spaces.archived') }}</span>
          </p>
          <p class="text-xs text-base-500">{{ space.slug }}</p>
          <p v-if="space.description" class="mt-0.5 text-sm text-base-600">{{ space.description }}</p>
          <p class="mt-1 text-xs text-base-500">
            {{ t('wiki.admin.spaces.articleCount', { count: space.articleCount }) }}
            <template v-if="space.requiresReview"> · {{ t('wiki.admin.spaces.requiresReview') }}</template>
            <template v-if="ownerLabel(space)"> · {{ t('wiki.article.owner') }}: {{ ownerLabel(space) }}</template>
          </p>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <span class="inline-flex shrink-0 rounded-md border border-base-200">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-l-md p-1.5 text-base-500 hover:bg-base-100 disabled:pointer-events-none disabled:opacity-30 cursor-pointer transition-colors"
              :disabled="position === 0"
              :aria-label="t('wiki.tree.moveUp')"
              @click="move(position, -1)"
            >
              <Icon name="material-symbols:keyboard-arrow-up-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-r-md border-l border-base-200 p-1.5 text-base-500 hover:bg-base-100 disabled:pointer-events-none disabled:opacity-30 cursor-pointer transition-colors"
              :disabled="position === spaces.length - 1"
              :aria-label="t('wiki.tree.moveDown')"
              @click="move(position, 1)"
            >
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
          <button type="button" class="btn-secondary" @click="openEdit(space)">{{ t('actions.edit') }}</button>
          <button
            v-if="!space.articleCount"
            type="button"
            class="btn-secondary text-danger-600"
            @click="deleteTarget = space"
          >
            {{ t('actions.delete') }}
          </button>
          <button v-else type="button" class="btn-secondary" @click="toggleArchived(space)">
            {{ space.isArchived ? t('wiki.admin.spaces.unarchive') : t('wiki.admin.spaces.archive') }}
          </button>
        </div>
      </li>
    </ul>
  </CommonCard>

  <PageWikiAdminSpaceEditModal v-model="modalOpen" :space="editing" @saved="load" />

  <CommonModal
    v-if="deleteTarget"
    :model-value="true"
    :title="t('wiki.admin.spaces.deleteConfirmTitle')"
    @update:model-value="deleteTarget = null"
  >
    <p class="text-sm text-base-700">{{ t('wiki.admin.spaces.deleteConfirmText', { title: deleteTarget.title }) }}</p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="deleteTarget = null">{{ t('actions.cancel') }}</button>
        <button type="button" class="btn-primary" @click="remove">{{ t('actions.delete') }}</button>
      </div>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { WikiSpaceListResponse } from '~/server/api/wiki/spaces/index.get'
import type { WikiSpaceAdminView } from '~/types/wiki'

const { t } = useI18n()
const toast = useToast()

const spaces = ref<WikiSpaceAdminView[]>([])
const loading = ref(true)
const error = ref('')
const modalOpen = ref(false)
const editing = ref<WikiSpaceAdminView | null>(null)
const deleteTarget = ref<WikiSpaceAdminView | null>(null)

function ownerLabel(space: WikiSpaceAdminView) {
  return [space.ownerPositionName, space.ownerSubdivisionName].filter(Boolean).join(' · ')
}

function openCreate() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(space: WikiSpaceAdminView) {
  editing.value = space
  modalOpen.value = true
}

async function save(space: WikiSpaceAdminView, changes: Partial<WikiSpaceAdminView>) {
  const merged = { ...space, ...changes }

  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/spaces/${space.id}`, {
    method: 'PUT',
    body: {
      title: merged.title,
      slug: merged.slug,
      description: merged.description,
      icon: merged.icon,
      requiresReview: merged.requiresReview,
      isArchived: merged.isArchived,
      ownerPositionId: merged.ownerPositionId,
      ownerSubdivisionId: merged.ownerSubdivisionId,
      createGrant: false,
    },
  })

  if (!res.ok) {
    error.value = res.error ?? t('wiki.space.saveFailed')
    return false
  }

  return true
}

async function toggleArchived(space: WikiSpaceAdminView) {
  error.value = ''
  if (!await save(space, { isArchived: !space.isArchived })) return

  toast.success(space.isArchived ? t('wiki.admin.spaces.unarchivedToast') : t('wiki.admin.spaces.archivedToast'))
  await load()
}

async function move(position: number, direction: -1 | 1) {
  const target = position + direction
  if (target < 0 || target >= spaces.value.length) return

  const order = spaces.value.map(space => space.id)
  const [moved] = order.splice(position, 1)
  order.splice(target, 0, moved!)

  error.value = ''
  const res = await $fetch<{ ok: boolean, error?: string }>('/api/wiki/spaces/reorder', {
    method: 'POST',
    body: { spaceIds: order },
  })

  if (!res.ok) {
    error.value = res.error ?? t('wiki.space.saveFailed')
    return
  }

  await load()
}

async function remove() {
  const space = deleteTarget.value
  deleteTarget.value = null
  if (!space) return

  error.value = ''
  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/spaces/${space.id}`, { method: 'DELETE' })

  if (!res.ok) {
    error.value = res.error ?? t('wiki.space.saveFailed')
    return
  }

  toast.success(t('wiki.admin.spaces.deletedToast'))
  await load()
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<WikiSpaceListResponse>('/api/wiki/spaces')
    if (!res.ok) {
      error.value = res.error
      return
    }
    spaces.value = res.spaces
  } catch {
    error.value = t('wiki.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

load()

useAppRefresh().onRefresh(load)
</script>
