<template>
  <Page :headline1="space?.title || t('wiki.title')" @open-menu="$emit('openMenu')">
    <template #header>
      <div class="flex flex-1 flex-wrap items-center justify-end gap-2">
        <button type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="goToReturnTarget()">
          <Icon name="material-symbols:arrow-back-rounded" class="text-base" aria-hidden="true" />
          {{ hasExplicitReturn ? t('wiki.article.back') : t('wiki.article.backToWiki') }}
        </button>
        <a
          v-if="space"
          :href="`/api/wiki/spaces/${space.id}/export-pdf`"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-secondary inline-flex items-center gap-1.5"
        >
          <Icon name="material-symbols:picture-as-pdf-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.exportPdf') }}
        </a>
        <button
          v-if="canManageAccess"
          type="button"
          class="btn-secondary inline-flex items-center gap-1.5"
          @click="editOpen = true"
        >
          <Icon name="material-symbols:edit-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.space.edit') }}
        </button>
        <button
          v-if="canManageAccess"
          type="button"
          class="btn-secondary inline-flex items-center gap-1.5"
          @click="accessOpen = true"
        >
          <Icon name="material-symbols:shield-person-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.space.access') }}
        </button>
        <button
          v-if="canWrite"
          type="button"
          class="btn-primary inline-flex items-center gap-1.5"
          @click="createArticle"
        >
          <Icon name="material-symbols:add-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.home.newArticle') }}
        </button>
      </div>
    </template>

    <template #cards>
      <CommonCard v-if="loading" class="col-span-12">
        <p class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
      </CommonCard>

      <CommonCard v-else-if="!space" class="col-span-12">
        <p class="text-sm text-base-500">{{ error || t('wiki.space.notFound') }}</p>
      </CommonCard>

      <template v-else>
        <CommonCard class="col-span-12">
          <div class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
              <Icon :name="space.icon" class="h-6 w-6" aria-hidden="true" />
            </span>
            <div class="min-w-0 flex-1 space-y-1">
              <p v-if="space.description" class="max-w-[70ch] text-base leading-relaxed text-base-600">{{ space.description }}</p>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-base-500">
                <span v-if="ownerLabel" class="inline-flex items-center gap-1">
                  <Icon name="material-symbols:person-outline-rounded" class="text-sm text-base-400" aria-hidden="true" />
                  {{ t('wiki.article.owner') }}: {{ ownerLabel }}
                </span>
                <span v-if="space.requires_review" class="inline-flex items-center gap-1">
                  <Icon name="material-symbols:fact-check-outline-rounded" class="text-sm text-base-400" aria-hidden="true" />
                  {{ t('wiki.space.requiresReviewHint') }}
                </span>
                <span v-if="levelHint" class="inline-flex items-center gap-1">
                  <Icon name="material-symbols:key-outline-rounded" class="text-sm text-base-400" aria-hidden="true" />
                  {{ levelHint }}
                </span>
              </div>
            </div>
            <CommonStatusBadge v-if="space.isArchived" :label="t('wiki.admin.spaces.archived')" tone="warning" />
          </div>
        </CommonCard>

        <CommonCard
          v-if="space.todo.inReview.length || space.todo.due.length"
          class="col-span-12"
          icon="material-symbols:checklist-rounded"
          :title="t('wiki.space.todo.title')"
        >
          <div class="grid gap-4 md:grid-cols-2">
            <section v-if="space.todo.inReview.length" class="space-y-1">
              <h3 class="text-sm font-semibold text-base-800">{{ t('wiki.space.todo.inReview', { count: space.todo.inReview.length }) }}</h3>
              <p class="text-xs text-base-500">{{ canManageAccess ? t('wiki.space.todo.inReviewHintAdmin') : t('wiki.space.todo.inReviewHint') }}</p>
              <ul class="-mx-2 text-sm">
                <li v-for="entry in space.todo.inReview" :key="entry.id">
                  <button type="button" class="wiki-link-row" @click="openArticleById(entry.id)">
                    <Icon name="material-symbols:rate-review-outline-rounded" class="shrink-0 text-base text-base-300" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">{{ entry.title }}</span>
                    <span v-if="entry.since" class="shrink-0 text-xs text-base-400">{{ formatDate(entry.since) }}</span>
                    <Icon name="material-symbols:chevron-right-rounded" class="wiki-link-chevron" aria-hidden="true" />
                  </button>
                </li>
              </ul>
            </section>
            <section v-if="space.todo.due.length" class="space-y-1">
              <h3 class="text-sm font-semibold text-base-800">{{ t('wiki.space.todo.due', { count: space.todo.due.length }) }}</h3>
              <p class="text-xs text-base-500">{{ t('wiki.space.todo.dueHint') }}</p>
              <ul class="-mx-2 text-sm">
                <li v-for="entry in space.todo.due" :key="entry.id">
                  <button type="button" class="wiki-link-row" @click="openArticleById(entry.id)">
                    <Icon name="material-symbols:warning-outline-rounded" class="shrink-0 text-base text-warning-500" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">{{ entry.title }}</span>
                    <span v-if="entry.since" class="shrink-0 text-xs text-base-400">{{ t('wiki.space.todo.dueSince', { date: formatDate(entry.since) }) }}</span>
                    <Icon name="material-symbols:chevron-right-rounded" class="wiki-link-chevron" aria-hidden="true" />
                  </button>
                </li>
              </ul>
            </section>
          </div>
        </CommonCard>

        <CommonCard
          class="col-span-12"
          icon="material-symbols:account-tree-outline-rounded"
          :title="t('wiki.space.articles', { count: articleCount })"
        >
          <PageWikiNavigationTreeSidebar
            v-if="space.articles.length"
            :spaces="[space]"
            hide-space-headers
            :editable="canWrite"
            @select="openArticle"
            @reorder="saveOrder"
          />
          <div v-else class="space-y-3">
            <p class="text-sm text-base-500">{{ t('wiki.home.empty') }}</p>
            <button v-if="canWrite" type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="createArticle">
              <Icon name="material-symbols:add-rounded" class="text-base" aria-hidden="true" />
              {{ t('wiki.space.createFirst') }}
            </button>
          </div>
        </CommonCard>
      </template>

      <PageWikiAdminSpaceEditModal
        v-model="editOpen"
        :space="editableSpace"
        :limited="!hasPermission('wiki.manage')"
        @saved="load"
      />

      <PageWikiSpaceAccessModal
        :space="accessOpen ? space : null"
        @close="accessOpen = false"
        @changed="load"
      />
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget, useReturnTarget } from '~/composables/useReturnTarget'
import type { WikiSpaceDetail, WikiSpaceDetailResponse } from '~/server/api/wiki/spaces/[id].get'
import type { WikiReorderItem } from '~/components/Page/Wiki/Navigation/TreeSidebar.vue'
import type { WikiSpaceAdminView, WikiTreeArticle } from '~/types/wiki'

defineEmits<{ (e: 'openMenu'): void }>()

const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { formatDate } = useLocaleFormatters()
const { pageMeta, setPage } = usePage()
const { goToReturnTarget } = useReturnTarget('Wiki')

const space = ref<WikiSpaceDetail | null>(null)
const loading = ref(true)
const error = ref('')
const accessOpen = ref(false)
const editOpen = ref(false)

// Shareable links carry the id and/or the slug (`#WikiSpace?spaceId=3&slug=finanzen`); the id wins.
const spaceId = computed(() => Number(pageMeta.value?.spaceId ?? 0))
const spaceSlug = computed(() => String(pageMeta.value?.slug ?? '').trim())
const hasExplicitReturn = computed(() => Boolean(pageMeta.value?.returnTarget))
const canWrite = computed(() => space.value?.accessLevel === 'write' || space.value?.accessLevel === 'admin')
const canManageAccess = computed(() => space.value?.accessLevel === 'admin')
function countArticles(nodes: WikiTreeArticle[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countArticles(node.children), 0)
}
const articleCount = computed(() => (space.value ? countArticles(space.value.articles) : 0))

const ownerLabel = computed(() =>
  [space.value?.ownerPositionName, space.value?.ownerSubdivisionName].filter(Boolean).join(' · '),
)

const levelHint = computed(() => {
  if (space.value?.accessLevel === 'admin') return t('wiki.space.levelAdmin')
  if (space.value?.accessLevel === 'write') return t('wiki.space.levelWrite')
  return ''
})

async function load() {
  if (!spaceId.value && !spaceSlug.value) {
    space.value = null
    loading.value = false
    return
  }

  loading.value = true
  error.value = ''
  try {
    const res = spaceId.value
      ? await apiFetch<WikiSpaceDetailResponse>(`/api/wiki/spaces/${spaceId.value}`)
      : await apiFetch<WikiSpaceDetailResponse>('/api/wiki/spaces/by-slug', { query: { slug: spaceSlug.value } })
    if (!res.ok) {
      space.value = null
      error.value = res.error
      return
    }
    space.value = res.space
  } finally {
    loading.value = false
  }
}

// The space editor works on the admin view of a space.
const editableSpace = computed<WikiSpaceAdminView | null>(() => {
  const value = space.value
  if (!value) return null
  return {
    id: value.id,
    slug: value.slug,
    title: value.title,
    description: value.description,
    icon: value.icon,
    position: value.position,
    requiresReview: Boolean(value.requires_review),
    isArchived: value.isArchived,
    ownerPositionId: value.ownerPositionId,
    ownerPositionName: value.ownerPositionName,
    ownerSubdivisionId: value.ownerSubdivisionId,
    ownerSubdivisionName: value.ownerSubdivisionName,
    articleCount: articleCount.value,
  }
})

function openArticleById(articleId: number) {
  setPage('WikiArticle', { articleId, returnTarget: returnHere() })
}

function returnHere() {
  return buildReturnTarget('WikiSpace', space.value ? { spaceId: space.value.id, slug: space.value.slug } : { spaceId: spaceId.value })
}

function openArticle(target: { id: number, slug: string, spaceSlug: string }) {
  setPage('WikiArticle', { articleId: target.id, slug: `${target.spaceSlug}/${target.slug}`, returnTarget: returnHere() })
}

function createArticle() {
  if (!space.value) return
  setPage('WikiArticleEdit', { spaceId: space.value.id, returnTarget: returnHere() })
}

async function saveOrder(items: WikiReorderItem[]) {
  const res = await apiFetch<{ ok: boolean, error?: string }>('/api/wiki/articles/reorder', {
    method: 'POST',
    body: { items },
  })

  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    return
  }

  toast.success(t('wiki.tree.reorderedToast'))
  await load()
}

watch([spaceId, spaceSlug], () => { load() }, { immediate: true })

useAppRefresh().onRefresh(load)
</script>
