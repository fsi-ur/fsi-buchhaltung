<template>
  <Page :headline1="t('wiki.glossary.title')" @open-menu="$emit('openMenu')">
    <template #header>
      <div class="flex flex-1 flex-wrap items-center justify-end gap-2">
        <button type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="goToReturnTarget()">
          <Icon name="material-symbols:arrow-back-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.article.backToWiki') }}
        </button>
        <button
          v-if="canManage"
          type="button"
          class="btn-primary inline-flex items-center gap-1.5"
          @click="setPage('WikiAdmin', { tab: 'glossary' })"
        >
          <Icon name="material-symbols:edit-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.glossary.manage') }}
        </button>
      </div>
    </template>

    <template #cards>
      <div class="-mx-6 space-y-4 bg-white p-4 shadow-sm col-span-12 sm:mx-0 sm:rounded-xl sm:p-6 sm:shadow-lg">
        <p class="text-base text-base-600">{{ t('wiki.glossary.subtitle') }}</p>

        <div class="field max-w-md">
          <label for="wiki-glossary-search">{{ t('wiki.glossary.search') }}</label>
          <div class="relative">
            <Icon
              name="material-symbols:search-rounded"
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-base-400"
              aria-hidden="true"
            />
            <input
              id="wiki-glossary-search"
              v-model="search"
              class="input pl-9"
              type="search"
              :placeholder="t('wiki.glossary.searchPlaceholder')"
            />
          </div>
        </div>

        <nav v-if="!loading && groups.length > 1" class="flex flex-wrap gap-1" :aria-label="t('wiki.glossary.jumpTo')">
          <button
            v-for="group in groups"
            :key="`jump-${group.letter}`"
            type="button"
            class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-base-100 text-xs font-semibold text-base-600 transition-colors hover:bg-accent-100 hover:text-accent-700"
            @click="jumpTo(group.letter)"
          >{{ group.letter }}</button>
        </nav>

        <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
        <p v-else-if="!terms.length" class="text-sm text-base-500">{{ t('wiki.glossary.empty') }}</p>
        <p v-else-if="!filtered.length" class="text-sm text-base-500">{{ t('wiki.search.empty') }}</p>

        <div v-else class="space-y-5">
          <section v-for="group in groups" :key="group.letter" :id="`wiki-glossary-${group.letter}`" class="scroll-mt-24">
            <h2 class="mb-1 flex items-center gap-2 border-b border-base-100 pb-1 text-sm font-bold text-accent-600">
              {{ group.letter }}
              <span class="text-xs font-normal text-base-400">({{ group.terms.length }})</span>
            </h2>
            <dl class="divide-y divide-base-100">
              <div v-for="term in group.terms" :key="term.id" class="py-3">
                <dt class="flex flex-wrap items-baseline gap-2">
                  <span class="font-semibold text-base-900">{{ term.term }}</span>
                  <span v-if="term.aliases.length" class="text-xs text-base-400">
                    {{ t('wiki.glossary.aliasesLabel') }}: {{ term.aliases.join(', ') }}
                  </span>
                </dt>
                <dd class="mt-1 max-w-[70ch] text-sm leading-relaxed text-base-600">
                  {{ term.shortDefinition }}
                  <button
                    v-if="term.articleId"
                    type="button"
                    class="ml-1 inline-flex cursor-pointer items-center gap-0.5 font-medium text-accent-700 underline decoration-accent-300 underline-offset-2 hover:decoration-accent-600"
                    @click="openArticle(term.articleId)"
                  >
                    {{ term.articleTitle || t('wiki.glossary.readMore') }}
                    <Icon name="material-symbols:arrow-forward-rounded" class="text-sm" aria-hidden="true" />
                  </button>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget, useReturnTarget } from '~/composables/useReturnTarget'
import { useWikiGlossary } from '~/composables/useWikiGlossary'
import type { GlossaryTermView } from '~/server/utils/wiki/glossary'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()
const { setPage } = usePage()
const { goToReturnTarget } = useReturnTarget('Wiki')
const { loadGlossary } = useWikiGlossary()

const terms = ref<GlossaryTermView[]>([])
const loading = ref(true)
const search = ref('')

const canManage = computed(() => hasPermission('wiki.manage'))

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return terms.value
  return terms.value.filter(term => term.term.toLowerCase().includes(needle)
    || term.shortDefinition.toLowerCase().includes(needle)
    || term.aliases.some(alias => alias.toLowerCase().includes(needle)))
})

const groups = computed(() => {
  const byLetter = new Map<string, GlossaryTermView[]>()
  for (const term of filtered.value) {
    const letter = (term.term.trim()[0] ?? '#').toUpperCase()
    const list = byLetter.get(letter)
    if (list) list.push(term)
    else byLetter.set(letter, [term])
  }
  return [...byLetter.entries()]
    .map(([letter, list]) => ({ letter, terms: list }))
    .sort((a, b) => a.letter.localeCompare(b.letter, 'de'))
})

function jumpTo(letter: string) {
  if (!import.meta.client) return
  document.getElementById(`wiki-glossary-${letter}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openArticle(articleId: number) {
  setPage('WikiArticle', { articleId, returnTarget: buildReturnTarget('WikiGlossary') })
}

async function load() {
  loading.value = true
  try {
    terms.value = await loadGlossary()
  } finally {
    loading.value = false
  }
}

load()

useAppRefresh().onRefresh(load)
</script>
