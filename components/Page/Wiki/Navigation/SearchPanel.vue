<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-full sm:max-w-xs">
        <Icon
          name="material-symbols:search-rounded"
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-base-400"
          aria-hidden="true"
        />
        <input
          v-model="term"
          type="search"
          class="input wiki-search-input pl-9"
          :class="term ? 'pr-9' : ''"
          :placeholder="t('wiki.search.placeholder')"
          :aria-label="t('wiki.search.placeholder')"
          @keyup.enter="run"
        />
        <button
          v-if="term"
          type="button"
          class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-base-400 transition-colors hover:bg-base-100 hover:text-base-700"
          :title="t('wiki.search.clear')"
          :aria-label="t('wiki.search.clear')"
          @click="clear"
        >
          <Icon name="material-symbols:close-rounded" class="text-base" aria-hidden="true" />
        </button>
      </div>
      <MenuDropdown v-model="openDropdown" id="space" wrapper-class="relative w-full sm:max-w-xs">
        <template #trigger="{ styling }">
          <button type="button" :class="[styling, 'cursor-pointer']">
            <span class="truncate">{{ spaceLabel }}</span>
            <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
          </button>
        </template>
        <template #default="{ styling }">
          <button type="button" :class="styling" @click="selectSpace(0)">{{ t('wiki.search.allSpaces') }}</button>
          <button
            v-for="space in spaces"
            :key="space.id"
            type="button"
            :class="styling"
            @click="selectSpace(space.id)"
          >
            {{ space.title }}
          </button>
        </template>
      </MenuDropdown>
      <MenuDropdown v-if="tags.length" v-model="openDropdown" id="tag" wrapper-class="relative w-full sm:max-w-xs">
        <template #trigger="{ styling }">
          <button type="button" :class="[styling, 'cursor-pointer']">
            <span class="truncate">{{ tagLabel }}</span>
            <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
          </button>
        </template>
        <template #default="{ styling }">
          <button type="button" :class="styling" @click="selectTag('')">{{ t('wiki.search.allTags') }}</button>
          <button
            v-for="tag in tags"
            :key="tag.id"
            type="button"
            :class="styling"
            @click="selectTag(tag.slug)"
          >
            {{ tag.label }}
          </button>
        </template>
      </MenuDropdown>
      <button type="button" class="btn-primary inline-flex h-9.5 items-center gap-1.5" @click="run">
        <Icon name="material-symbols:search-rounded" class="text-base" aria-hidden="true" />
        {{ t('wiki.search.submit') }}
      </button>
    </div>

    <p aria-live="polite" class="sr-only">{{ statusMessage }}</p>

    <p v-if="term.trim().length === 1" class="text-sm text-base-500">{{ t('wiki.search.hint') }}</p>
    <p v-else-if="searching" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>
    <p v-else-if="searched && !hits.length" class="text-sm text-base-500">{{ t('wiki.search.empty') }}</p>
    <p v-else-if="hits.length" class="text-xs text-base-500">{{ t('wiki.search.results', { count: hits.length }) }}</p>

    <ul v-if="hits.length" class="space-y-2">
      <li v-for="hit in hits" :key="hit.id">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-base-200 p-3 text-left transition-colors hover:border-accent-300 hover:bg-accent-50/60"
          @click="$emit('open', hit.id)"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-xs text-base-500">{{ hit.spaceTitle }}</span>
            <span class="block font-semibold text-base-900" v-html="highlight(hit.title)"></span>
            <span
              v-if="hit.snippet"
              class="mt-1 block text-sm leading-relaxed text-base-600"
              v-html="highlight(hit.snippet)"
            ></span>
          </span>
          <Icon name="material-symbols:chevron-right-rounded" class="shrink-0 text-lg text-base-300" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { WikiSearchResponse } from '~/server/api/wiki/search.get'
import type { WikiTagsResponse } from '~/server/api/wiki/tags/index.get'
import type { WikiSearchHit, WikiTag, WikiTreeSpace } from '~/types/wiki'

const props = defineProps<{
  spaces: WikiTreeSpace[]
  initialTag?: string | null
}>()

defineEmits<{
  (e: 'open', articleId: number): void
}>()

const { t } = useI18n()

const term = ref('')
const spaceId = ref(0)
const tagSlug = ref(props.initialTag ?? '')
const tags = ref<WikiTag[]>([])
const hits = ref<WikiSearchHit[]>([])
const searchedTerms = ref<string[]>([])
const searching = ref(false)
const searched = ref(false)
const openDropdown = ref<string | null>(null)

const spaceLabel = computed(() => props.spaces.find(space => space.id === spaceId.value)?.title ?? t('wiki.search.allSpaces'))

function selectSpace(id: number) {
  spaceId.value = id
  openDropdown.value = null
}

const tagLabel = computed(() => tags.value.find(tag => tag.slug === tagSlug.value)?.label ?? t('wiki.search.allTags'))

function selectTag(slug: string) {
  tagSlug.value = slug
  openDropdown.value = null
}

async function loadTags() {
  const res = await apiFetch<WikiTagsResponse>('/api/wiki/tags')
  tags.value = res.ok ? res.tags.filter(tag => tag.articleCount > 0) : []
}

const ESCAPE_HTML: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ESCAPE_HTML[character]!)
}

function highlight(value: string) {
  const escaped = escapeHtml(value)
  const words = searchedTerms.value
  if (!words.length) return escaped

  const alternatives = words
    .map(word => escapeHtml(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const pattern = new RegExp(`(${alternatives})`, 'gi')
  return escaped.replace(pattern, '<mark class="search-hit-mark">$1</mark>')
}

function clear() {
  term.value = ''
  hits.value = []
  searchedTerms.value = []
  searched.value = false
  if (!tagSlug.value) return
  run()
}

const statusMessage = computed(() => {
  if (searching.value) return t('wiki.loading')
  if (!searched.value) return ''
  return hits.value.length ? t('wiki.search.results', { count: hits.value.length }) : t('wiki.search.empty')
})

let debounce: ReturnType<typeof setTimeout> | null = null

async function run() {
  const query = term.value.trim()
  if (query.length < 2 && !tagSlug.value) {
    hits.value = []
    searchedTerms.value = []
    searched.value = false
    return
  }

  searching.value = true
  try {
    const res = await apiFetch<WikiSearchResponse>('/api/wiki/search', {
      query: {
        q: query,
        spaceId: spaceId.value || undefined,
        tag: tagSlug.value || undefined,
      },
    })
    hits.value = res.ok ? res.hits : []
    searchedTerms.value = res.ok && query.length >= 2
      ? query.split(/\s+/).filter(word => word.length > 1)
      : []
  } finally {
    searching.value = false
    searched.value = true
  }
}

watch([term, spaceId, tagSlug], () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(run, 300)
})

loadTags()
if (tagSlug.value) run()
</script>
