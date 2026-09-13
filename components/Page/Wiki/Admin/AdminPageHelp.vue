<template>
  <CommonCard
    :title="t('wiki.admin.pageHelp.addTitle')"
    :description="t('wiki.admin.pageHelp.hint')"
  >
    <CommonValidationSummary v-if="errors.length" :errors="errors" :title="t('common.validationBlocked')" />

    <div class="flex flex-wrap items-end gap-3">
      <div class="field min-w-56 flex-1">
        <label>{{ t('wiki.admin.pageHelp.fields.page') }}</label>
        <CommonSearchSelect
          v-model="pageQuery"
          :options="pageOptions"
          :placeholder="t('wiki.admin.pageHelp.fields.pagePlaceholder')"
          :empty-text="t('wiki.search.empty')"
          :selected-label="selectedPageLabel"
          menu-width="wide"
          @select="onSelectPage"
          @clear-selection="clearPage"
        />
      </div>

      <div class="field min-w-40">
        <label for="wiki-help-section">{{ t('wiki.admin.pageHelp.fields.section') }}</label>
        <input
          id="wiki-help-section"
          v-model="sectionKey"
          class="input"
          list="wiki-help-section-suggestions"
          placeholder="z. B. receipts"
        />
        <datalist id="wiki-help-section-suggestions">
          <option v-for="key in sectionSuggestions" :key="key" :value="key" />
        </datalist>
      </div>

      <div class="field min-w-56 flex-1">
        <label>{{ t('wiki.admin.pageHelp.fields.article') }}</label>
        <CommonSearchSelect
          v-model="articleQuery"
          :options="articleOptions"
          :placeholder="t('wiki.admin.pageHelp.fields.articlePlaceholder')"
          :empty-text="t('wiki.search.empty')"
          :selected-label="selectedArticleLabel"
          menu-width="wide"
          @select="onSelectArticle"
          @clear-selection="clearArticle"
        />
      </div>

      <button type="button" class="btn-primary h-9.5" :disabled="!canAdd || saving" @click="addEntry">
        {{ t('wiki.admin.pageHelp.add') }}
      </button>
    </div>

    <p class="text-xs text-base-400">{{ t('wiki.admin.pageHelp.sectionHint') }}</p>
  </CommonCard>

  <CommonCard :title="t('wiki.admin.pageHelp.listTitle')">
    <template #actions>
      <PageAuditTableHistoryButton :tables="['wiki_page_help']" :return-meta="{ tab: 'pageHelp' }" />
    </template>

    <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
    <p v-else-if="!groups.length" class="text-sm text-base-500">{{ t('wiki.admin.pageHelp.empty') }}</p>

    <div v-else class="space-y-3">
      <section v-for="group in groups" :key="group.pageName" class="rounded-lg border border-base-200 p-3">
        <h3 class="font-semibold text-base-900">{{ pageLabel(group.pageName) }}</h3>
        <p class="text-xs text-base-400">{{ group.pageName }}</p>

        <ul class="mt-2 space-y-1">
          <li
            v-for="entry in group.entries"
            :key="entry.id"
            class="flex flex-wrap items-center gap-2 border-t border-base-100 py-2 text-sm first:border-t-0"
          >
            <span class="font-medium text-base-800">{{ entry.title }}</span>
            <span class="text-xs text-base-400">{{ entry.spaceTitle }}</span>
            <CommonStatusBadge
              v-if="entry.status !== 'published'"
              :label="t(`wiki.status.${entry.status}`)"
              tone="base"
            />
            <span v-if="entry.sectionKey" class="rounded-md bg-base-100 px-2 py-0.5 text-xs text-base-600">
              {{ t('wiki.admin.pageHelp.fields.section') }}: {{ entry.sectionKey }}
            </span>
            <button
              type="button"
              class="ml-auto cursor-pointer text-xs text-danger-700 hover:underline"
              @click="askRemove(entry)"
            >
              {{ t('wiki.admin.pageHelp.remove') }}
            </button>
          </li>
        </ul>
      </section>
    </div>
  </CommonCard>

  <CommonModal v-model="confirmOpen" :title="t('wiki.admin.pageHelp.removeConfirmTitle')">
    <p class="text-sm text-base-600">{{ t('wiki.admin.pageHelp.removeConfirmText') }}</p>
    <template #footer>
      <button type="button" class="btn-secondary" @click="confirmOpen = false">{{ t('actions.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="removeEntry">
        {{ t('wiki.admin.pageHelp.remove') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { useToast } from '~/composables/useToast'
import { useWikiHelp } from '~/composables/useWikiHelp'
import { PAGES } from '~/config/pages'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type {
  WikiPageHelpAdminArticle,
  WikiPageHelpAdminEntry,
  WikiPageHelpAdminResponse,
} from '~/server/api/wiki/page-help/admin.get'
import type { CreateWikiPageHelpResponse } from '~/server/api/wiki/page-help/create.post'

const { t } = useI18n()
const { pageMeta } = usePage()
const toast = useToast()
const { invalidatePageHelp } = useWikiHelp()

const entries = ref<WikiPageHelpAdminEntry[]>([])
const articles = ref<WikiPageHelpAdminArticle[]>([])
const loading = ref(true)
const saving = ref(false)
const errors = ref<string[]>([])

const pageQuery = ref('')
const selectedPage = ref<string>(String(pageMeta.value?.helpPageName ?? ''))
const articleQuery = ref('')
const selectedArticle = ref<WikiPageHelpAdminArticle | null>(null)
const sectionKey = ref(String(pageMeta.value?.helpSectionKey ?? ''))

const confirmOpen = ref(false)
const pendingRemoval = ref<WikiPageHelpAdminEntry | null>(null)

const pageNames = computed(() => Object.keys(PAGES).filter(name => name !== 'Login'))

const TAB_SECTIONS: Record<string, string[]> = {
  EventCreate: ['overview', 'timeline', 'tasks', 'checklists', 'shifts', 'cashRegister', 'details'],
  Finances: ['receipts', 'invoices', 'cashCounts', 'reimbursements', 'bankStatements', 'budgets'],
  MemberList: ['list', 'myData', 'fieldConfig'],
  Settings: ['general', 'association', 'spheres', 'costCentres', 'subdivisions', 'positions', 'users', 'permissions', 'app', 'notifications'],
  WikiAdmin: ['spaces', 'paths', 'glossary', 'pageHelp', 'stale'],
  WikiArticleEdit: ['content', 'checklists', 'settings', 'attachments', 'access', 'history'],
}

const sectionSuggestions = computed(() => TAB_SECTIONS[selectedPage.value] ?? [])

function pageLabel(name: string) {
  const page = PAGES[name]
  return page ? t(page.labelKey) : name
}

const pageOptions = computed<SearchSelectOption<string>[]>(() => pageNames.value.map(name => ({
  key: name,
  label: `${pageLabel(name)} (${name})`,
  value: name,
})))

const selectedPageLabel = computed(() => (selectedPage.value ? `${pageLabel(selectedPage.value)} (${selectedPage.value})` : ''))

const articleOptions = computed<SearchSelectOption<WikiPageHelpAdminArticle>[]>(() => articles.value.map(article => ({
  key: article.id,
  label: `${article.title} · ${article.spaceTitle}`,
  value: article,
})))

const selectedArticleLabel = computed(() => (selectedArticle.value ? `${selectedArticle.value.title} · ${selectedArticle.value.spaceTitle}` : ''))

const canAdd = computed(() => Boolean(selectedPage.value && selectedArticle.value))

const groups = computed(() => {
  const byPage = new Map<string, WikiPageHelpAdminEntry[]>()
  for (const entry of entries.value) {
    const list = byPage.get(entry.pageName)
    if (list) list.push(entry)
    else byPage.set(entry.pageName, [entry])
  }

  return [...byPage.entries()]
    .map(([pageName, list]) => ({ pageName, entries: list }))
    .sort((a, b) => pageLabel(a.pageName).localeCompare(pageLabel(b.pageName)))
})

function onSelectPage(option: unknown) {
  selectedPage.value = option as string
  pageQuery.value = ''
}

function clearPage() {
  selectedPage.value = ''
  pageQuery.value = ''
}

function onSelectArticle(option: unknown) {
  selectedArticle.value = option as WikiPageHelpAdminArticle
  articleQuery.value = ''
}

function clearArticle() {
  selectedArticle.value = null
  articleQuery.value = ''
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<WikiPageHelpAdminResponse>('/api/wiki/page-help/admin')
    if (!res.ok) {
      errors.value = [res.error]
      return
    }
    entries.value = res.entries
    articles.value = res.articles
    errors.value = []
  } finally {
    loading.value = false
  }
}

async function addEntry() {
  if (!canAdd.value || saving.value) return

  saving.value = true
  errors.value = []

  try {
    const res = await $fetch<CreateWikiPageHelpResponse>('/api/wiki/page-help/create', {
      method: 'POST',
      body: {
        pageName: selectedPage.value,
        sectionKey: sectionKey.value.trim(),
        articleId: selectedArticle.value!.id,
      },
    })

    if (!res.ok) {
      errors.value = [res.error]
      return
    }

    invalidatePageHelp(selectedPage.value)
    toast.success(t('wiki.admin.pageHelp.addedToast'))
    clearArticle()
    await load()
  } finally {
    saving.value = false
  }
}

function askRemove(entry: WikiPageHelpAdminEntry) {
  pendingRemoval.value = entry
  confirmOpen.value = true
}

async function removeEntry() {
  const entry = pendingRemoval.value
  if (!entry || saving.value) return

  saving.value = true
  errors.value = []

  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/page-help/${entry.id}`, { method: 'DELETE' })

    if (!res.ok) {
      errors.value = [res.error ?? t('wiki.errors.saveFailed')]
      return
    }

    invalidatePageHelp(entry.pageName)
    toast.success(t('wiki.admin.pageHelp.removedToast'))
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
