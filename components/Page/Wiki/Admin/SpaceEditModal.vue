<template>
  <CommonModal
    :model-value="modelValue"
    :title="isCreate ? t('wiki.space.createTitle') : t('wiki.space.editTitle')"
    width-class="max-w-lg"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <CommonValidationSummary
      v-if="error"
      :errors="[error]"
      :title="t('common.validationBlocked')"
    />

    <p class="text-sm text-base-500">{{ t('wiki.space.createHint') }}</p>

    <div class="field">
      <label for="wiki-space-title">{{ t('wiki.space.fields.title') }}</label>
      <input id="wiki-space-title" v-model="form.title" class="input" />
    </div>

    <div class="field">
      <label for="wiki-space-slug">{{ t('wiki.space.fields.slug') }}</label>
      <input id="wiki-space-slug" v-model="form.slug" class="input" :placeholder="t('wiki.space.fields.slugPlaceholder')" />
      <p class="mt-1 text-xs text-base-500">
        {{ t('wiki.space.fields.slugHint') }}
        <template v-if="!isCreate"> {{ t('wiki.space.fields.slugRenameHint') }}</template>
      </p>
    </div>

    <div class="field">
      <label for="wiki-space-description">{{ t('wiki.space.fields.description') }}</label>
      <textarea id="wiki-space-description" v-model="form.description" class="input" rows="3"></textarea>
    </div>

    <div class="field">
      <label for="wiki-space-icon">{{ t('wiki.space.fields.icon') }}</label>
      <div class="flex items-center gap-2">
        <Icon :name="previewIcon" class="shrink-0 text-xl text-base-500" />
        <input id="wiki-space-icon" v-model="form.icon" class="input" :placeholder="DEFAULT_ICON" />
      </div>
      <p class="mt-1 text-xs text-base-500">{{ t('wiki.space.fields.iconHint') }}</p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="field">
        <label for="wiki-space-owner-position">{{ t('wiki.editor.fields.ownerPosition') }}</label>
        <MenuDropdown id="wiki-space-owner-position" v-model="openFieldMenu">
          <template #trigger="{ styling }">
            <button type="button" :class="[styling, 'cursor-pointer']">
              <span class="truncate">{{ ownerPositionLabel }}</span>
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
            </button>
          </template>
          <template #default="{ styling }">
            <button type="button" :class="styling" @click="selectOwner('positionId', null)">
              {{ t('wiki.editor.fields.noOwner') }}
            </button>
            <button
              v-for="option in positionOptions"
              :key="option.id"
              type="button"
              :class="styling"
              @click="selectOwner('positionId', option.id)"
            >
              {{ option.label }}
            </button>
          </template>
        </MenuDropdown>
      </div>

      <div class="field">
        <label for="wiki-space-owner-subdivision">{{ t('wiki.editor.fields.ownerSubdivision') }}</label>
        <MenuDropdown id="wiki-space-owner-subdivision" v-model="openFieldMenu">
          <template #trigger="{ styling }">
            <button type="button" :class="[styling, 'cursor-pointer']">
              <span class="truncate">{{ ownerSubdivisionLabel }}</span>
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
            </button>
          </template>
          <template #default="{ styling }">
            <button type="button" :class="styling" @click="selectOwner('subdivisionId', null)">
              {{ t('wiki.editor.fields.noOwner') }}
            </button>
            <button
              v-for="option in subdivisionOptions"
              :key="option.id"
              type="button"
              :class="styling"
              @click="selectOwner('subdivisionId', option.id)"
            >
              {{ option.label }}
            </button>
          </template>
        </MenuDropdown>
      </div>
    </div>

    <label class="flex w-fit cursor-pointer items-center gap-2 text-sm text-base-700">
      <input v-model="form.createGrant" type="checkbox" class="checkbox" />
      {{ t('wiki.editor.fields.createOwnerGrant') }}
    </label>

    <label class="flex w-fit cursor-pointer items-center gap-2 text-sm text-base-700">
      <input v-model="form.requiresReview" type="checkbox" class="checkbox" />
      {{ t('wiki.space.fields.requiresReview') }}
    </label>

    <label v-if="!isCreate" class="flex w-fit cursor-pointer items-center gap-2 text-sm text-base-700">
      <input v-model="form.isArchived" type="checkbox" class="checkbox" />
      {{ t('wiki.space.fields.isArchived') }}
    </label>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" :disabled="saving" @click="close">
          {{ t('actions.cancel') }}
        </button>
        <button type="button" class="btn-primary" :disabled="saving" @click="submit">
          {{ isCreate ? t('wiki.space.create') : t('wiki.editor.save') }}
        </button>
      </div>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { CreateWikiSpaceResponse } from '~/server/api/wiki/spaces/create.post'
import type { WikiSubjectOptionsResponse } from '~/server/api/wiki/access/subject-options.get'
import type { WikiSpaceAdminView } from '~/types/wiki'

const props = defineProps<{
  modelValue: boolean
  /** `null` opens the modal in create mode. */
  space?: WikiSpaceAdminView | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved', spaceId: number): void
}>()

const { t } = useI18n()
const toast = useToast()

const DEFAULT_ICON = 'material-symbols:menu-book-rounded'

const saving = ref(false)
const error = ref('')
const openFieldMenu = ref<string | null>(null)
const positionOptions = ref<Array<{ id: number, label: string }>>([])
const subdivisionOptions = ref<Array<{ id: number, label: string }>>([])

const form = reactive({
  title: '',
  slug: '',
  description: '',
  icon: '',
  requiresReview: false,
  isArchived: false,
  positionId: null as number | null,
  subdivisionId: null as number | null,
  createGrant: true,
})

const isCreate = computed(() => !props.space)
const previewIcon = computed(() => (/^[a-z0-9-]+:[a-z0-9-]+$/.test(form.icon.trim()) ? form.icon.trim() : DEFAULT_ICON))
const ownerPositionLabel = computed(() => positionOptions.value.find(option => option.id === form.positionId)?.label ?? t('wiki.editor.fields.noOwner'))
const ownerSubdivisionLabel = computed(() => subdivisionOptions.value.find(option => option.id === form.subdivisionId)?.label ?? t('wiki.editor.fields.noOwner'))

function selectOwner(key: 'positionId' | 'subdivisionId', value: number | null) {
  form[key] = value
  openFieldMenu.value = null
}

function close() {
  emit('update:modelValue', false)
}

async function loadOwnerOptions() {
  for (const [type, target] of [['position', positionOptions], ['subdivision', subdivisionOptions]] as const) {
    const res = await apiFetch<WikiSubjectOptionsResponse>('/api/wiki/access/subject-options', { query: { type, q: '' } })
    target.value = res.ok ? res.options.map(option => ({ id: option.id, label: option.label })) : []
  }
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  error.value = ''
  loadOwnerOptions()

  const space = props.space
  form.title = space?.title ?? ''
  form.slug = space?.slug ?? ''
  form.description = space?.description ?? ''
  form.icon = space?.icon ?? ''
  form.requiresReview = space?.requiresReview ?? false
  form.isArchived = space?.isArchived ?? false
  form.positionId = space?.ownerPositionId ?? null
  form.subdivisionId = space?.ownerSubdivisionId ?? null
  form.createGrant = true
})

async function submit() {
  error.value = ''

  if (!form.title.trim()) {
    error.value = t('wiki.errors.titleRequired')
    return
  }

  const body = {
    title: form.title.trim(),
    slug: form.slug.trim(),
    description: form.description.trim(),
    icon: form.icon.trim(),
    requiresReview: form.requiresReview,
    isArchived: form.isArchived,
    ownerPositionId: form.positionId,
    ownerSubdivisionId: form.subdivisionId,
    createGrant: form.createGrant,
  }

  saving.value = true
  try {
    if (isCreate.value) {
      const res = await apiFetch<CreateWikiSpaceResponse>('/api/wiki/spaces/create', { method: 'POST', body })
      if (!res.ok) {
        error.value = res.error
        return
      }
      toast.success(t('wiki.space.createdToast'))
      emit('saved', res.spaceId)
    } else {
      const res = await apiFetch<{ ok: boolean, error?: string }>(`/api/wiki/spaces/${props.space!.id}`, {
        method: 'PUT',
        body,
      })
      if (!res.ok) {
        error.value = res.error ?? t('wiki.space.saveFailed')
        return
      }
      toast.success(t('wiki.space.savedToast'))
      emit('saved', props.space!.id)
    }

    close()
  } catch {
    error.value = isCreate.value ? t('wiki.space.createFailed') : t('wiki.space.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>
