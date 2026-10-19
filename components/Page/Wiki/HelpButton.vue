<template>
  <button
    v-if="visible"
    type="button"
    class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors"
    :class="dark
      ? 'bg-white/10 text-white hover:bg-white/20'
      : ['text-base-400 hover:bg-base-100 hover:text-base-700', { 'text-base-300': !entries.length }]"
    :title="buttonTitle"
    :aria-label="buttonTitle"
    @click="openPanel"
  >
    <Icon name="material-symbols:help-outline-rounded" class="h-6 w-6" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <div
      v-if="panelOpen"
      class="fixed inset-0 z-50 flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      :aria-label="t('wiki.help.panelTitle')"
      @click.self="closePanel"
    >
      <section class="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <header class="flex items-start gap-3 border-b border-base-200 p-4">
          <button
            v-if="selectedId && entries.length > 1"
            type="button"
            class="cursor-pointer text-base-500 hover:text-base-800"
            :title="t('wiki.help.backToList')"
            :aria-label="t('wiki.help.backToList')"
            @click="selectedId = null"
          >
            <Icon name="material-symbols:arrow-back-rounded" class="h-5 w-5" aria-hidden="true" />
          </button>

          <div class="min-w-0 flex-1">
            <p class="text-xs uppercase tracking-wide text-base-400">{{ t('wiki.help.panelTitle') }}</p>
            <h2 class="truncate text-lg font-semibold text-base-900">
              {{ article?.title || selectedEntry?.title || t('wiki.help.panelTitle') }}
            </h2>
          </div>

          <button
            type="button"
            class="cursor-pointer text-base-500 hover:text-base-800"
            :title="t('wiki.help.close')"
            :aria-label="t('wiki.help.close')"
            @click="closePanel"
          >
            <Icon name="material-symbols:close-rounded" class="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div class="flex-1 space-y-4 overflow-y-auto p-4">
          <template v-if="!entries.length">
            <p class="text-sm text-base-600">{{ t('wiki.help.empty') }}</p>
            <button v-if="canManage" type="button" class="btn-secondary" @click="goToMapping">
              {{ t('wiki.help.link') }}
            </button>
            <p v-else class="text-xs text-base-400">{{ t('wiki.help.linkHint') }}</p>
          </template>

          <ul v-else-if="!selectedId" class="space-y-2">
            <li v-for="entry in entries" :key="entry.id">
              <button
                type="button"
                class="w-full cursor-pointer rounded-lg border border-base-200 p-3 text-left hover:border-accent-300 hover:bg-accent-50"
                @click="selectedId = entry.articleId"
              >
                <span class="block font-medium text-base-900">{{ entry.title }}</span>
                <span v-if="entry.summary" class="mt-0.5 block text-sm text-base-600">{{ entry.summary }}</span>
                <span class="mt-0.5 block text-xs text-base-400">{{ entry.spaceTitle }}</span>
              </button>
            </li>
          </ul>

          <template v-else>
            <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
            <CommonValidationSummary v-else-if="error" :errors="[error]" :title="t('wiki.article.notFoundTitle')" />
            <template v-else-if="article">
              <p v-if="article.summary" class="text-sm text-base-600">{{ article.summary }}</p>
              <PageWikiArticleBody
                v-if="article.contentHtml"
                :html="article.contentHtml"
                :links="article.links"
                :article-id="article.id"
                :checklists="article.checklists"
              />
              <p v-else class="text-sm text-base-500">{{ t('wiki.article.emptyContent') }}</p>
            </template>
          </template>
        </div>

        <footer v-if="selectedId" class="flex justify-end gap-3 border-t border-base-200 p-4">
          <button type="button" class="btn-primary" @click="openFullArticle">
            {{ t('wiki.help.openArticle') }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useBodyScrollLock } from '~/composables/useBodyScrollLock'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { useViewAsSimulation } from '~/composables/useViewAsSimulation'
import { useWikiHelp } from '~/composables/useWikiHelp'
import { buildReturnTarget } from '~/composables/useReturnTarget'
import type { WikiPageHelpArticle } from '~/server/api/wiki/page-help.get'
import type { WikiArticleDetailPayload, WikiArticleDetailResult } from '~/server/utils/wiki/detail'

const props = defineProps<{
  /** The app page the help is looked up for - defaults to the page currently rendered. */
  page?: string
  /** Optional tab/section within that page, matching `wiki_page_help.section_key`. */
  section?: string
  /** Light-on-dark styling, for use inside a dark custom header instead of Page.vue's default one. */
  dark?: boolean
}>()

const { t } = useI18n()
const { user, hasPermission } = useAuth()
const { currentPage, pageMeta, setPage } = usePage()
const { loadPageHelp } = useWikiHelp()
const { simulation } = useViewAsSimulation()

const allEntries = ref<WikiPageHelpArticle[]>([])
const panelOpen = ref(false)
const selectedId = ref<number | null>(null)
const article = ref<WikiArticleDetailPayload | null>(null)
const loading = ref(false)
const error = ref('')

useBodyScrollLock(toRef(panelOpen))

const pageName = computed(() => props.page || currentPage.value)
const sectionKey = computed(() => (props.section || '').trim().toLowerCase())
const canManage = computed(() => hasPermission('wiki.manage'))
const canEdit = computed(() => hasPermission('wiki.edit'))

/** Section-specific articles win; without any, the page-wide mapping (empty section key) is used. */
const entries = computed(() => {
  const pageWide = allEntries.value.filter(entry => !entry.sectionKey)
  if (!sectionKey.value) return pageWide
  const forSection = allEntries.value.filter(entry => entry.sectionKey === sectionKey.value)
  return forSection.length ? forSection : pageWide
})

const selectedEntry = computed(() => entries.value.find(entry => entry.articleId === selectedId.value) ?? null)
const visible = computed(() => Boolean(user.value) && (entries.value.length > 0 || canEdit.value))
const buttonTitle = computed(() => (entries.value.length ? t('wiki.help.open') : t('wiki.help.link')))

async function load() {
  if (!user.value || !hasPermission('wiki.view')) {
    allEntries.value = []
    return
  }
  allEntries.value = await loadPageHelp(pageName.value)
}

async function loadArticle(articleId: number) {
  loading.value = true
  error.value = ''
  article.value = null

  try {
    const res = await apiFetch<WikiArticleDetailResult>(`/api/wiki/articles/${articleId}`)
    if (!res.ok) {
      error.value = res.error
      return
    }
    article.value = res.article
  } catch (err: any) {
    error.value = String(err)
  } finally {
    loading.value = false
  }
}

function openPanel() {
  const only = entries.value.length === 1 ? entries.value[0] : null
  selectedId.value = only ? only.articleId : null
  panelOpen.value = true
  if (selectedId.value) loadArticle(selectedId.value)
}

function closePanel() {
  panelOpen.value = false
}

function openFullArticle() {
  if (!selectedId.value) return
  const articleId = selectedId.value
  panelOpen.value = false
  setPage('WikiArticle', {
    articleId,
    returnTarget: buildReturnTarget(currentPage.value, pageMeta.value),
  })
}

function goToMapping() {
  panelOpen.value = false
  setPage('WikiAdmin', {
    tab: 'pageHelp',
    helpPageName: pageName.value,
    helpSectionKey: sectionKey.value,
    returnTarget: buildReturnTarget(currentPage.value, pageMeta.value),
  })
}

watch(selectedId, (articleId) => {
  if (panelOpen.value && articleId) loadArticle(articleId)
})

watch([pageName, () => user.value?.id, simulation], () => {
  panelOpen.value = false
  selectedId.value = null
  article.value = null
  load()
}, { immediate: true })
</script>
