<template>
  <Page
    :headline1="isCreate ? t('wiki.editor.titleNew') : t('wiki.editor.titleEdit')"
    :flush-header-with-cards="!isCreate"
    :help-section="activeTab"
    @open-menu="$emit('openMenu')"
  >
    <template #header="{ headerContainerRef, headlineGroupRef }">
      <CommonTabOverview
        v-if="!isCreate"
        v-model="activeTab"
        :tabs="tabs"
        :header-container-ref="headerContainerRef"
        :headline-group-ref="headlineGroupRef"
      />
    </template>

    <template #cards>
      <CommonCard class="-mb-6 sm:mb-0">
        <CommonValidationSummary
          v-if="errors.length"
          :errors="errors"
          :title="t('common.validationBlocked')"
        />

        <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>

        <template v-else>
          <div v-if="articleId && historyTables.length" class="mb-4 flex justify-end">
            <PageAuditScopedHistoryButton :tables="historyTables" :parent-id="articleId" />
          </div>

          <div v-show="activeTab === 'content'" class="space-y-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="field">
                <label for="wiki-title">{{ t('wiki.editor.fields.title') }}</label>
                <input id="wiki-title" v-model="form.title" class="input" :disabled="readOnly" @input="onTitleInput" />
              </div>
              <div class="field">
                <label for="wiki-slug">{{ t('wiki.editor.fields.slug') }}</label>
                <input id="wiki-slug" v-model="form.slug" class="input" :disabled="readOnly" @input="slugTouched = true" />
              </div>
            </div>

            <div class="field">
              <label for="wiki-summary">{{ t('wiki.editor.fields.summary') }}</label>
              <input id="wiki-summary" v-model="form.summary" class="input" :disabled="readOnly" />
            </div>

            <div v-if="isCreate" class="grid gap-3 sm:grid-cols-2">
              <div class="field">
                <label for="wiki-space">{{ t('wiki.editor.fields.space') }}</label>
                <MenuDropdown id="wiki-space" v-model="openFieldMenu">
                  <template #trigger="{ styling }">
                    <button type="button" :class="[styling, 'cursor-pointer']">
                      <span class="truncate">{{ spaceLabel }}</span>
                      <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
                    </button>
                  </template>
                  <template #default="{ styling }">
                    <button
                      v-for="space in writableSpaces"
                      :key="space.id"
                      type="button"
                      :class="styling"
                      @click="selectSpace(space.id)"
                    >
                      {{ space.title }}
                    </button>
                  </template>
                </MenuDropdown>
              </div>
              <div class="field">
                <label for="wiki-parent-new">{{ t('wiki.editor.fields.parent') }}</label>
                <MenuDropdown id="wiki-parent-new" v-model="openFieldMenu">
                  <template #trigger="{ styling }">
                    <button type="button" :class="[styling, 'cursor-pointer']">
                      <span class="truncate">{{ parentLabel }}</span>
                      <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
                    </button>
                  </template>
                  <template #default="{ styling }">
                    <button type="button" :class="styling" @click="selectParent(null)">{{ t('wiki.editor.fields.noParent') }}</button>
                    <button
                      v-for="option in parentOptions"
                      :key="option.id"
                      type="button"
                      :class="styling"
                      @click="selectParent(option.id)"
                    >
                      {{ option.label }}
                    </button>
                  </template>
                </MenuDropdown>
              </div>
            </div>

            <PageWikiArticleEditorMarkdown v-model="form.markdown" :checklists="checklists" />

            <p v-if="draftStateLabel" class="flex items-center gap-1.5 text-xs text-base-500">
              <span
                class="h-1.5 w-1.5 rounded-full"
                :class="savingDraft ? 'bg-warning-400' : dirty ? 'bg-accent-500' : 'bg-success-500'"
                aria-hidden="true"
              ></span>
              {{ draftStateLabel }}
            </p>
          </div>

          <div v-show="activeTab === 'settings'" class="space-y-4">
            <p v-if="readOnly" class="text-sm text-base-500">{{ t('wiki.editor.readOnly') }}</p>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="field">
                <label for="wiki-parent">{{ t('wiki.editor.fields.parent') }}</label>
                <MenuDropdown id="wiki-parent" v-model="openFieldMenu" :disabled="readOnly">
                  <template #trigger="{ styling }">
                    <button type="button" :class="[styling, !readOnly ? 'cursor-pointer' : '']" :disabled="readOnly">
                      <span class="truncate">{{ parentLabel }}</span>
                      <Icon v-if="!readOnly" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
                    </button>
                  </template>
                  <template #default="{ styling }">
                    <button type="button" :class="styling" @click="selectParent(null)">{{ t('wiki.editor.fields.noParent') }}</button>
                    <button
                      v-for="option in parentOptions"
                      :key="option.id"
                      type="button"
                      :class="styling"
                      @click="selectParent(option.id)"
                    >
                      {{ option.label }}
                    </button>
                  </template>
                </MenuDropdown>
              </div>

              <div class="field">
                <label for="wiki-review-interval">{{ t('wiki.editor.fields.reviewInterval') }}</label>
                <input
                  id="wiki-review-interval"
                  v-model="form.reviewIntervalDays"
                  type="number"
                  min="1"
                  max="3650"
                  class="input"
                  :disabled="readOnly"
                />
                <span class="text-xs text-base-500">{{ t('wiki.editor.fields.reviewIntervalHint') }}</span>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="field">
                <label for="wiki-owner-position">{{ t('wiki.editor.fields.ownerPosition') }}</label>
                <MenuDropdown id="wiki-owner-position" v-model="openFieldMenu" :disabled="readOnly">
                  <template #trigger="{ styling }">
                    <button type="button" :class="[styling, !readOnly ? 'cursor-pointer' : '']" :disabled="readOnly">
                      <span class="truncate">{{ ownerPositionLabel }}</span>
                      <Icon v-if="!readOnly" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
                    </button>
                  </template>
                  <template #default="{ styling }">
                    <button type="button" :class="styling" @click="selectOwnerPosition(null)">{{ t('wiki.editor.fields.noOwner') }}</button>
                    <button
                      v-for="option in positionOptions"
                      :key="option.id"
                      type="button"
                      :class="styling"
                      @click="selectOwnerPosition(option.id)"
                    >
                      {{ option.label }}
                    </button>
                  </template>
                </MenuDropdown>
              </div>

              <div class="field">
                <label for="wiki-owner-subdivision">{{ t('wiki.editor.fields.ownerSubdivision') }}</label>
                <MenuDropdown id="wiki-owner-subdivision" v-model="openFieldMenu" :disabled="readOnly">
                  <template #trigger="{ styling }">
                    <button type="button" :class="[styling, !readOnly ? 'cursor-pointer' : '']" :disabled="readOnly">
                      <span class="truncate">{{ ownerSubdivisionLabel }}</span>
                      <Icon v-if="!readOnly" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
                    </button>
                  </template>
                  <template #default="{ styling }">
                    <button type="button" :class="styling" @click="selectOwnerSubdivision(null)">{{ t('wiki.editor.fields.noOwner') }}</button>
                    <button
                      v-for="option in subdivisionOptions"
                      :key="option.id"
                      type="button"
                      :class="styling"
                      @click="selectOwnerSubdivision(option.id)"
                    >
                      {{ option.label }}
                    </button>
                  </template>
                </MenuDropdown>
              </div>
            </div>

            <label
              class="flex w-fit items-center gap-2 text-sm text-base-700"
              :class="readOnly ? 'cursor-default' : 'cursor-pointer'"
            >
              <input v-model="owner.createGrant" type="checkbox" class="checkbox" :disabled="readOnly" />
              {{ t('wiki.editor.fields.createOwnerGrant') }}
            </label>

            <div class="space-y-2 border-t border-base-100 pt-4">
              <div>
                <h3 class="section-title">{{ t('wiki.editor.fields.tags') }}</h3>
                <p class="text-xs text-base-500">{{ t('wiki.editor.fields.tagsHint') }}</p>
              </div>

              <p v-if="!selectedTags.length" class="text-sm text-base-500">{{ t('wiki.editor.fields.noTags') }}</p>

              <ul v-else class="flex flex-wrap gap-2">
                <li
                  v-for="tag in selectedTags"
                  :key="tag.id"
                  class="inline-flex items-center gap-1.5 rounded-full bg-base-100 py-1 pl-3 text-sm text-base-700"
                  :class="readOnly ? 'pr-3' : 'pr-1'"
                >
                  {{ tag.label }}
                  <button
                    v-if="!readOnly"
                    type="button"
                    class="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-base-400 transition-colors hover:bg-base-200 hover:text-danger-700"
                    :title="t('wiki.editor.fields.removeTag')"
                    :aria-label="t('wiki.editor.fields.removeTag')"
                    @click="removeTag(tag.id)"
                  >
                    <Icon name="material-symbols:close-rounded" class="text-sm" aria-hidden="true" />
                  </button>
                </li>
              </ul>

              <CommonSearchSelect
                v-if="!readOnly"
                v-model="tagQuery"
                :options="tagOptions"
                :placeholder="t('wiki.editor.fields.addTag')"
                :empty-text="availableTags.length ? t('wiki.editor.fields.noTagOptions') : t('wiki.editor.fields.noTagsDefined')"
                @select="addTag($event as number)"
                @clear-selection="tagQuery = ''"
              />
            </div>
          </div>

          <div v-show="activeTab === 'checklists'">
            <PageWikiArticleChecklistsTab
              v-if="articleId"
              :article-id="articleId"
              v-model="checklists"
              :read-only="readOnly"
            />
            <p v-else class="text-sm text-base-500">{{ t('wiki.checklist.saveArticleFirst') }}</p>
          </div>

          <div v-show="activeTab === 'attachments'" class="space-y-3">
            <p v-if="articleId === null" class="text-sm text-base-500">{{ t('wiki.attachments.saveArticleFirst') }}</p>

            <CommonAttachmentPicker
              v-else
              :model-value="attachmentSelection"
              scope="wiki_article"
              :entity-id="articleId"
              :known-files="attachments"
              :read-only="readOnly"
              :disabled="attachmentsSaving"
              @update:model-value="saveAttachments"
            />

            <p class="text-xs text-base-400">{{ t('wiki.attachments.help') }}</p>
          </div>

          <div v-show="activeTab === 'access'">
            <PageWikiArticleAccessTab v-if="articleId" scope-type="article" :scope-id="articleId" />
          </div>

          <div v-show="activeTab === 'history'">
            <PageWikiArticleRevisionList
              v-if="articleId"
              ref="revisionListRef"
              :article-id="articleId"
              :can-write="!readOnly"
              @restored="reload"
            />
          </div>

          <div class="flex flex-wrap items-center gap-2 border-t border-base-200 pt-4">
            <button
              v-if="!isCreate && !readOnly"
              type="button"
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-danger-200 px-4 py-2 text-sm text-danger-700 transition-colors hover:bg-danger-50"
              @click="confirmArchive = true"
            >
              <Icon name="material-symbols:archive-outline-rounded" class="text-base" aria-hidden="true" />
              {{ t('wiki.editor.archive') }}
            </button>

            <span class="flex-1"></span>

            <button type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="cancel">
              <Icon name="material-symbols:close-rounded" class="text-base" aria-hidden="true" />
              {{ t('wiki.editor.cancel') }}
            </button>

            <template v-if="isCreate">
              <button
                type="button"
                class="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
                :disabled="saving"
                @click="create"
              >
                <Icon name="material-symbols:add-rounded" class="text-base" aria-hidden="true" />
                {{ t('wiki.editor.create') }}
              </button>
            </template>

            <template v-else-if="!readOnly">
              <button
                type="button"
                class="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-60"
                :disabled="saving"
                @click="saveDraft(true)"
              >
                <Icon name="material-symbols:save-outline-rounded" class="text-base" aria-hidden="true" />
                {{ t('wiki.editor.save') }}
              </button>
              <button
                v-if="canMarkReviewed"
                type="button"
                class="btn-secondary inline-flex items-center gap-1.5"
                @click="markReviewed"
              >
                <Icon name="material-symbols:verified-outline-rounded" class="text-base" aria-hidden="true" />
                {{ t('wiki.editor.markReviewed') }}
              </button>
              <button
                v-if="mustSubmit"
                type="button"
                class="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
                :disabled="saving"
                @click="submitReview"
              >
                <Icon name="material-symbols:send-outline-rounded" class="text-base" aria-hidden="true" />
                {{ t('wiki.editor.submitReview') }}
              </button>
              <button
                v-else
                type="button"
                class="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
                :disabled="saving"
                @click="publish"
              >
                <Icon name="material-symbols:publish-rounded" class="text-base" aria-hidden="true" />
                {{ t('wiki.editor.publish') }}
              </button>
            </template>
          </div>
        </template>
      </CommonCard>
    </template>
  </Page>

  <CommonModal v-model="confirmArchive" :title="t('wiki.editor.archiveConfirmTitle')">
    <p class="text-sm text-base-700">{{ t('wiki.editor.archiveConfirmText') }}</p>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="confirmArchive = false">{{ t('wiki.editor.cancel') }}</button>
        <button type="button" class="btn-primary" @click="archive">{{ t('wiki.editor.archive') }}</button>
      </div>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { useReturnTarget } from '~/composables/useReturnTarget'
import { useToast } from '~/composables/useToast'
import type { TabOverviewItem } from '~/composables/useTabOverviewLayout'
import type { WikiArticleDetailResult } from '~/server/utils/wiki/detail'
import type { WikiTreeResponse } from '~/server/api/wiki/tree.get'
import type { CreateWikiArticleResponse } from '~/server/api/wiki/articles/create.post'
import type { SaveWikiAttachmentsResponse } from '~/server/api/wiki/articles/[id]/attachments.put'
import type { WikiSubjectOptionsResponse } from '~/server/api/wiki/access/subject-options.get'
import type { WikiTagsResponse } from '~/server/api/wiki/tags/index.get'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { WikiAttachment, WikiChecklistView, WikiTag, WikiTreeArticle, WikiTreeSpace } from '~/types/wiki'
import type { AttachmentSelection } from '~/types/attachment'

defineEmits<{
  (e: 'openMenu'): void
}>()

const AUTOSAVE_DELAY = 5000

const { t } = useI18n()
const { pageMeta } = usePage()
const { goToReturnTarget } = useReturnTarget('Wiki')
const toast = useToast()

const articleId = ref<number | null>(pageMeta.value?.articleId ? Number(pageMeta.value.articleId) : null)
const isCreate = computed(() => articleId.value === null)

const EDIT_TABS = ['content', 'checklists', 'settings', 'attachments', 'access', 'history']

const loading = ref(true)
const saving = ref(false)
const readOnly = ref(false)
const errors = ref<string[]>([])
const activeTab = ref(EDIT_TABS.includes(String(pageMeta.value?.tab)) ? String(pageMeta.value?.tab) : 'content')
const confirmArchive = ref(false)
const attachments = ref<WikiAttachment[]>([])
const attachmentSelection = ref<AttachmentSelection>({ documentIds: [], fileIds: [] })
const attachmentsSaving = ref(false)
const checklists = ref<WikiChecklistView[]>([])
const spaces = ref<WikiTreeSpace[]>([])
const status = ref<string>('draft')
const requiresReview = ref(false)
const accessLevel = ref<'read' | 'write' | 'admin'>('read')
const revisionListRef = ref<{ reload: () => void } | null>(null)
const openFieldMenu = ref<string | null>(null)

const positionOptions = ref<Array<{ id: number, label: string }>>([])
const subdivisionOptions = ref<Array<{ id: number, label: string }>>([])

const availableTags = ref<WikiTag[]>([])
const tagQuery = ref('')

const form = reactive({
  spaceId: Number(pageMeta.value?.spaceId ?? 0),
  parentId: pageMeta.value?.parentId ? Number(pageMeta.value.parentId) : null as number | null,
  title: '',
  slug: '',
  summary: '',
  markdown: '',
  reviewIntervalDays: '' as string | number,
  tagIds: [] as number[],
})

const owner = reactive({
  positionId: null as number | null,
  subdivisionId: null as number | null,
  createGrant: true,
})

function snapshotOwner() {
  return JSON.stringify({
    positionId: owner.positionId,
    subdivisionId: owner.subdivisionId,
    createGrant: owner.createGrant,
  })
}

// The owner lives behind its own endpoint, so it is tracked separately but saved together with
// the draft - one "save" for the whole editor.
let savedOwnerSnapshot = snapshotOwner()

const dirty = ref(false)
const savingDraft = ref(false)
const lastSavedAt = ref<Date | null>(null)
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let suppressAutosave = false
let savedSnapshot = ''

function snapshotForm() {
  return JSON.stringify({
    title: form.title,
    slug: form.slug,
    summary: form.summary,
    parentId: form.parentId,
    markdown: form.markdown,
    reviewIntervalDays: form.reviewIntervalDays,
    tagIds: form.tagIds,
  })
}
// Once the author edits the slug by hand, the title stops rewriting it.
const slugTouched = ref(false)

const tabs = computed<TabOverviewItem[]>(() => [
  { key: 'content', label: t('wiki.editor.tabs.content') },
  { key: 'checklists', label: t('wiki.editor.tabs.checklists') },
  { key: 'settings', label: t('wiki.editor.tabs.settings') },
  { key: 'attachments', label: t('wiki.editor.tabs.attachments') },
  { key: 'access', label: t('wiki.editor.tabs.access') },
  { key: 'history', label: t('wiki.editor.tabs.history') },
])

// One history button for the whole editor, showing exactly what the visible tab edits — the tab
// components deliberately don't render their own so there is never a second button on screen.
const HISTORY_TABLES_BY_TAB: Record<string, string[]> = {
  content: ['wiki_articles:id'],
  settings: ['wiki_articles:id', 'wiki_article_tags'],
  checklists: [
    'wiki_checklists',
    'wiki_checklist_items>wiki_checklists:article_id',
    'wiki_checklist_runs>wiki_checklists:article_id',
  ],
  attachments: ['file_attachments:entity_id;entity_type=wiki_article', 'entity_documents:entity_id;entity_type=wiki_article'],
  access: ['wiki_access_grants:scope_id;scope_type=article'],
  history: ['wiki_article_revisions'],
}

const historyTables = computed(() => HISTORY_TABLES_BY_TAB[activeTab.value] ?? [])

const writableSpaces = computed(() => spaces.value.filter(space => space.accessLevel !== 'read'))

function flatten(nodes: WikiTreeArticle[], depth = 0, into: Array<{ id: number, label: string }> = []) {
  for (const node of nodes) {
    into.push({ id: node.id, label: `${'— '.repeat(depth)}${node.title}` })
    flatten(node.children, depth + 1, into)
  }
  return into
}

const parentOptions = computed(() => {
  const space = spaces.value.find(entry => entry.id === form.spaceId)
  if (!space) return []
  return flatten(space.articles).filter(option => option.id !== articleId.value)
})

const spaceLabel = computed(() => writableSpaces.value.find(space => space.id === form.spaceId)?.title ?? '')
const parentLabel = computed(() => parentOptions.value.find(option => option.id === form.parentId)?.label ?? t('wiki.editor.fields.noParent'))
const ownerPositionLabel = computed(() => positionOptions.value.find(option => option.id === owner.positionId)?.label ?? t('wiki.editor.fields.noOwner'))
const ownerSubdivisionLabel = computed(() => subdivisionOptions.value.find(option => option.id === owner.subdivisionId)?.label ?? t('wiki.editor.fields.noOwner'))

function selectSpace(spaceId: number) {
  form.spaceId = spaceId
  form.parentId = null
  openFieldMenu.value = null
}

function selectParent(parentId: number | null) {
  form.parentId = parentId
  openFieldMenu.value = null
}

function selectOwnerPosition(positionId: number | null) {
  owner.positionId = positionId
  openFieldMenu.value = null
}

function selectOwnerSubdivision(subdivisionId: number | null) {
  owner.subdivisionId = subdivisionId
  openFieldMenu.value = null
}

const selectedTags = computed(() => form.tagIds
  .map(tagId => availableTags.value.find(tag => tag.id === tagId))
  .filter((tag): tag is WikiTag => Boolean(tag)))

const tagOptions = computed<SearchSelectOption<number>[]>(() => availableTags.value
  .filter(tag => !form.tagIds.includes(tag.id))
  .map(tag => ({ key: tag.id, label: tag.label, value: tag.id })))

function addTag(tagId: number) {
  if (!form.tagIds.includes(tagId)) form.tagIds.push(tagId)
  tagQuery.value = ''
}

function removeTag(tagId: number) {
  form.tagIds = form.tagIds.filter(entry => entry !== tagId)
}

const mustSubmit = computed(() => requiresReview.value && accessLevel.value !== 'admin')
const canMarkReviewed = computed(() => accessLevel.value === 'admin' && status.value === 'published')

const draftStateLabel = computed(() => {
  if (savingDraft.value) return t('wiki.editor.draftSaving')
  if (dirty.value) return t('wiki.editor.draftUnsaved')
  if (lastSavedAt.value) return t('wiki.editor.draftSaved')
  return ''
})

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function onTitleInput() {
  if (!slugTouched.value && isCreate.value) form.slug = slugify(form.title)
}

async function loadSpaces() {
  const res = await $fetch<WikiTreeResponse>('/api/wiki/tree', { query: { includeDrafts: '1' } })
  spaces.value = res.ok ? res.spaces : []
  if (isCreate.value && !form.spaceId && writableSpaces.value[0]) {
    form.spaceId = writableSpaces.value[0].id
  }
}

async function loadTags() {
  const res = await $fetch<WikiTagsResponse>('/api/wiki/tags')
  availableTags.value = res.ok ? res.tags.map(tag => ({ id: tag.id, slug: tag.slug, label: tag.label })) : []
}

async function loadOwnerOptions() {
  for (const [type, target] of [['position', positionOptions], ['subdivision', subdivisionOptions]] as const) {
    const res = await $fetch<WikiSubjectOptionsResponse>('/api/wiki/access/subject-options', { query: { type, q: '' } })
    target.value = res.ok ? res.options.map(option => ({ id: option.id, label: option.label })) : []
  }
}

async function loadArticle() {
  if (articleId.value === null) {
    loading.value = false
    return
  }

  const res = await $fetch<WikiArticleDetailResult>(`/api/wiki/articles/${articleId.value}`)
  if (!res.ok) {
    errors.value = [res.error]
    loading.value = false
    return
  }

  suppressAutosave = true

  const article = res.article
  form.spaceId = article.spaceId
  form.parentId = article.parentId
  form.title = article.title
  form.slug = article.slug
  form.summary = article.summary
  // The draft is what the editor works on; without one, editing starts from the published version.
  form.markdown = article.draftMd ?? article.contentMd ?? ''
  form.tagIds = article.tags.map(tag => Number(tag.id))
  owner.positionId = article.owner.position_id
  owner.subdivisionId = article.owner.subdivision_id
  attachments.value = article.attachments
  attachmentSelection.value = {
    documentIds: [...article.attachmentSelection.documentIds],
    fileIds: [...article.attachmentSelection.fileIds],
  }
  checklists.value = article.checklists
  status.value = article.status
  requiresReview.value = article.requiresReview
  accessLevel.value = article.accessLevel
  readOnly.value = article.accessLevel === 'read'
  slugTouched.value = true
  dirty.value = false
  loading.value = false
  savedSnapshot = snapshotForm()
  savedOwnerSnapshot = snapshotOwner()

  await nextTick()
  suppressAutosave = false
}

async function reload() {
  await loadArticle()
  revisionListRef.value?.reload()
}

useAppRefresh().onRefresh(async () => { await Promise.all([loadSpaces(), loadTags(), loadOwnerOptions()]) })

function scheduleAutosave() {
  if (suppressAutosave || isCreate.value || readOnly.value) return
  dirty.value = true
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => { saveDraft(false) }, AUTOSAVE_DELAY)
}

async function saveDraft(explicit: boolean) {
  if (isCreate.value || readOnly.value || articleId.value === null) return
  if (!explicit && !dirty.value) return

  const contentChanged = snapshotForm() !== savedSnapshot
  const ownerChanged = snapshotOwner() !== savedOwnerSnapshot

  if (!contentChanged && !ownerChanged) {
    dirty.value = false
    return
  }

  savingDraft.value = true
  errors.value = []

  try {
    if (!await persistOwner()) return

    if (contentChanged) {
      const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/articles/${articleId.value}`, {
        method: 'PUT',
        body: {
          title: form.title,
          slug: form.slug,
          summary: form.summary,
          parentId: form.parentId,
          draftMd: form.markdown,
          reviewIntervalDays: form.reviewIntervalDays === '' ? null : Number(form.reviewIntervalDays),
          tagIds: form.tagIds,
        },
      })

      if (!res.ok) {
        errors.value = [res.error ?? t('wiki.errors.saveFailed')]
        return
      }

      savedSnapshot = snapshotForm()
    }

    dirty.value = false
    lastSavedAt.value = new Date()
    if (explicit) toast.success(t('wiki.editor.savedToast'))
  } finally {
    savingDraft.value = false
  }
}

async function create() {
  errors.value = []
  if (!form.title.trim()) {
    errors.value = [t('wiki.errors.titleRequired')]
    return
  }
  if (!form.spaceId) {
    errors.value = [t('wiki.errors.spaceRequired')]
    return
  }

  saving.value = true
  try {
    const res = await $fetch<CreateWikiArticleResponse>('/api/wiki/articles/create', {
      method: 'POST',
      body: {
        spaceId: form.spaceId,
        parentId: form.parentId,
        title: form.title,
        slug: form.slug || slugify(form.title),
        summary: form.summary,
        markdown: form.markdown,
      },
    })

    if (!res.ok) {
      errors.value = [res.error]
      return
    }

    articleId.value = res.articleId
    dirty.value = false
    toast.success(t('wiki.editor.createdToast'))
    await loadArticle()
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (articleId.value === null) return
  await saveDraft(false)

  saving.value = true
  errors.value = []
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/articles/${articleId.value}/publish`, {
      method: 'POST',
      body: { changeNote: '' },
    })

    if (!res.ok) {
      errors.value = [res.error ?? t('wiki.errors.saveFailed')]
      return
    }

    toast.success(t('wiki.editor.publishedToast'))
    dirty.value = false
    goToReturnTarget({ articleId: articleId.value })
  } finally {
    saving.value = false
  }
}

async function submitReview() {
  if (articleId.value === null) return
  await saveDraft(false)

  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/articles/${articleId.value}/submit-review`, {
    method: 'POST',
  })

  if (!res.ok) {
    errors.value = [res.error ?? t('wiki.errors.saveFailed')]
    return
  }

  toast.success(t('wiki.editor.submittedToast'))
  await loadArticle()
}

async function markReviewed() {
  if (articleId.value === null) return
  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/articles/${articleId.value}/mark-reviewed`, {
    method: 'POST',
  })

  if (!res.ok) {
    errors.value = [res.error ?? t('wiki.errors.saveFailed')]
    return
  }
  toast.success(t('wiki.editor.reviewedToast'))
}

async function archive() {
  confirmArchive.value = false
  if (articleId.value === null) return

  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/articles/${articleId.value}`, { method: 'DELETE' })
  if (!res.ok) {
    errors.value = [res.error ?? t('wiki.errors.saveFailed')]
    return
  }

  toast.success(t('wiki.editor.archivedToast'))
  dirty.value = false
  goToReturnTarget()
}

/** Persists the owner assignment when it changed. Returns false when the server rejected it. */
async function persistOwner() {
  if (articleId.value === null) return false
  if (snapshotOwner() === savedOwnerSnapshot) return true

  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/articles/${articleId.value}/owner`, {
    method: 'PUT',
    body: {
      ownerPositionId: owner.positionId,
      ownerSubdivisionId: owner.subdivisionId,
      createGrant: owner.createGrant,
    },
  })

  if (!res.ok) {
    errors.value = [res.error ?? t('wiki.errors.saveFailed')]
    return false
  }

  savedOwnerSnapshot = snapshotOwner()
  return true
}

async function saveAttachments(next: AttachmentSelection) {
  if (articleId.value === null) return

  const previous = attachmentSelection.value
  attachmentSelection.value = next
  attachmentsSaving.value = true

  try {
    const res = await $fetch<SaveWikiAttachmentsResponse>(`/api/wiki/articles/${articleId.value}/attachments`, {
      method: 'PUT',
      body: { attachments: next },
    })

    if (!res.ok) {
      attachmentSelection.value = previous
      toast.error(res.error)
      return
    }

    attachments.value = res.attachments
    toast.success(t('wiki.attachments.savedToast'))
  } catch {
    attachmentSelection.value = previous
    toast.error(t('wiki.errors.saveFailed'))
  } finally {
    attachmentsSaving.value = false
  }
}

function cancel() {
  if (dirty.value && import.meta.client && !window.confirm(t('wiki.editor.unsavedWarning'))) return
  goToReturnTarget()
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

watch(
  () => [
    form.title, form.slug, form.summary, form.markdown, form.parentId, form.reviewIntervalDays,
    form.tagIds, owner.positionId, owner.subdivisionId, owner.createGrant,
  ],
  scheduleAutosave,
  { deep: true },
)

onMounted(() => {
  if (import.meta.client) window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  if (import.meta.client) window.removeEventListener('beforeunload', onBeforeUnload)
})

loadSpaces()
loadTags()
loadOwnerOptions()
loadArticle()
</script>
