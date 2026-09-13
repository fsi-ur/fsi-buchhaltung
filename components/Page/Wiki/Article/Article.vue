<template>
  <Page :headline1="article?.title || t('wiki.title')" @open-menu="$emit('openMenu')">
    <template #header>
      <div class="flex flex-1 flex-wrap items-center justify-end gap-2">
        <button type="button" class="btn-secondary inline-flex items-center gap-1.5 xl:hidden" @click="treeOpen = true">
          <Icon name="material-symbols:menu-book-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.tree.open') }}
        </button>
        <button type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="goBack">
          <Icon name="material-symbols:arrow-back-rounded" class="text-base" aria-hidden="true" />
          {{ hasExplicitReturn ? t('wiki.article.back') : t('wiki.article.backToWiki') }}
        </button>
        <a
          v-if="article"
          :href="`/api/wiki/articles/${article.id}/export-pdf`"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-secondary inline-flex items-center gap-1.5"
        >
          <Icon name="material-symbols:picture-as-pdf-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.exportPdf') }}
        </a>
        <button
          v-if="article && canEdit"
          type="button"
          class="btn-secondary inline-flex items-center gap-1.5"
          @click="createSubarticle"
        >
          <Icon name="material-symbols:note-add-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.article.newSubarticle') }}
        </button>
        <button
          v-if="article && canEdit"
          type="button"
          class="btn-primary inline-flex items-center gap-1.5"
          @click="editArticle"
        >
          <Icon name="material-symbols:edit-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.article.edit') }}
        </button>
      </div>
    </template>

    <template #cards>
      <aside class="hidden xl:col-span-3 xl:block">
        <div class="scroll-panel sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-xl bg-white p-4 pr-2 shadow-lg">
          <h2 class="section-title">{{ t('wiki.tree.title') }}</h2>
          <PageWikiNavigationTreeSidebar
            :spaces="spaces"
            :current-article-id="article?.id ?? null"
            :editable="canEdit"
            @select="openArticle"
            @reorder="saveOrder"
          />
        </div>
      </aside>

      <div class="col-span-12 space-y-5 xl:col-span-9">
        <CommonCard v-if="loading">
          {{ t('wiki.loading') }}
        </CommonCard>

        <CommonValidationSummary v-else-if="error" :errors="[error]" :title="t('wiki.article.notFoundTitle')" />

        <template v-else-if="article">
          <CommonCard v-if="path && currentStep">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <Icon :name="path.icon" class="shrink-0 text-lg text-base-500" aria-hidden="true" />
                <button type="button" class="cursor-pointer truncate font-semibold text-base-900 hover:underline" @click="openPath">
                  {{ path.title }}
                </button>
              </div>
              <span class="text-xs text-base-500">
                {{ t('wiki.path.stepOf', { number: currentIndex + 1, total: path.items.length }) }}
              </span>
            </div>

            <div
              class="h-2 w-full overflow-hidden rounded-full bg-base-200"
              role="progressbar"
              :aria-valuenow="pathPercent"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="t('wiki.path.progress', { done: path.doneCount, total: path.totalCount })"
            >
              <div class="h-full rounded-full bg-accent-500 transition-all" :style="{ width: `${pathPercent}%` }"></div>
            </div>

            <p v-if="currentStep.note" class="text-sm text-base-600">{{ currentStep.note }}</p>
          </CommonCard>

          <CommonCard>
            <nav
              class="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-base-500"
              :aria-label="t('wiki.article.breadcrumb')"
            >
              <template v-for="(crumb, position) in article.breadcrumbs" :key="`${crumb.type}-${crumb.id}`">
                <Icon
                  v-if="position > 0"
                  name="material-symbols:chevron-right-rounded"
                  class="text-base text-base-300"
                  aria-hidden="true"
                />
                <button
                  v-if="crumb.type === 'article'"
                  type="button"
                  class="cursor-pointer rounded underline decoration-base-300 underline-offset-2 transition-colors hover:text-accent-700 hover:decoration-accent-400"
                  @click="openArticleById(crumb.id!)"
                >
                  {{ crumb.title }}
                </button>
                <span v-else>{{ crumb.title }}</span>
              </template>
            </nav>

            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="text-2xl font-bold tracking-tight text-base-900">{{ article.title }}</h2>
                <p v-if="article.summary" class="mt-2 max-w-[70ch] text-base leading-relaxed text-base-600">{{ article.summary }}</p>
              </div>
              <CommonStatusBadge
                v-if="article.status !== 'published'"
                :label="t(`wiki.status.${article.status}`)"
                tone="base"
              />
            </div>

            <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-base-100 pt-3 text-xs text-base-500">
              <span v-if="ownerLabel" class="inline-flex items-center gap-1">
                <Icon name="material-symbols:person-outline-rounded" class="text-sm text-base-400" aria-hidden="true" />
                {{ t('wiki.article.owner') }}: {{ ownerLabel }}
              </span>
              <span v-if="article.publishedAt" class="inline-flex items-center gap-1">
                <Icon name="material-symbols:update-rounded" class="text-sm text-base-400" aria-hidden="true" />
                {{ t('wiki.article.updatedAt', { date: formatDate(article.publishedAt) }) }}
              </span>
              <span v-if="article.reviewedAt" class="inline-flex items-center gap-1">
                <Icon name="material-symbols:verified-outline-rounded" class="text-sm text-base-400" aria-hidden="true" />
                {{ t('wiki.article.reviewedAt', { date: formatDate(article.reviewedAt) }) }}
              </span>
              <button
                v-for="tag in article.tags"
                :key="tag.id"
                type="button"
                class="cursor-pointer rounded-full bg-base-100 px-2 py-0.5 font-medium text-base-600 transition-colors hover:bg-accent-100 hover:text-accent-800"
                :title="t('wiki.article.tagSearch', { label: tag.label })"
                @click="openTag(tag.slug)"
              >{{ tag.label }}</button>
            </div>

            <p
              v-if="article.isStale"
              class="flex items-start gap-2 rounded-lg border-l-4 border-warning-400 bg-warning-50 px-3 py-2 text-sm text-warning-900"
            >
              <Icon name="material-symbols:warning-outline-rounded" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
              {{ t('wiki.article.stale') }}
            </p>
            <p
              v-if="article.hasDraft && canEdit"
              class="flex items-start gap-2 rounded-lg border-l-4 border-info-400 bg-info-50 px-3 py-2 text-sm text-info-900"
            >
              <Icon name="material-symbols:edit-note-rounded" class="mt-0.5 shrink-0 text-base" aria-hidden="true" />
              {{ t('wiki.article.hasDraft') }}
            </p>
          </CommonCard>

          <details
            v-if="article.headings.length > 1"
            class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:p-6 sm:shadow-lg xl:hidden"
          >
            <summary class="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden gap-2 text-sm font-semibold text-base-800">
              <Icon name="material-symbols:toc-rounded" class="text-base text-base-400" aria-hidden="true" />
              {{ t('wiki.article.toc') }}
              <span class="text-xs font-normal text-base-400">({{ article.headings.length }})</span>
            </summary>
            <div class="mt-3">
              <PageWikiArticleTableOfContents :headings="article.headings" />
            </div>
          </details>

          <div class="grid grid-cols-12 gap-5">
            <CommonCard class="xl:col-span-8 lg:p-8">
              <p
                v-if="article.status !== 'published'"
                class="mb-5 flex items-start gap-2 rounded-lg bg-base-100 px-3 py-2 text-sm text-base-700"
              >
                <Icon name="material-symbols:visibility-off-outline-rounded" class="mt-0.5 shrink-0 text-base text-base-500" aria-hidden="true" />
                {{ t('wiki.article.notPublished') }}
              </p>

              <PageWikiArticleBody
                v-if="article.contentHtml"
                class="wiki-article-measure"
                :html="article.contentHtml"
                :links="article.links"
                :article-id="article.id"
                :checklists="article.checklists"
              />
              <p v-else class="text-sm text-base-500">{{ t('wiki.article.emptyContent') }}</p>
            </CommonCard>

            <div class="col-span-12 space-y-5 xl:col-span-4">
              <div
                v-if="article.headings.length > 1"
                class="scroll-panel hidden max-h-[calc(100vh-3rem)] overflow-y-auto rounded-xl bg-white p-6 shadow-lg xl:sticky xl:top-6 xl:block"
              >
                <h3 class="section-title flex items-center gap-1.5">
                  <Icon name="material-symbols:toc-rounded" class="text-base text-base-400" aria-hidden="true" />
                  {{ t('wiki.article.toc') }}
                </h3>
                <PageWikiArticleTableOfContents :headings="article.headings" />
              </div>

              <CommonCard v-if="article.children.length" icon="material-symbols:account-tree-outline-rounded" :title="t('wiki.article.subarticles')">
                <ul class="-mx-2 text-sm">
                  <li v-for="child in article.children" :key="child.id">
                    <button type="button" class="wiki-link-row" @click="openArticleById(child.id)">
                      <span class="min-w-0 flex-1 truncate font-medium">{{ child.title }}</span>
                      <Icon name="material-symbols:chevron-right-rounded" class="wiki-link-chevron" aria-hidden="true" />
                    </button>
                  </li>
                </ul>
              </CommonCard>

              <CommonCard v-if="article.attachments.length" icon="material-symbols:attach-file-rounded" :title="t('wiki.article.attachments')">
                <ul class="-mx-2 text-sm">
                  <li v-for="attachment in article.attachments.filter(entry => entry.fileId && !entry.unavailable)" :key="attachment.key">
                    <a
                      :href="`/api/files/${attachment.fileId}`"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="wiki-link-row"
                    >
                      <Icon
                        :name="attachment.kind === 'document' ? 'material-symbols:library-books-outline-rounded' : 'material-symbols:draft-outline-rounded'"
                        class="shrink-0 text-base text-base-400"
                        aria-hidden="true"
                      />
                      <span class="min-w-0 flex-1 truncate font-medium">{{ attachment.title }}</span>
                      <Icon name="material-symbols:download-rounded" class="wiki-link-chevron" aria-hidden="true" />
                    </a>
                  </li>
                </ul>
              </CommonCard>
            </div>
          </div>

          <div v-if="path && currentStep" class="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              class="btn-secondary inline-flex min-w-0 max-w-[45%] items-center gap-1.5 disabled:opacity-60"
              :disabled="savingStep"
              @click="goToStep(-1)"
            >
              <Icon name="material-symbols:arrow-back-rounded" class="shrink-0 text-base" aria-hidden="true" />
              <span class="truncate">{{ prevStep ? prevStep.title : t('wiki.path.prevStep') }}</span>
            </button>

            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-60"
              :class="currentStep.done
                ? 'border-success-300 bg-success-50 text-success-700'
                : 'border-base-300 text-base-600 hover:border-base-400 hover:bg-base-50'"
              :aria-pressed="currentStep.done"
              :disabled="savingStep"
              @click="setStepDone(currentStep, !currentStep.done)"
            >
              <Icon
                :name="currentStep.done ? 'material-symbols:check-circle-rounded' : 'material-symbols:circle-outline'"
                class="text-base"
                aria-hidden="true"
              />
              {{ currentStep.done ? t('wiki.path.stepDone') : t('wiki.path.markDone') }}
            </button>

            <button
              type="button"
              class="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
              :disabled="savingStep"
              @click="goToStep(1)"
            >
              {{ nextStep ? t('wiki.path.nextStep') : t('wiki.path.finish') }}
              <Icon
                :name="nextStep ? 'material-symbols:arrow-forward-rounded' : 'material-symbols:flag-rounded'"
                class="text-base"
                aria-hidden="true"
              />
            </button>
          </div>

          <div v-else-if="article.prev || article.next" class="grid gap-3 sm:grid-cols-2">
            <button
              v-if="article.prev"
              type="button"
              class="flex cursor-pointer items-center gap-3 rounded-xl border border-base-200 bg-white p-4 text-left transition-colors hover:border-accent-300 hover:bg-accent-50"
              @click="openArticleById(article.prev.id)"
            >
              <Icon name="material-symbols:arrow-back-rounded" class="shrink-0 text-lg text-base-400" aria-hidden="true" />
              <span class="min-w-0">
                <span class="block text-xs uppercase tracking-wide text-base-400">{{ t('wiki.article.previous') }}</span>
                <span class="block truncate font-medium text-base-800">{{ article.prev.title }}</span>
              </span>
            </button>
            <span v-else class="hidden sm:block"></span>
            <button
              v-if="article.next"
              type="button"
              class="flex cursor-pointer items-center justify-end gap-3 rounded-xl border border-base-200 bg-white p-4 text-right transition-colors hover:border-accent-300 hover:bg-accent-50 sm:col-start-2"
              @click="openArticleById(article.next.id)"
            >
              <span class="min-w-0">
                <span class="block text-xs uppercase tracking-wide text-base-400">{{ t('wiki.article.next') }}</span>
                <span class="block truncate font-medium text-base-800">{{ article.next.title }}</span>
              </span>
              <Icon name="material-symbols:arrow-forward-rounded" class="shrink-0 text-lg text-base-400" aria-hidden="true" />
            </button>
          </div>
        </template>
      </div>
    </template>
  </Page>

  <CommonModal v-model="treeOpen" :title="t('wiki.tree.title')" width-class="max-w-lg">
    <PageWikiNavigationTreeSidebar :spaces="spaces" :current-article-id="article?.id ?? null" @select="openFromDrawer" />
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget, useReturnTarget } from '~/composables/useReturnTarget'
import { useToast } from '~/composables/useToast'
import type { WikiReorderItem } from '../Navigation/TreeSidebar.vue'
import type { WikiArticleDetailPayload, WikiArticleDetailResult } from '~/server/utils/wiki/detail'
import type { WikiTreeResponse } from '~/server/api/wiki/tree.get'
import type { WikiPathDetailResponse } from '~/server/api/wiki/paths/[id].get'
import type { WikiPathItemView, WikiPathView, WikiTreeSpace } from '~/types/wiki'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const { pageMeta, setPage } = usePage()
const toast = useToast()
const { goToReturnTarget } = useReturnTarget('Wiki')

const hasExplicitReturn = computed(() => Boolean(pageMeta.value?.returnTarget))

const article = ref<WikiArticleDetailPayload | null>(null)
const spaces = ref<WikiTreeSpace[]>([])
const loading = ref(true)
const error = ref('')
const treeOpen = ref(false)

const pathId = computed(() => (pageMeta.value?.pathId ? Number(pageMeta.value.pathId) : null))
const path = ref<WikiPathView | null>(null)
const savingStep = ref(false)

const currentIndex = computed(() => {
  if (!path.value || !article.value) return -1
  return path.value.items.findIndex(item => item.articleId === article.value!.id)
})
const currentStep = computed(() => (currentIndex.value >= 0 ? path.value!.items[currentIndex.value] : null))
const prevStep = computed(() => (currentIndex.value > 0 ? path.value!.items[currentIndex.value - 1] : null))
const nextStep = computed(() => {
  if (!path.value || currentIndex.value < 0) return null
  return path.value.items[currentIndex.value + 1] ?? null
})
const pathPercent = computed(() => {
  if (!path.value?.totalCount) return 0
  return Math.round((path.value.doneCount / path.value.totalCount) * 100)
})

const canEdit = computed(() => article.value?.accessLevel === 'write' || article.value?.accessLevel === 'admin')

const ownerLabel = computed(() => {
  const owner = article.value?.owner
  if (!owner) return ''
  return [owner.position_name, owner.subdivision_name].filter(Boolean).join(' · ')
})

async function loadTree() {
  const res = await $fetch<WikiTreeResponse>('/api/wiki/tree', { query: { includeDrafts: '1' } })
  spaces.value = res.ok ? res.spaces : []
}

async function loadArticle() {
  loading.value = true
  error.value = ''

  const articleId = Number(pageMeta.value?.articleId ?? 0)
  const slug = String(pageMeta.value?.slug ?? '')

  try {
    const res = articleId
      ? await $fetch<WikiArticleDetailResult>(`/api/wiki/articles/${articleId}`)
      : slug
        ? await $fetch<WikiArticleDetailResult>('/api/wiki/articles/by-slug', { query: { slug } })
        : { ok: false as const, error: t('wiki.article.notFound') }

    if (!res.ok) {
      article.value = null
      error.value = res.error
      return
    }

    article.value = res.article
  } catch (err: any) {
    article.value = null
    error.value = String(err)
  } finally {
    loading.value = false
  }
}

function openArticleById(articleId: number) {
  treeOpen.value = false
  setPage('WikiArticle', { articleId })
}

function openArticle(target: { id: number, slug: string, spaceSlug: string }) {
  setPage('WikiArticle', { articleId: target.id, slug: `${target.spaceSlug}/${target.slug}` })
}

function openTag(tagSlug: string) {
  setPage('Wiki', { tag: tagSlug })
}

function openFromDrawer(target: { id: number, slug: string, spaceSlug: string }) {
  treeOpen.value = false
  openArticle(target)
}

function goBack() {
  goToReturnTarget()
}

async function loadPath() {
  if (pathId.value === null) {
    path.value = null
    return
  }

  const res = await $fetch<WikiPathDetailResponse>(`/api/wiki/paths/${pathId.value}`)
  path.value = res.ok ? res.path : null
}

async function setStepDone(step: WikiPathItemView, done: boolean) {
  if (pathId.value === null) return false

  savingStep.value = true
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/paths/${pathId.value}/progress`, {
      method: 'POST',
      body: { itemId: step.id, done },
    })

    if (!res.ok) {
      toast.error(res.error ?? t('wiki.errors.saveFailed'))
      return false
    }

    await loadPath()
    return true
  } finally {
    savingStep.value = false
  }
}

async function goToStep(direction: -1 | 1) {
  const step = currentStep.value
  if (!step || pathId.value === null) return

  if (direction === 1 && !step.done && !await setStepDone(step, true)) return

  const target = direction === 1 ? nextStep.value : prevStep.value

  if (!target) {
    if (direction === 1) {
      const complete = path.value && path.value.doneCount === path.value.totalCount
      if (complete) toast.success(t('wiki.path.completedToast'))
    }
    setPage('WikiPath', { pathId: pathId.value })
    return
  }

  setPage('WikiArticle', {
    articleId: target.articleId,
    pathId: pathId.value,
    returnTarget: buildReturnTarget('WikiPath', { pathId: pathId.value }),
  })
}

function openPath() {
  if (pathId.value !== null) setPage('WikiPath', { pathId: pathId.value })
}

async function saveOrder(items: WikiReorderItem[]) {
  const res = await $fetch<{ ok: boolean, error?: string }>('/api/wiki/articles/reorder', {
    method: 'POST',
    body: { items },
  })

  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    return
  }

  toast.success(t('wiki.tree.reorderedToast'))
  await loadTree()
}

function createSubarticle() {
  if (!article.value) return
  setPage('WikiArticleEdit', {
    spaceId: article.value.spaceId,
    parentId: article.value.id,
    returnTarget: buildReturnTarget('WikiArticle', { articleId: article.value.id }),
  })
}

function editArticle() {
  if (!article.value) return
  setPage('WikiArticleEdit', {
    articleId: article.value.id,
    returnTarget: buildReturnTarget('WikiArticle', { articleId: article.value.id }),
  })
}

watch(
  () => [pageMeta.value?.articleId, pageMeta.value?.slug],
  () => { loadArticle() },
  { immediate: true },
)

watch(pathId, () => { loadPath() }, { immediate: true })

loadTree()

useAppRefresh().onRefresh(async () => { await Promise.all([loadTree(), loadArticle(), loadPath()]) })
</script>
