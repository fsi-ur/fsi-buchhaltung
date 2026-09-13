<template>
  <CommonCard
    :title="editingId ? t('wiki.admin.glossary.editTitle') : t('wiki.admin.glossary.addTitle')"
    :description="t('wiki.admin.glossary.hint')"
  >
    <CommonValidationSummary v-if="errors.length" :errors="errors" :title="t('common.validationBlocked')" />

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="field">
        <label for="wiki-glossary-term">{{ t('wiki.admin.glossary.fields.term') }}</label>
        <input id="wiki-glossary-term" v-model="term" class="input" maxlength="120" />
        <p class="mt-1 text-xs text-base-400">{{ t('wiki.admin.glossary.fields.keyHint', { key: previewKey || '—' }) }}</p>
      </div>

      <div class="field">
        <label for="wiki-glossary-aliases">{{ t('wiki.admin.glossary.fields.aliases') }}</label>
        <input id="wiki-glossary-aliases" v-model="aliases" class="input" :placeholder="t('wiki.admin.glossary.fields.aliasesPlaceholder')" />
        <p class="mt-1 text-xs text-base-400">{{ t('wiki.admin.glossary.fields.aliasesHint') }}</p>
      </div>

      <div class="field sm:col-span-2">
        <label for="wiki-glossary-definition">{{ t('wiki.admin.glossary.fields.definition') }}</label>
        <textarea
          id="wiki-glossary-definition"
          v-model="shortDefinition"
          class="input min-h-24"
          maxlength="500"
        ></textarea>
      </div>

      <div class="field sm:col-span-2">
        <label>{{ t('wiki.admin.glossary.fields.article') }}</label>
        <CommonSearchSelect
          v-model="articleQuery"
          :options="articleOptions"
          :placeholder="t('wiki.admin.glossary.fields.articlePlaceholder')"
          :empty-text="t('wiki.search.empty')"
          :selected-label="selectedArticleLabel"
          menu-width="wide"
          @select="onSelectArticle"
          @clear-selection="selectedArticle = null"
        />
        <p class="mt-1 text-xs text-base-400">{{ t('wiki.admin.glossary.fields.articleHint') }}</p>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-primary" :disabled="!canSave || saving" @click="save">
        {{ editingId ? t('actions.save') : t('wiki.admin.glossary.add') }}
      </button>
      <button v-if="editingId" type="button" class="btn-secondary" @click="resetForm">
        {{ t('actions.cancel') }}
      </button>
    </div>
  </CommonCard>

  <CommonCard :title="t('wiki.admin.glossary.listTitle')">
    <template #actions>
      <PageAuditTableHistoryButton :tables="['wiki_glossary_terms', 'wiki_glossary_aliases']" :return-meta="{ tab: 'glossary' }" />
    </template>

    <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
    <p v-else-if="!terms.length" class="text-sm text-base-500">{{ t('wiki.admin.glossary.empty') }}</p>

    <ul v-else class="divide-y divide-base-100">
      <li v-for="entry in terms" :key="entry.id" class="flex flex-wrap items-start gap-2 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-2">
            <span class="font-semibold text-base-900">{{ entry.term }}</span>
            <code class="rounded bg-base-100 px-1.5 py-0.5 text-xs text-base-600">[[glossar:{{ entry.key }}]]</code>
          </div>
          <p class="mt-1 text-sm text-base-600">{{ entry.shortDefinition }}</p>
          <p v-if="entry.aliases.length" class="mt-1 text-xs text-base-400">
            {{ t('wiki.glossary.aliasesLabel') }}: {{ entry.aliases.join(', ') }}
          </p>
          <p v-if="entry.articleTitle" class="mt-1 text-xs text-base-500">
            {{ t('wiki.admin.glossary.linkedTo', { title: entry.articleTitle }) }}
          </p>
        </div>

        <div class="flex shrink-0 gap-3 text-xs">
          <button type="button" class="cursor-pointer text-accent-700 hover:underline" @click="edit(entry)">
            {{ t('actions.edit') }}
          </button>
          <button type="button" class="cursor-pointer text-danger-700 hover:underline" @click="askRemove(entry)">
            {{ t('actions.delete') }}
          </button>
        </div>
      </li>
    </ul>
  </CommonCard>

  <CommonModal v-model="confirmOpen" :title="t('wiki.admin.glossary.removeConfirmTitle')">
    <p class="text-sm text-base-600">{{ t('wiki.admin.glossary.removeConfirmText') }}</p>
    <template #footer>
      <button type="button" class="btn-secondary" @click="confirmOpen = false">{{ t('actions.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="remove">{{ t('actions.delete') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useWikiGlossary, wikiGlossaryKey } from '~/composables/useWikiGlossary'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { WikiGlossaryArticleOption, WikiGlossaryResponse } from '~/server/api/wiki/glossary/index.get'
import type { GlossaryTermView } from '~/server/utils/wiki/glossary'

const { t } = useI18n()
const toast = useToast()
const { invalidateGlossary } = useWikiGlossary()

const terms = ref<GlossaryTermView[]>([])
const articles = ref<WikiGlossaryArticleOption[]>([])
const loading = ref(true)
const saving = ref(false)
const errors = ref<string[]>([])

const editingId = ref<number | null>(null)
const term = ref('')
const shortDefinition = ref('')
const aliases = ref('')
const articleQuery = ref('')
const selectedArticle = ref<WikiGlossaryArticleOption | null>(null)

const confirmOpen = ref(false)
const pendingRemoval = ref<GlossaryTermView | null>(null)

const previewKey = computed(() => wikiGlossaryKey(term.value))
const canSave = computed(() => Boolean(term.value.trim() && shortDefinition.value.trim()))

const articleOptions = computed<SearchSelectOption<WikiGlossaryArticleOption>[]>(() => articles.value.map(article => ({
  key: article.id,
  label: `${article.title} · ${article.spaceTitle}`,
  value: article,
})))

const selectedArticleLabel = computed(() => (selectedArticle.value
  ? `${selectedArticle.value.title} · ${selectedArticle.value.spaceTitle}`
  : ''))

function onSelectArticle(option: unknown) {
  selectedArticle.value = option as WikiGlossaryArticleOption
  articleQuery.value = ''
}

function resetForm() {
  editingId.value = null
  term.value = ''
  shortDefinition.value = ''
  aliases.value = ''
  selectedArticle.value = null
  articleQuery.value = ''
  errors.value = []
}

function edit(entry: GlossaryTermView) {
  editingId.value = entry.id
  term.value = entry.term
  shortDefinition.value = entry.shortDefinition
  aliases.value = entry.aliases.join(', ')
  selectedArticle.value = articles.value.find(article => article.id === entry.articleId) ?? null
  errors.value = []
}

async function load() {
  loading.value = true
  try {
    const res = await $fetch<WikiGlossaryResponse>('/api/wiki/glossary')
    if (!res.ok) {
      errors.value = [res.error]
      return
    }
    terms.value = res.terms
    articles.value = res.articles
    errors.value = []
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!canSave.value || saving.value) return

  saving.value = true
  errors.value = []

  const body = {
    term: term.value.trim(),
    shortDefinition: shortDefinition.value.trim(),
    aliases: aliases.value.split(',').map(entry => entry.trim()).filter(Boolean),
    articleId: selectedArticle.value?.id ?? null,
  }

  try {
    const res = editingId.value
      ? await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/glossary/${editingId.value}`, { method: 'PUT', body })
      : await $fetch<{ ok: boolean, error?: string }>('/api/wiki/glossary/create', { method: 'POST', body })

    if (!res.ok) {
      errors.value = [res.error ?? t('wiki.errors.saveFailed')]
      return
    }

    invalidateGlossary()
    toast.success(t('wiki.admin.glossary.savedToast'))
    resetForm()
    await load()
  } finally {
    saving.value = false
  }
}

function askRemove(entry: GlossaryTermView) {
  pendingRemoval.value = entry
  confirmOpen.value = true
}

async function remove() {
  const entry = pendingRemoval.value
  if (!entry || saving.value) return

  saving.value = true
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/glossary/${entry.id}`, { method: 'DELETE' })

    if (!res.ok) {
      errors.value = [res.error ?? t('wiki.errors.saveFailed')]
      return
    }

    invalidateGlossary()
    if (editingId.value === entry.id) resetForm()
    toast.success(t('wiki.admin.glossary.removedToast'))
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
