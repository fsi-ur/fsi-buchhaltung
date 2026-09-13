<template>
  <CommonCard :title="t('wiki.admin.paths.title')" :description="t('wiki.admin.paths.hint')">
    <template #actions>
      <PageAuditTableHistoryButton :tables="['wiki_paths', 'wiki_path_items', 'wiki_path_audiences']" :return-meta="{ tab: 'paths' }" />
      <button type="button" class="btn-primary" @click="openCreate">{{ t('wiki.admin.paths.create') }}</button>
    </template>

    <CommonValidationSummary v-if="error" :errors="[error]" :title="t('common.validationBlocked')" />

    <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
    <p v-else-if="!paths.length" class="text-sm text-base-500">{{ t('wiki.admin.paths.empty') }}</p>

    <ul v-else class="space-y-2">
      <li
        v-for="(path, position) in paths"
        :key="path.id"
        class="flex flex-wrap items-start gap-3 rounded-lg border border-base-200 p-3"
      >
        <Icon :name="path.icon" class="mt-0.5 shrink-0 text-xl text-base-500" aria-hidden="true" />

        <div class="min-w-0 flex-1">
          <p class="font-medium text-base-900">
            {{ path.title }}
            <span v-if="!path.isPublished" class="ml-2 text-xs font-normal text-warning-700">{{ t('wiki.admin.paths.draft') }}</span>
          </p>
          <p class="text-xs text-base-500">{{ path.slug }}</p>
          <p class="mt-1 text-xs text-base-500">
            {{ t('wiki.admin.paths.stepCount', { count: path.items.length }) }} ·
            {{ audienceLabel(path) }}
          </p>
          <p v-if="path.items.some(item => item.missing)" class="mt-1 text-xs text-danger-600">
            {{ t('wiki.admin.paths.missingArticles') }}
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
              :disabled="position === paths.length - 1"
              :aria-label="t('wiki.tree.moveDown')"
              @click="move(position, 1)"
            >
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
          <button type="button" class="btn-secondary" @click="openEdit(path)">{{ t('actions.edit') }}</button>
          <button type="button" class="btn-secondary text-danger-600" @click="deleteTarget = path">
            {{ t('actions.delete') }}
          </button>
        </div>
      </li>
    </ul>
  </CommonCard>

  <CommonModal
    v-model="modalOpen"
    :title="editingId === null ? t('wiki.admin.paths.createTitle') : t('wiki.admin.paths.editTitle')"
    width-class="max-w-3xl"
  >
    <CommonValidationSummary v-if="formError" :errors="[formError]" :title="t('common.validationBlocked')" />

    <div class="grid gap-3 sm:grid-cols-2">
      <div class="field">
        <label for="wiki-path-title">{{ t('wiki.admin.paths.fields.title') }}</label>
        <input id="wiki-path-title" v-model="form.title" class="input" @input="onTitleInput" />
      </div>
      <div class="field">
        <label for="wiki-path-slug">{{ t('wiki.admin.paths.fields.slug') }}</label>
        <input id="wiki-path-slug" v-model="form.slug" class="input" @input="slugTouched = true" />
      </div>
    </div>

    <div class="field">
      <label for="wiki-path-description">{{ t('wiki.admin.paths.fields.description') }}</label>
      <textarea id="wiki-path-description" v-model="form.description" class="input" rows="2"></textarea>
    </div>

    <div class="field">
      <label for="wiki-path-icon">{{ t('wiki.admin.paths.fields.icon') }}</label>
      <div class="flex items-center gap-2">
        <Icon :name="previewIcon" class="shrink-0 text-xl text-base-500" />
        <input id="wiki-path-icon" v-model="form.icon" class="input" :placeholder="DEFAULT_ICON" />
      </div>
    </div>

    <label class="flex w-fit cursor-pointer items-center gap-2 text-sm text-base-700">
      <input v-model="form.isPublished" type="checkbox" class="checkbox" />
      {{ t('wiki.admin.paths.fields.isPublished') }}
    </label>

    <div class="space-y-2">
      <h3 class="section-title">{{ t('wiki.admin.paths.fields.steps') }}</h3>
      <p class="text-xs text-base-500">{{ t('wiki.admin.paths.fields.stepsHint') }}</p>

      <p v-if="!form.items.length" class="text-sm text-base-500">{{ t('wiki.admin.paths.fields.noSteps') }}</p>

      <div
        v-for="(item, position) in form.items"
        :key="item.key"
        class="flex flex-wrap items-start gap-2 rounded-lg border border-base-200 p-3"
      >
        <span class="mt-2 w-5 shrink-0 text-sm text-base-500">{{ position + 1 }}.</span>

        <div class="min-w-0 flex-1 space-y-2">
          <p class="font-medium text-base-900">{{ articleLabel(item.articleId) }}</p>
          <input
            v-model="item.note"
            class="input"
            :placeholder="t('wiki.admin.paths.fields.notePlaceholder')"
          />
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <span class="inline-flex shrink-0 rounded-md border border-base-200">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-l-md p-1.5 text-base-500 hover:bg-base-100 disabled:pointer-events-none disabled:opacity-30 cursor-pointer transition-colors"
              :disabled="position === 0"
              :aria-label="t('wiki.tree.moveUp')"
              @click="moveItem(position, -1)"
            >
              <Icon name="material-symbols:keyboard-arrow-up-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-r-md border-l border-base-200 p-1.5 text-base-500 hover:bg-base-100 disabled:pointer-events-none disabled:opacity-30 cursor-pointer transition-colors"
              :disabled="position === form.items.length - 1"
              :aria-label="t('wiki.tree.moveDown')"
              @click="moveItem(position, 1)"
            >
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
          <button type="button" class="btn-secondary text-danger-600" @click="form.items.splice(position, 1)">
            {{ t('actions.remove') }}
          </button>
        </div>
      </div>

      <CommonSearchSelect
        v-model="articleQuery"
        :options="articleOptions"
        :placeholder="t('wiki.admin.paths.fields.addStep')"
        :empty-text="t('wiki.admin.paths.fields.noArticles')"
        menu-width="wide"
        @select="addItem($event as number)"
        @clear-selection="articleQuery = ''"
      />
    </div>

    <div class="space-y-2">
      <h3 class="section-title">{{ t('wiki.admin.paths.fields.audiences') }}</h3>
      <p class="text-xs text-base-500">{{ t('wiki.admin.paths.fields.audiencesHint') }}</p>

      <p v-if="!form.audiences.length" class="text-sm text-base-500">{{ t('wiki.admin.paths.fields.everyone') }}</p>

      <ul v-else class="space-y-2">
        <li
          v-for="(audience, position) in form.audiences"
          :key="`${audience.positionId}-${audience.subdivisionId}-${position}`"
          class="flex items-center justify-between gap-2 rounded-lg border border-base-200 px-3 py-2 text-sm"
        >
          <span>{{ audienceEntryLabel(audience) }}</span>
          <button type="button" class="btn-secondary text-danger-600" @click="form.audiences.splice(position, 1)">
            {{ t('actions.remove') }}
          </button>
        </li>
      </ul>

      <div class="grid gap-2 sm:grid-cols-2">
        <CommonSearchSelect
          v-model="positionQuery"
          :options="positionSelectOptions"
          :placeholder="t('wiki.admin.paths.fields.addPosition')"
          :empty-text="t('wiki.admin.paths.fields.noAudienceOptions')"
          @select="addAudience('positionId', $event as number)"
          @clear-selection="positionQuery = ''"
        />
        <CommonSearchSelect
          v-model="subdivisionQuery"
          :options="subdivisionSelectOptions"
          :placeholder="t('wiki.admin.paths.fields.addSubdivision')"
          :empty-text="t('wiki.admin.paths.fields.noAudienceOptions')"
          @select="addAudience('subdivisionId', $event as number)"
          @clear-selection="subdivisionQuery = ''"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" :disabled="saving" @click="modalOpen = false">
          {{ t('actions.cancel') }}
        </button>
        <button type="button" class="btn-primary" :disabled="saving" @click="submit">
          {{ t('wiki.editor.save') }}
        </button>
      </div>
    </template>
  </CommonModal>

  <CommonModal
    v-if="deleteTarget"
    :model-value="true"
    :title="t('wiki.admin.paths.deleteConfirmTitle')"
    @update:model-value="deleteTarget = null"
  >
    <p class="text-sm text-base-700">{{ t('wiki.admin.paths.deleteConfirmText', { title: deleteTarget.title }) }}</p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="deleteTarget = null">{{ t('actions.cancel') }}</button>
        <button type="button" class="btn-primary" @click="remove">{{ t('actions.delete') }}</button>
      </div>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { WikiPathManageResponse } from '~/server/api/wiki/paths/manage.get'
import type { CreateWikiPathResponse } from '~/server/api/wiki/paths/create.post'
import type { WikiSubjectOptionsResponse } from '~/server/api/wiki/access/subject-options.get'
import type { WikiTreeResponse } from '~/server/api/wiki/tree.get'
import type { WikiPathAdminView, WikiTreeArticle } from '~/types/wiki'

interface FormItem {
  key: string
  id: number | null
  articleId: number
  note: string
}

interface FormAudience {
  positionId: number | null
  subdivisionId: number | null
}

const { t } = useI18n()
const toast = useToast()

const DEFAULT_ICON = 'material-symbols:hiking-rounded'

const paths = ref<WikiPathAdminView[]>([])
const loading = ref(true)
const error = ref('')
const formError = ref('')
const saving = ref(false)
const modalOpen = ref(false)
const editingId = ref<number | null>(null)
const deleteTarget = ref<WikiPathAdminView | null>(null)
const slugTouched = ref(false)

const articleQuery = ref('')
const positionQuery = ref('')
const subdivisionQuery = ref('')

const articles = ref<Array<{ id: number, title: string, spaceTitle: string }>>([])
const positionOptions = ref<Array<{ id: number, label: string }>>([])
const subdivisionOptions = ref<Array<{ id: number, label: string }>>([])

const form = reactive({
  title: '',
  slug: '',
  description: '',
  icon: '',
  isPublished: false,
  items: [] as FormItem[],
  audiences: [] as FormAudience[],
})

const previewIcon = computed(() => (/^[a-z0-9-]+:[a-z0-9-]+$/.test(form.icon.trim()) ? form.icon.trim() : DEFAULT_ICON))

const articleOptions = computed<SearchSelectOption<number>[]>(() =>
  articles.value
    .filter(article => !form.items.some(item => item.articleId === article.id))
    .map(article => ({
      key: article.id,
      label: `${article.spaceTitle} · ${article.title}`,
      value: article.id,
      searchText: article.title,
    })))

const positionSelectOptions = computed<SearchSelectOption<number>[]>(() =>
  positionOptions.value
    .filter(option => !form.audiences.some(audience => audience.positionId === option.id))
    .map(option => ({ key: option.id, label: option.label, value: option.id })))

const subdivisionSelectOptions = computed<SearchSelectOption<number>[]>(() =>
  subdivisionOptions.value
    .filter(option => !form.audiences.some(audience => audience.subdivisionId === option.id))
    .map(option => ({ key: option.id, label: option.label, value: option.id })))

function articleLabel(articleId: number) {
  const article = articles.value.find(entry => entry.id === articleId)
  return article ? `${article.spaceTitle} · ${article.title}` : t('wiki.admin.paths.missingArticle')
}

function audienceEntryLabel(audience: FormAudience) {
  if (audience.positionId !== null) {
    return positionOptions.value.find(option => option.id === audience.positionId)?.label ?? String(audience.positionId)
  }
  return subdivisionOptions.value.find(option => option.id === audience.subdivisionId)?.label ?? String(audience.subdivisionId)
}

function audienceLabel(path: WikiPathAdminView) {
  if (!path.audiences.length) return t('wiki.admin.paths.forEveryone')
  return path.audiences.map(audience => audienceEntryLabel(audience)).join(', ')
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

function onTitleInput() {
  if (!slugTouched.value) form.slug = slugify(form.title)
}

function resetForm() {
  formError.value = ''
  form.title = ''
  form.slug = ''
  form.description = ''
  form.icon = ''
  form.isPublished = false
  form.items = []
  form.audiences = []
}

function openCreate() {
  editingId.value = null
  slugTouched.value = false
  resetForm()
  modalOpen.value = true
}

function openEdit(path: WikiPathAdminView) {
  editingId.value = path.id
  slugTouched.value = true
  resetForm()
  form.title = path.title
  form.slug = path.slug
  form.description = path.description
  form.icon = path.icon
  form.isPublished = path.isPublished
  form.items = path.items.map(item => ({
    key: `item-${item.id}`,
    id: item.id,
    articleId: item.articleId,
    note: item.note,
  }))
  form.audiences = path.audiences.map(audience => ({
    positionId: audience.positionId,
    subdivisionId: audience.subdivisionId,
  }))
  modalOpen.value = true
}

function addItem(articleId: number) {
  articleQuery.value = ''
  if (form.items.some(item => item.articleId === articleId)) return
  form.items.push({ key: `new-${Date.now()}-${articleId}`, id: null, articleId, note: '' })
}

function moveItem(position: number, direction: -1 | 1) {
  const target = position + direction
  if (target < 0 || target >= form.items.length) return
  const [moved] = form.items.splice(position, 1)
  form.items.splice(target, 0, moved!)
}

function addAudience(key: 'positionId' | 'subdivisionId', id: number) {
  positionQuery.value = ''
  subdivisionQuery.value = ''
  if (form.audiences.some(audience => audience[key] === id)) return
  form.audiences.push({ positionId: key === 'positionId' ? id : null, subdivisionId: key === 'subdivisionId' ? id : null })
}

function flatten(nodes: WikiTreeArticle[], spaceTitle: string, into: Array<{ id: number, title: string, spaceTitle: string }>) {
  for (const node of nodes) {
    into.push({ id: node.id, title: node.title, spaceTitle })
    flatten(node.children, spaceTitle, into)
  }
  return into
}

async function loadArticles() {
  const res = await $fetch<WikiTreeResponse>('/api/wiki/tree', { query: { includeDrafts: '1' } })
  if (!res.ok) return
  const collected: Array<{ id: number, title: string, spaceTitle: string }> = []
  for (const space of res.spaces) flatten(space.articles, space.title, collected)
  articles.value = collected
}

async function loadAudienceOptions() {
  for (const [type, target] of [['position', positionOptions], ['subdivision', subdivisionOptions]] as const) {
    const res = await $fetch<WikiSubjectOptionsResponse>('/api/wiki/access/subject-options', { query: { type, q: '' } })
    target.value = res.ok ? res.options.map(option => ({ id: option.id, label: option.label })) : []
  }
}

function body() {
  return {
    title: form.title.trim(),
    slug: form.slug.trim(),
    description: form.description.trim(),
    icon: form.icon.trim(),
    isPublished: form.isPublished,
    items: form.items.map(item => ({ id: item.id, articleId: item.articleId, note: item.note })),
    audiences: form.audiences.map(audience => ({
      positionId: audience.positionId,
      subdivisionId: audience.subdivisionId,
    })),
  }
}

async function submit() {
  formError.value = ''

  if (!form.title.trim()) {
    formError.value = t('wiki.errors.titleRequired')
    return
  }

  saving.value = true
  try {
    const res = editingId.value === null
      ? await $fetch<CreateWikiPathResponse>('/api/wiki/paths/create', { method: 'POST', body: body() })
      : await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/paths/${editingId.value}`, { method: 'PUT', body: body() })

    if (!res.ok) {
      formError.value = res.error ?? t('wiki.errors.saveFailed')
      return
    }

    toast.success(t('wiki.admin.paths.savedToast'))
    modalOpen.value = false
    await load()
  } catch {
    formError.value = t('wiki.errors.saveFailed')
  } finally {
    saving.value = false
  }
}

async function move(position: number, direction: -1 | 1) {
  const target = position + direction
  if (target < 0 || target >= paths.value.length) return

  const order = paths.value.map(path => path.id)
  const [moved] = order.splice(position, 1)
  order.splice(target, 0, moved!)

  error.value = ''
  const res = await $fetch<{ ok: boolean, error?: string }>('/api/wiki/paths/reorder', {
    method: 'POST',
    body: { pathIds: order },
  })

  if (!res.ok) {
    error.value = res.error ?? t('wiki.errors.saveFailed')
    return
  }

  await load()
}

async function remove() {
  const path = deleteTarget.value
  deleteTarget.value = null
  if (!path) return

  error.value = ''
  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/paths/${path.id}`, { method: 'DELETE' })

  if (!res.ok) {
    error.value = res.error ?? t('wiki.errors.saveFailed')
    return
  }

  toast.success(t('wiki.admin.paths.deletedToast'))
  await load()
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<WikiPathManageResponse>('/api/wiki/paths/manage')
    if (!res.ok) {
      error.value = res.error
      return
    }
    paths.value = res.paths
  } catch {
    error.value = t('wiki.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

loadArticles()
loadAudienceOptions()
load()

useAppRefresh().onRefresh(async () => { await Promise.all([loadArticles(), loadAudienceOptions(), load()]) })
</script>
