<template>
  <PageHomeWidgetFrame
    :title="recommendedPath ? t('wiki.path.recommended') : t('home.widgets.wiki.title')"
    :icon="recommendedPath ? recommendedPath.icon : 'material-symbols:menu-book-rounded'"
    :loading="loading"
    :is-empty="!recommendedPath && !articles.length"
    empty-icon="material-symbols:menu-book-outline-rounded"
    :empty-text="t('home.widgets.wiki.empty')"
  >
    <template #subtitle>
      <p class="mt-0.5 truncate text-xs text-base-300">
        {{ recommendedPath ? recommendedPath.title : t('home.widgets.wiki.subtitle') }}
      </p>
    </template>

    <template #action>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-base-200 transition cursor-pointer hover:bg-white/20 hover:text-white"
        @click="setPage('Wiki')"
      >
        {{ t('home.widgets.showAll') }}
        <Icon name="material-symbols:arrow-forward-rounded" class="text-sm" />
      </button>
    </template>

    <div v-if="recommendedPath" class="flex h-full flex-col gap-3">
      <p v-if="recommendedPath.description" class="text-sm text-base-600">{{ recommendedPath.description }}</p>

      <div>
        <p class="text-xs text-base-500">
          {{ t('wiki.path.progress', { done: recommendedPath.doneCount, total: recommendedPath.totalCount }) }}
        </p>
        <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-base-200">
          <div class="h-full rounded-full bg-accent-500" :style="{ width: `${pathPercent}%` }"></div>
        </div>
      </div>

      <button
        v-if="recommendedPath.nextItem"
        type="button"
        class="cursor-pointer rounded-lg border border-base-200 p-3 text-left transition hover:bg-base-50"
        @click="openPath()"
      >
        <span class="block text-xs text-base-500">{{ t('wiki.path.next') }}</span>
        <span class="mt-0.5 block truncate font-medium text-base-900">{{ recommendedPath.nextItem.title }}</span>
      </button>

      <button type="button" class="btn-primary mt-auto w-full" @click="openPath()">
        {{ recommendedPath.doneCount ? t('wiki.path.continue') : t('wiki.path.start') }}
      </button>
    </div>

    <ul v-else class="flex h-full flex-col gap-2">
      <li v-for="article in articles" :key="article.id">
        <button
          type="button"
          class="w-full cursor-pointer rounded-lg border border-base-200 p-3 text-left transition hover:bg-base-50"
          @click="openArticle(article.id)"
        >
          <span class="flex items-center justify-between gap-2">
            <span class="truncate text-xs text-base-500">{{ article.spaceTitle }}</span>
            <span v-if="article.changedAt" class="shrink-0 text-xs text-base-400">{{ formatDate(article.changedAt) }}</span>
          </span>
          <span class="mt-0.5 block truncate font-medium text-base-900">{{ article.title }}</span>
          <span v-if="article.summary" class="mt-0.5 block truncate text-sm text-base-600">{{ article.summary }}</span>
        </button>
      </li>
    </ul>
  </PageHomeWidgetFrame>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { WikiSpotlightResponse } from '~/server/api/wiki/spotlight.get'
import type { WikiHomeArticle } from '~/server/api/wiki/home.get'
import type { WikiPathView } from '~/types/wiki'

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const { setPage } = usePage()

const loading = ref(true)
const articles = ref<WikiHomeArticle[]>([])
const recommendedPath = ref<WikiPathView | null>(null)

const pathPercent = computed(() => {
  const path = recommendedPath.value
  if (!path?.totalCount) return 0
  return Math.round((path.doneCount / path.totalCount) * 100)
})

function openPath() {
  if (recommendedPath.value) setPage('WikiPath', { pathId: recommendedPath.value.id })
}

function openArticle(articleId: number) {
  setPage('WikiArticle', { articleId })
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch<WikiSpotlightResponse>('/api/wiki/spotlight')
    articles.value = res.ok ? res.recentlyPublished : []
    recommendedPath.value = res.ok ? res.recommendedPath : null
  } finally {
    loading.value = false
  }
}

onMounted(load)
useAppRefresh().onRefresh(load)
</script>
