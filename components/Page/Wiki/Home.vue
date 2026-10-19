<template>
  <Page :headline1="t('wiki.title')" @open-menu="$emit('openMenu')">
    <template #header>
      <div class="flex flex-1 flex-wrap justify-end gap-2">
        <button type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="openGlossary">
          <Icon name="material-symbols:dictionary-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.glossary.title') }}
        </button>
        <button
          v-if="canManage"
          type="button"
          class="btn-secondary inline-flex items-center gap-1.5"
          @click="setPage('WikiAdmin')"
        >
          <Icon name="material-symbols:settings-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.admin.title') }}
        </button>
        <button v-if="canEdit" type="button" class="btn-primary inline-flex items-center gap-1.5" @click="createArticle">
          <Icon name="material-symbols:add-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.home.newArticle') }}
        </button>
      </div>
    </template>

    <template #cards>
      <CommonCard>
        <p class="text-base text-base-600">{{ t('wiki.subtitle') }}</p>
        <PageWikiNavigationSearchPanel :spaces="spaces" :initial-tag="initialTag" @open="openArticle" />
        <p class="flex items-center gap-1 text-xs text-base-400">
          <Icon name="material-symbols:translate-rounded" class="text-sm" aria-hidden="true" />
          {{ t('wiki.contentLanguageHint') }}
        </p>
      </CommonCard>

      <div
        v-if="staleCount > 0"
        class="col-span-12 space-y-3 rounded-xl border-l-4 border-warning-400 bg-warning-50 px-4 py-3 text-sm text-warning-900"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="flex items-center gap-2">
            <Icon name="material-symbols:warning-outline-rounded" class="shrink-0 text-lg" aria-hidden="true" />
            {{ t('wiki.home.staleBanner', { count: staleCount }) }}
          </span>
          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-warning-300 bg-white/70 px-3 py-1 font-medium transition-colors hover:bg-white"
            :aria-expanded="staleOpen"
            @click="staleOpen = !staleOpen"
          >
            {{ staleOpen ? t('wiki.home.staleHide') : t('wiki.home.staleShow') }}
            <Icon
              :name="staleOpen ? 'material-symbols:expand-less-rounded' : 'material-symbols:expand-more-rounded'"
              class="text-base"
              aria-hidden="true"
            />
          </button>
        </div>
        <PageWikiAdminStaleList v-if="staleOpen" return-page="Wiki" />
      </div>

      <CommonCard
        v-if="visiblePaths.length"
        :title="recommendedPaths.length ? t('wiki.path.recommended') : t('wiki.path.more')"
        :description="t('wiki.path.recommendedHint')"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <button
            v-for="path in recommendedPaths.length ? recommendedPaths : otherPaths"
            :key="path.id"
            type="button"
            class="cursor-pointer rounded-xl border border-base-200 p-4 text-left transition-colors hover:border-accent-300 hover:bg-accent-50/50"
            @click="openPath(path.id)"
          >
            <span class="flex items-center gap-2">
              <Icon :name="path.icon" class="shrink-0 text-lg text-accent-500" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate font-semibold text-base-900">{{ path.title }}</span>
              <span
                v-if="!path.isPublished"
                class="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-800"
              >{{ t('wiki.admin.paths.draft') }}</span>
            </span>
            <span v-if="path.description" class="mt-1 block text-sm leading-relaxed text-base-600">{{ path.description }}</span>

            <span class="mt-3 flex items-center justify-between text-xs text-base-500">
              <span>{{ t('wiki.path.progress', { done: path.doneCount, total: path.totalCount }) }}</span>
              <span class="font-semibold text-base-600">{{ percent(path) }} %</span>
            </span>
            <span
              class="mt-1 block h-2 w-full overflow-hidden rounded-full bg-base-200"
              role="progressbar"
              :aria-valuenow="percent(path)"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="t('wiki.path.progress', { done: path.doneCount, total: path.totalCount })"
            >
              <span
                class="block h-full rounded-full bg-accent-500 transition-all"
                :style="{ width: `${percent(path)}%` }"
              ></span>
            </span>

            <span class="mt-3 flex items-center gap-1 text-sm font-medium text-accent-700">
              {{ path.doneCount ? t('wiki.path.continue') : t('wiki.path.start') }}
              <Icon name="material-symbols:arrow-forward-rounded" class="text-base" aria-hidden="true" />
            </span>
          </button>
        </div>

        <details v-if="recommendedPaths.length && otherPaths.length" class="text-sm">
          <summary class="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden gap-1.5 font-medium text-base-600 hover:text-base-900">
            <Icon name="material-symbols:expand-more-rounded" class="text-base text-base-400" aria-hidden="true" />
            {{ t('wiki.path.more') }}
            <span class="text-xs font-normal text-base-400">({{ otherPaths.length }})</span>
          </summary>
          <ul class="-mx-2 mt-1">
            <li v-for="path in otherPaths" :key="path.id">
              <button type="button" class="wiki-link-row" @click="openPath(path.id)">
                <Icon :name="path.icon" class="shrink-0 text-base text-base-400" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate">{{ path.title }}</span>
                <Icon name="material-symbols:chevron-right-rounded" class="wiki-link-chevron" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </details>
      </CommonCard>

      <CommonCard class="xl:col-span-8" icon="material-symbols:folder-open-outline-rounded" :title="t('wiki.home.spaces')">
        <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
        <p v-else-if="!spaces.length" class="text-sm text-base-500">{{ t('wiki.home.noSpaces') }}</p>

        <div v-else class="grid gap-3 sm:grid-cols-2">
          <section
            v-for="space in spaces"
            :key="space.id"
            class="rounded-xl border border-base-200 p-4"
          >
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                <Icon :name="space.icon" class="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 class="min-w-0 flex-1 font-semibold text-base-900">{{ space.title }}</h3>
              <a
                :href="`/api/wiki/spaces/${space.id}/export-pdf`"
                target="_blank"
                rel="noopener noreferrer"
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base-400 transition-colors hover:bg-base-100 hover:text-base-700"
                :title="t('wiki.home.exportSpacePdf')"
                :aria-label="t('wiki.home.exportSpacePdf')"
              >
                <Icon name="material-symbols:picture-as-pdf-outline-rounded" class="h-5 w-5" aria-hidden="true" />
              </a>
            </div>
            <p v-if="space.description" class="mt-2 text-sm leading-relaxed text-base-600">{{ space.description }}</p>

            <ul v-if="space.articles.length" class="-mx-2 mt-2 text-sm">
              <li v-for="article in space.articles.slice(0, 5)" :key="article.id">
                <button type="button" class="wiki-link-row" @click="openArticle(article.id)">
                  <Icon name="material-symbols:article-outline-rounded" class="shrink-0 text-base text-base-300" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">{{ article.title }}</span>
                  <Icon name="material-symbols:chevron-right-rounded" class="wiki-link-chevron" aria-hidden="true" />
                </button>
              </li>
            </ul>
            <p v-else class="mt-3 text-sm text-base-400">{{ t('wiki.home.empty') }}</p>

            <p v-if="space.articles.length > 5" class="mt-1 pl-2 text-xs text-base-400">
              {{ t('wiki.home.moreArticles', { count: space.articles.length - 5 }) }}
            </p>
          </section>
        </div>
      </CommonCard>

      <div class="col-span-12 space-y-5 xl:col-span-4">
        <CommonCard icon="material-symbols:history-rounded" :title="t('wiki.home.recentlyUpdated')">
          <ul v-if="recentlyUpdated.length" class="-mx-2 text-sm">
            <li v-for="entry in recentlyUpdated" :key="entry.id">
              <button type="button" class="wiki-link-row" @click="openArticle(entry.id)">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ entry.title }}</span>
                  <span class="block truncate text-xs text-base-500">{{ entry.spaceTitle }} · {{ formatDate(entry.changedAt) }}</span>
                </span>
                <Icon name="material-symbols:chevron-right-rounded" class="wiki-link-chevron" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <p v-else class="text-sm text-base-400">{{ t('wiki.home.empty') }}</p>
        </CommonCard>

        <CommonCard v-if="recentlyRead.length" icon="material-symbols:bookmark-outline-rounded" :title="t('wiki.home.recentlyRead')">
          <ul class="-mx-2 text-sm">
            <li v-for="entry in recentlyRead" :key="entry.id">
              <button type="button" class="wiki-link-row" @click="openArticle(entry.id)">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ entry.title }}</span>
                  <span class="block truncate text-xs text-base-500">{{ entry.spaceTitle }}</span>
                </span>
                <Icon name="material-symbols:chevron-right-rounded" class="wiki-link-chevron" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </CommonCard>
      </div>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useAuth } from '~/composables/useAuth'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget } from '~/composables/useReturnTarget'
import type { WikiHomeArticle, WikiHomeResponse } from '~/server/api/wiki/home.get'
import type { WikiPathView, WikiTreeSpace } from '~/types/wiki'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()
const { formatDate } = useLocaleFormatters()
const { pageMeta, setPage } = usePage()

// Arriving from a tag chip on an article preselects that tag in the search panel.
const initialTag = pageMeta.value?.tag ? String(pageMeta.value.tag) : null

const spaces = ref<WikiTreeSpace[]>([])
const recentlyUpdated = ref<WikiHomeArticle[]>([])
const recentlyRead = ref<WikiHomeArticle[]>([])
const paths = ref<WikiPathView[]>([])
const staleCount = ref(0)
const staleOpen = ref(false)
const loading = ref(true)
const canEdit = ref(false)
const canManage = computed(() => hasPermission('wiki.manage'))

const recommendedPaths = computed(() => paths.value.filter(path => path.recommended))
const otherPaths = computed(() => paths.value.filter(path => !path.recommended))
const visiblePaths = computed(() => paths.value)

function percent(path: WikiPathView) {
  return path.totalCount ? Math.round((path.doneCount / path.totalCount) * 100) : 0
}

function openPath(pathId: number) {
  setPage('WikiPath', { pathId })
}

function openArticle(articleId: number) {
  setPage('WikiArticle', { articleId })
}

function openGlossary() {
  setPage('WikiGlossary', { returnTarget: buildReturnTarget('Wiki') })
}

function createArticle() {
  setPage('WikiArticleEdit', { returnTarget: buildReturnTarget('Wiki') })
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch<WikiHomeResponse>('/api/wiki/home')
    if (!res.ok) return
    spaces.value = res.spaces
    paths.value = res.paths
    recentlyUpdated.value = res.recentlyUpdated
    recentlyRead.value = res.recentlyRead
    staleCount.value = res.staleCount
    canEdit.value = res.canEditSomewhere
  } finally {
    loading.value = false
  }
}

load()
</script>
