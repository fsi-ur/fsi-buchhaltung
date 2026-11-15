<template>
  <CommonModal
    :model-value="modelValue"
    :title="t('wiki.editor.helper.title')"
    width-class="max-w-5xl"
    body-class="mt-4 space-y-4"
    @update:model-value="value => $emit('update:modelValue', value)"
  >
    <CommonSegmentedControl
      v-model="tab"
      :options="[
        { value: 'insert', label: t('wiki.editor.helper.tabInsert') },
        { value: 'reference', label: t('wiki.editor.helper.tabReference') },
      ]"
      :aria-label="t('wiki.editor.helper.title')"
    />

    <!-- Insert: pick an element, adjust it, see its code -->
    <div v-if="tab === 'insert'" class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div class="flex min-w-0 flex-col gap-2">
        <div class="relative">
          <Icon name="material-symbols:search-rounded" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-base-400" aria-hidden="true" />
          <input
            ref="searchRef"
            v-model="search"
            type="search"
            class="input pl-9"
            :placeholder="t('wiki.editor.helper.searchPlaceholder')"
            :aria-label="t('wiki.editor.helper.searchPlaceholder')"
            autocomplete="off"
            @keydown.down.prevent="moveActive(1)"
            @keydown.up.prevent="moveActive(-1)"
            @keydown.enter.prevent="insertActive"
          />
        </div>

        <div class="flex flex-wrap gap-1">
          <button
            v-for="option in categoryOptions"
            :key="option.value"
            type="button"
            class="cursor-pointer rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors"
            :class="category === option.value
              ? 'border-accent-400 bg-accent-50 text-accent-700'
              : 'border-base-200 bg-white text-base-500 hover:bg-base-100'"
            :aria-pressed="category === option.value"
            @click="category = option.value"
          >
            {{ option.label }}
          </button>
        </div>

        <div ref="listRef" class="max-h-60 overflow-y-auto rounded-lg border border-base-200 md:max-h-104" role="listbox" :aria-label="t('wiki.editor.helper.tabInsert')">
          <p v-if="!filteredItems.length" class="p-3 text-sm text-base-400">{{ t('wiki.editor.helper.noResults') }}</p>
          <template v-for="group in groupedItems" :key="group.category">
            <p class="sticky top-0 z-10 border-b border-base-100 bg-base-50 px-3 py-1 text-xs font-semibold text-base-500">
              {{ categoryLabel(group.category) }}
            </p>
            <button
              v-for="entry in group.items"
              :key="entry.item.id"
              type="button"
              role="option"
              class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
              :class="entry.index === activeIndex ? 'bg-accent-50 text-accent-800' : 'text-base-700 hover:bg-base-50'"
              :aria-selected="entry.index === activeIndex"
              :data-helper-index="entry.index"
              @click="activeIndex = entry.index"
              @dblclick="insertActive"
            >
              <Icon :name="entry.item.icon" class="h-4 w-4 shrink-0 text-base-400" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ entry.item.label }}</span>
              <span v-if="entry.item.hint" class="max-w-[40%] shrink-0 truncate font-mono text-[11px] text-base-400">{{ entry.item.hint }}</span>
            </button>
          </template>
        </div>
        <p class="hidden text-xs text-base-400 md:block">{{ t('wiki.editor.helper.keyboardHint') }}</p>
      </div>

      <div v-if="active" class="flex min-w-0 flex-col gap-3 rounded-lg border border-base-200 p-4">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-base-400">{{ categoryLabel(active.category) }}</p>
          <h3 class="text-base font-semibold text-base-900">{{ active.label }}</h3>
          <p class="mt-1 text-sm text-base-600">{{ active.description }}</p>
        </div>

        <!-- Event tab link: event + tab -->
        <template v-if="active.kind === 'eventTab'">
          <div class="field">
            <label class="section-title">{{ t('wiki.editor.helper.event') }}</label>
            <CommonSearchSelect
              v-model="eventQuery"
              :options="eventOptions"
              :selected-label="selectedEvent ? eventLabel(selectedEvent) : ''"
              :placeholder="t('wiki.editor.helper.eventPlaceholder')"
              :empty-text="t('wiki.editor.helper.noEvents')"
              @select="value => { selectedEventId = value as number }"
              @clear-selection="selectedEventId = null"
            />
          </div>
          <div class="field">
            <label class="section-title">{{ t('wiki.editor.helper.eventTab') }}</label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="eventTab in linkableEventTabs"
                :key="eventTab.key"
                type="button"
                class="cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
                :class="selectedEventTab === eventTab.key
                  ? 'border-accent-400 bg-accent-50 text-accent-700'
                  : 'border-base-200 bg-white text-base-600 hover:bg-base-100'"
                :aria-pressed="selectedEventTab === eventTab.key"
                @click="selectedEventTab = eventTab.key"
              >
                {{ t(eventTab.labelKey) }}
              </button>
            </div>
          </div>
        </template>

        <!-- Widget parameters, generated from the widget's argsSchema -->
        <template v-if="active.kind === 'embed' && active.embed?.argsSchema">
          <div v-for="(type, name) in active.embed.argsSchema" :key="name" class="field">
            <label class="section-title" :for="`${fieldId}-${name}`">
              {{ t(`wiki.editor.helper.args.${name}.label`) }}
              <span class="font-normal text-base-400">· {{ t('wiki.editor.helper.optional') }}</span>
            </label>
            <template v-if="active.embed.argPickers?.[name] === 'costCentre' && canPickCostCentre">
              <CommonSearchSelect
                v-model="costCentreQuery"
                :options="costCentreOptions"
                :selected-label="selectedCostCentreLabel(String(embedArgs[name] ?? ''))"
                :placeholder="t(`wiki.editor.helper.args.${name}.hint`)"
                :empty-text="t('wiki.editor.helper.noCostCentres')"
                @select="value => { embedArgs[name] = String(value) }"
                @clear-selection="embedArgs[name] = ''"
              />
            </template>
            <CommonToggleSwitch
              v-else-if="type === 'boolean'"
              :model-value="embedArgs[name] === true"
              :label="t(`wiki.editor.helper.args.${name}.label`)"
              @update:model-value="value => { embedArgs[name] = value }"
            />
            <input
              v-else
              :id="`${fieldId}-${name}`"
              v-model="embedArgs[name]"
              :type="type === 'number' ? 'number' : 'text'"
              class="input"
              :placeholder="t(`wiki.editor.helper.args.${name}.hint`)"
              @keydown.enter.prevent="insertActive"
            />
          </div>
        </template>

        <!-- Visible text: button label, link text or image description -->
        <div v-if="labelField" class="field">
          <label class="section-title" :for="`${fieldId}-label`">
            {{ t(labelField) }}
            <span class="font-normal text-base-400">· {{ t('wiki.editor.helper.optional') }}</span>
          </label>
          <input
            :id="`${fieldId}-label`"
            v-model="label"
            type="text"
            class="input"
            :placeholder="defaultLabel"
            @keydown.enter.prevent="insertActive"
          />
        </div>

        <div class="mt-auto">
          <div class="mb-1 flex items-center justify-between gap-2">
            <p class="section-title mb-0">{{ t('wiki.editor.helper.code') }}</p>
            <button v-if="snippet" type="button" class="flex cursor-pointer items-center gap-1 text-xs font-medium text-link-600 hover:text-link-800" @click="copy(snippetCode(snippet))">
              <Icon name="material-symbols:content-copy-outline-rounded" class="h-3.5 w-3.5" aria-hidden="true" />
              {{ t('wiki.editor.helper.copy') }}
            </button>
          </div>
          <pre class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-base-900 p-3 font-mono text-xs leading-relaxed text-base-50">{{ snippet ? snippetCode(snippet) : t('wiki.editor.helper.codeIncomplete') }}</pre>
        </div>
      </div>
    </div>

    <!-- Reference: every piece of syntax the renderer understands -->
    <div v-else class="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
      <p class="text-sm text-base-600">{{ t('wiki.editor.helper.referenceIntro') }}</p>

      <section v-for="group in referenceGroups" :key="group.titleKey">
        <h3 class="mb-2 text-sm font-semibold text-base-900">{{ t(group.titleKey) }}</h3>
        <ul class="divide-y divide-base-100 rounded-lg border border-base-200">
          <li v-for="entry in group.entries" :key="entry.code" class="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
            <pre class="min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded bg-base-50 px-2 py-1 font-mono text-xs text-base-800 sm:w-2/5 sm:shrink-0">{{ entry.code }}</pre>
            <div class="min-w-0 flex-1 text-sm text-base-600">
              <p>{{ entry.description }}</p>
              <ul v-if="entry.params?.length" class="mt-1 space-y-0.5 text-xs text-base-500">
                <li v-for="param in entry.params" :key="param">{{ param }}</li>
              </ul>
            </div>
            <div class="flex shrink-0 gap-1">
              <button type="button" class="icon-btn h-8 w-8" :title="t('wiki.editor.helper.copy')" :aria-label="t('wiki.editor.helper.copy')" @click="copy(entry.code)">
                <Icon name="material-symbols:content-copy-outline-rounded" class="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                v-if="entry.snippet"
                type="button"
                class="icon-btn h-8 w-8"
                :title="t('wiki.editor.helper.insert')"
                :aria-label="t('wiki.editor.helper.insert')"
                @click="emitInsert(entry.snippet)"
              >
                <Icon name="material-symbols:add-rounded" class="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section>
        <h3 class="mb-2 text-sm font-semibold text-base-900">{{ t('wiki.editor.helper.ref.groups.shortcuts') }}</h3>
        <ul class="divide-y divide-base-100 rounded-lg border border-base-200">
          <li v-for="shortcut in shortcuts" :key="shortcut.keys.join('+')" class="flex items-center gap-3 p-3 text-sm">
            <span class="flex w-40 shrink-0 flex-wrap items-center gap-1">
              <kbd v-for="key in shortcut.keys" :key="key" class="rounded border border-base-300 bg-base-50 px-1.5 py-0.5 font-mono text-xs text-base-700">{{ key }}</kbd>
            </span>
            <span class="text-base-600">{{ t(shortcut.descKey) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="$emit('update:modelValue', false)">
        {{ tab === 'insert' ? t('wiki.editor.helper.cancel') : t('wiki.editor.helper.close') }}
      </button>
      <button
        v-if="tab === 'insert'"
        type="button"
        class="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!snippet"
        @click="insertActive"
      >
        {{ t('wiki.editor.helper.insert') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useAuth } from '~/composables/useAuth'
import { useToast } from '~/composables/useToast'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { PAGES } from '~/config/pages'
import { WIKI_EMBEDS, type WikiEmbedDefinition } from '~/config/wikiEmbeds'
import { SETTINGS_TABS } from '~/config/settingsTabs'
import { EVENT_PLANNING_TABS } from '~/config/eventPlanningTabs'
import {
  WIKI_TABLE_SNIPPET,
  altFromFileName,
  buildChecklist,
  buildEmbed,
  buildGlossaryRef,
  buildImage,
  buildToolLink,
  buildWikiLink,
  type WikiSnippet,
} from '~/utils/wikiSnippets'
import type { WikiTreeResponse } from '~/server/api/wiki/tree.get'
import type { GetEventsResponse } from '~/server/api/events/index.get'
import type { GlossaryTermView } from '~/server/utils/wiki/glossary'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { Event } from '~/types/event'
import type { CostCentreRow } from '~/types/costCentre'
import type { WikiChecklistView, WikiImage, WikiTreeArticle } from '~/types/wiki'

export type WikiInsertHelperTab = 'insert' | 'reference'

const props = withDefaults(defineProps<{
  modelValue: boolean
  initialTab?: WikiInsertHelperTab
  /** The text selected in the editor when the helper opened — used as the default link text. */
  selectedText?: string
  checklists?: WikiChecklistView[]
  glossaryTerms?: GlossaryTermView[]
  images?: WikiImage[]
}>(), {
  initialTab: 'insert',
  selectedText: '',
  checklists: () => [],
  glossaryTerms: () => [],
  images: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'insert', snippet: WikiSnippet): void
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()
const toast = useToast()
const { formatDateTime } = useLocaleFormatters()
const runtimeConfig = useRuntimeConfig()

type Category = 'format' | 'pages' | 'wiki' | 'embeds' | 'checklists' | 'glossary' | 'images'
type ItemKind = 'static' | 'tool' | 'settingsTab' | 'eventTab' | 'wikiLink' | 'embed' | 'checklist' | 'glossary' | 'image'

interface HelperItem {
  id: string
  category: Category
  kind: ItemKind
  label: string
  /** Muted code-ish identifier next to the label (page name, slug, key). */
  hint?: string
  icon: string
  description: string
  snippet?: WikiSnippet
  page?: string
  tabKey?: string
  target?: string
  key?: string
  fileId?: number
  /** Visible text used when the author leaves the text field empty. */
  fallbackLabel?: string
  embed?: WikiEmbedDefinition
}

const CATEGORY_ORDER: Category[] = ['format', 'pages', 'wiki', 'embeds', 'checklists', 'glossary', 'images']
const CATEGORY_ICONS: Record<Category, string> = {
  format: 'material-symbols:text-fields-rounded',
  pages: 'material-symbols:open-in-new-rounded',
  wiki: 'material-symbols:menu-book-outline-rounded',
  embeds: 'material-symbols:widgets-outline-rounded',
  checklists: 'material-symbols:checklist-rounded',
  glossary: 'material-symbols:dictionary-outline-rounded',
  images: 'material-symbols:image-outline-rounded',
}

function categoryLabel(category: Category) {
  return t(`wiki.editor.helper.categories.${category}`)
}

const fieldId = useId()
const searchRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const tab = ref<WikiInsertHelperTab>('insert')
const search = ref('')
const category = ref<Category | 'all'>('all')
const activeIndex = ref(0)

function wrapSnippet(text: string, wrapAfter: string, placeholderKey: string, block: boolean): WikiSnippet {
  return { text, wrapAfter, placeholder: t(placeholderKey), block }
}

const formatItems = computed<HelperItem[]>(() => {
  const entries: Array<[string, string, WikiSnippet, string?]> = [
    ['hint', 'wiki.editor.helper.format.hint', wrapSnippet(':::hinweis\n', '\n:::', 'wiki.editor.helper.placeholders.boxText', true), ':::hinweis'],
    ['warning', 'wiki.editor.helper.format.warning', wrapSnippet(':::warnung\n', '\n:::', 'wiki.editor.helper.placeholders.boxText', true), ':::warnung'],
    ['tip', 'wiki.editor.helper.format.tip', wrapSnippet(':::tipp\n', '\n:::', 'wiki.editor.helper.placeholders.boxText', true), ':::tipp'],
    ['table', 'wiki.editor.helper.format.table', { text: WIKI_TABLE_SNIPPET, block: true }, '| … |'],
    ['heading2', 'wiki.editor.helper.format.heading2', wrapSnippet('## ', '', 'wiki.editor.helper.placeholders.heading', true), '##'],
    ['heading3', 'wiki.editor.helper.format.heading3', wrapSnippet('### ', '', 'wiki.editor.helper.placeholders.heading', true), '###'],
    ['list', 'wiki.editor.helper.format.list', wrapSnippet('- ', '', 'wiki.editor.helper.placeholders.listItem', true), '-'],
    ['numberedList', 'wiki.editor.helper.format.numberedList', wrapSnippet('1. ', '', 'wiki.editor.helper.placeholders.listItem', true), '1.'],
    ['quote', 'wiki.editor.helper.format.quote', wrapSnippet('> ', '', 'wiki.editor.helper.placeholders.quote', true), '>'],
    ['codeBlock', 'wiki.editor.helper.format.codeBlock', wrapSnippet('```\n', '\n```', 'wiki.editor.helper.placeholders.code', true), '```'],
    ['rule', 'wiki.editor.helper.format.rule', { text: '---', block: true }, '---'],
    ['link', 'wiki.editor.helper.format.link', wrapSnippet('[', '](https://)', 'wiki.editor.helper.placeholders.linkText', false), '[…](…)'],
  ]
  return entries.map(([id, labelKey, snippet, hint]) => ({
    id: `format:${id}`,
    category: 'format',
    kind: 'static',
    label: t(labelKey),
    hint,
    icon: CATEGORY_ICONS.format,
    description: t(`wiki.editor.helper.formatInfo.${id}`),
    snippet,
  }))
})

const toolPageItems = computed<HelperItem[]>(() => Object.entries(PAGES)
  // Guest pages (login, …) make no sense as a button for a signed-in reader.
  .filter(([, page]) => !page.allowGuest && (!page.permissions.length || hasPermission(page.permissions)))
  .map(([name, page]) => ({
    id: `tool:${name}`,
    category: 'pages' as const,
    kind: 'tool' as const,
    label: t(page.labelKey),
    hint: name,
    icon: page.main ? page.icon : CATEGORY_ICONS.pages,
    description: t('wiki.editor.helper.info.tool'),
    page: name,
    fallbackLabel: t(page.labelKey),
  }))
  .sort((a, b) => a.label.localeCompare(b.label)))

const settingsTabItems = computed<HelperItem[]>(() => SETTINGS_TABS
  .filter(entry => !entry.permission || hasPermission(entry.permission))
  .map(entry => ({
    id: `settingsTab:${entry.key}`,
    category: 'pages' as const,
    kind: 'settingsTab' as const,
    label: `${t('pages.settings')} – ${t(entry.labelKey)}`,
    hint: `Settings:${entry.key}`,
    icon: 'material-symbols:settings-outline-rounded',
    description: t('wiki.editor.helper.info.settingsTab'),
    tabKey: entry.key,
    fallbackLabel: `${t('pages.settings')} – ${t(entry.labelKey)}`,
  })))

const canLinkEventTab = computed(() => {
  const page = PAGES.EventCreate
  return !!page && (!page.permissions.length || hasPermission(page.permissions))
})

const eventTabItems = computed<HelperItem[]>(() => canLinkEventTab.value
  ? [{
      id: 'eventTab',
      category: 'pages',
      kind: 'eventTab',
      label: t('wiki.editor.helper.eventTabItem'),
      hint: 'EventCreate',
      icon: 'material-symbols:event-outline-rounded',
      description: t('wiki.editor.helper.info.eventTab'),
    }]
  : [])

const tree = ref<Extract<WikiTreeResponse, { ok: true }> | null>(null)
let treeRequested = false

async function ensureTreeLoaded() {
  if (treeRequested) return
  treeRequested = true
  const res = await apiFetch<WikiTreeResponse>('/api/wiki/tree')
  if (res.ok) tree.value = res
  else treeRequested = false
}

const wikiItems = computed<HelperItem[]>(() => {
  const items: HelperItem[] = []
  for (const space of tree.value?.spaces ?? []) {
    items.push({
      id: `wiki:${space.slug}`,
      category: 'wiki',
      kind: 'wikiLink',
      label: space.title,
      hint: space.slug,
      icon: 'material-symbols:folder-outline-rounded',
      description: t('wiki.editor.helper.info.wikiSpace'),
      target: space.slug,
      fallbackLabel: space.title,
    })
    const visit = (articles: WikiTreeArticle[], trail: string[]) => {
      for (const article of articles) {
        const path = [space.title, ...trail].join(' › ')
        items.push({
          id: `wiki:${space.slug}/${article.slug}`,
          category: 'wiki',
          kind: 'wikiLink',
          label: article.title,
          hint: `${space.slug}/${article.slug}`,
          icon: 'material-symbols:article-outline-rounded',
          description: t('wiki.editor.helper.info.wikiArticle', { path }),
          target: `${space.slug}/${article.slug}`,
          fallbackLabel: article.title,
        })
        visit(article.children ?? [], [...trail, article.title])
      }
    }
    visit(space.articles, [])
  }
  return items
})

const embedItems = computed<HelperItem[]>(() => WIKI_EMBEDS.map(embed => ({
  id: `embed:${embed.key}`,
  category: 'embeds',
  kind: 'embed',
  label: t(embed.labelKey),
  hint: embed.key,
  icon: CATEGORY_ICONS.embeds,
  description: t(embed.descriptionKey),
  embed,
})))

const checklistItems = computed<HelperItem[]>(() => props.checklists.map(checklist => ({
  id: `checklist:${checklist.keySlug}`,
  category: 'checklists',
  kind: 'checklist',
  label: checklist.title,
  hint: checklist.keySlug,
  icon: CATEGORY_ICONS.checklists,
  description: t('wiki.editor.helper.info.checklist'),
  key: checklist.keySlug,
})))

const glossaryItems = computed<HelperItem[]>(() => props.glossaryTerms.map(entry => ({
  id: `glossary:${entry.key}`,
  category: 'glossary',
  kind: 'glossary',
  label: entry.term,
  hint: entry.key,
  icon: CATEGORY_ICONS.glossary,
  description: entry.shortDefinition
    ? t('wiki.editor.helper.info.glossaryWithDefinition', { definition: entry.shortDefinition })
    : t('wiki.editor.helper.info.glossary'),
  key: entry.key,
  fallbackLabel: entry.term,
})))

const imageItems = computed<HelperItem[]>(() => props.images.map(image => ({
  id: `image:${image.fileId}`,
  category: 'images',
  kind: 'image',
  label: image.fileName,
  hint: `bild:${image.fileId}`,
  icon: CATEGORY_ICONS.images,
  description: t('wiki.editor.helper.info.image'),
  fileId: image.fileId,
  fallbackLabel: altFromFileName(image.fileName),
})))

const allItems = computed<HelperItem[]>(() => [
  ...formatItems.value,
  ...eventTabItems.value,
  ...settingsTabItems.value,
  ...toolPageItems.value,
  ...wikiItems.value,
  ...embedItems.value,
  ...checklistItems.value,
  ...glossaryItems.value,
  ...imageItems.value,
])

const categoryOptions = computed(() => {
  const present = new Set(allItems.value.map(item => item.category))
  return [
    { value: 'all' as const, label: t('wiki.editor.helper.categories.all') },
    ...CATEGORY_ORDER.filter(entry => present.has(entry)).map(entry => ({ value: entry, label: categoryLabel(entry) })),
  ]
})

function normalize(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

const filteredItems = computed(() => {
  const terms = normalize(search.value).split(/\s+/).filter(Boolean)
  return allItems.value
    .filter(item => category.value === 'all' || item.category === category.value)
    .filter((item) => {
      if (!terms.length) return true
      const haystack = normalize([item.label, item.hint, categoryLabel(item.category)].filter(Boolean).join(' '))
      return terms.every(term => haystack.includes(term))
    })
    // Keep the category order stable so the grouped list and the arrow keys agree.
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
})

const groupedItems = computed(() => {
  const groups: Array<{ category: Category, items: Array<{ item: HelperItem, index: number }> }> = []
  filteredItems.value.forEach((item, index) => {
    let group = groups[groups.length - 1]
    if (!group || group.category !== item.category) {
      group = { category: item.category, items: [] }
      groups.push(group)
    }
    group.items.push({ item, index })
  })
  return groups
})

const active = computed(() => filteredItems.value[activeIndex.value] ?? null)

watch([search, category], () => { activeIndex.value = 0 })

function moveActive(step: number) {
  const count = filteredItems.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + step + count) % count
  nextTick(() => {
    listRef.value?.querySelector(`[data-helper-index="${activeIndex.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

const label = ref('')
const embedArgs = reactive<Record<string, string | boolean>>({})

const cashRegisterAvailable = computed(() =>
  runtimeConfig.public.cashRegisterMode === 'connected' && hasPermission('cash_register.manage'))
const linkableEventTabs = computed(() => EVENT_PLANNING_TABS
  .filter(entry => entry.key !== 'cashRegister' || cashRegisterAvailable.value))
const DEFAULT_EVENT_TAB = EVENT_PLANNING_TABS[0]?.key ?? 'overview'

const events = ref<Event[]>([])
let eventsRequested = false
const eventQuery = ref('')
const selectedEventId = ref<number | null>(null)
const selectedEventTab = ref(DEFAULT_EVENT_TAB)
const selectedEvent = computed(() => events.value.find(event => event.id === selectedEventId.value) ?? null)

const eventOptions = computed<SearchSelectOption<number>[]>(() => events.value.map(event => ({
  key: event.id,
  label: eventLabel(event),
  searchText: [event.name, event.location].filter(Boolean).join(' '),
  value: event.id,
})))

function eventLabel(event: Event) {
  return [event.name, formatDateTime(event.starts_at), event.location].filter(Boolean).join(' | ')
}

async function ensureEventsLoaded() {
  if (eventsRequested) return
  eventsRequested = true
  const res = await apiFetch<GetEventsResponse>('/api/events')
  if (res.ok) events.value = res.events
  else eventsRequested = false
}

const canPickCostCentre = computed(() => hasPermission('cost_centres.view'))
const costCentres = ref<CostCentreRow[]>([])
let costCentresRequested = false
const costCentreQuery = ref('')

const costCentreOptions = computed<SearchSelectOption<number>[]>(() => costCentres.value.map(entry => ({
  key: entry.id,
  label: `${entry.code} – ${entry.name}`,
  value: entry.id,
})))

function selectedCostCentreLabel(id: string) {
  const entry = costCentres.value.find(row => String(row.id) === id)
  return entry ? `${entry.code} – ${entry.name}` : ''
}

async function ensureCostCentresLoaded() {
  if (costCentresRequested || !canPickCostCentre.value) return
  costCentresRequested = true
  const res = await apiFetch<{ ok: true, costCentres: CostCentreRow[] } | { ok: false, error: string }>('/api/cost_centres')
  if (res.ok) costCentres.value = res.costCentres
  else costCentresRequested = false
}

watch(() => active.value?.id, () => {
  label.value = ''
  for (const key of Object.keys(embedArgs)) delete embedArgs[key]
  costCentreQuery.value = ''
  const item = active.value
  if (item?.kind === 'eventTab') ensureEventsLoaded()
  if (item?.embed?.argPickers) ensureCostCentresLoaded()
})

const LABEL_FIELDS: Partial<Record<ItemKind, string>> = {
  tool: 'wiki.editor.helper.buttonLabel',
  settingsTab: 'wiki.editor.helper.buttonLabel',
  eventTab: 'wiki.editor.helper.buttonLabel',
  wikiLink: 'wiki.editor.helper.linkText',
  glossary: 'wiki.editor.helper.linkText',
  image: 'wiki.editor.helper.imageAlt',
}

const labelField = computed(() => active.value ? LABEL_FIELDS[active.value.kind] ?? '' : '')

const defaultLabel = computed(() => {
  const item = active.value
  if (!item) return ''
  if (item.kind === 'eventTab') {
    const eventTab = EVENT_PLANNING_TABS.find(entry => entry.key === selectedEventTab.value)
    const tabLabel = eventTab ? t(eventTab.labelKey) : selectedEventTab.value
    return selectedEvent.value ? `${selectedEvent.value.name} – ${tabLabel}` : tabLabel
  }
  // A reference picks up the text the author had selected, so marking a word and inserting a link "just works".
  if ((item.kind === 'wikiLink' || item.kind === 'glossary') && props.selectedText.trim()) return props.selectedText.trim()
  return item.fallbackLabel ?? ''
})

const snippet = computed<WikiSnippet | null>(() => {
  const item = active.value
  if (!item) return null
  const text = label.value.trim() || defaultLabel.value

  switch (item.kind) {
    case 'static':
      return item.snippet ?? null
    case 'tool':
      return { text: buildToolLink(item.page ?? '', text), block: true }
    case 'settingsTab':
      return { text: buildToolLink('Settings', text, { tab: item.tabKey ?? '' }), block: true }
    case 'eventTab':
      if (!selectedEvent.value || !selectedEventTab.value) return null
      return { text: buildToolLink('EventCreate', text, { eventId: selectedEvent.value.id, tab: selectedEventTab.value }), block: true }
    case 'wikiLink':
      return { text: buildWikiLink(item.target ?? '', text), block: false, replacesSelection: true }
    case 'glossary':
      return { text: buildGlossaryRef(item.key ?? '', text), block: false, replacesSelection: true }
    case 'embed': {
      const args: Record<string, string | boolean> = {}
      for (const [name, value] of Object.entries(embedArgs)) {
        if (value === false) continue
        args[name] = typeof value === 'string' ? value.trim() : value
      }
      return { text: buildEmbed(item.embed?.key ?? '', args), block: true }
    }
    case 'checklist':
      return { text: buildChecklist(item.key ?? ''), block: true }
    case 'image':
      return { text: buildImage(item.fileId ?? 0, text), block: true }
  }
  return null
})

function snippetCode(value: WikiSnippet) {
  if (value.wrapAfter === undefined) return value.text
  return `${value.text}${props.selectedText || value.placeholder || ''}${value.wrapAfter}`
}

function emitInsert(value: WikiSnippet) {
  emit('insert', value)
  emit('update:modelValue', false)
}

function insertActive() {
  if (snippet.value) emitInsert(snippet.value)
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('wiki.editor.helper.copied'))
  } catch {
    toast.error(t('wiki.editor.helper.copyFailed'))
  }
}

interface ReferenceEntry {
  code: string
  description: string
  params?: string[]
  snippet?: WikiSnippet
}

function block(text: string): WikiSnippet {
  return { text, block: true }
}

function inline(text: string): WikiSnippet {
  return { text, block: false }
}

const referenceGroups = computed<Array<{ titleKey: string, entries: ReferenceEntry[] }>>(() => {
  const r = (id: string) => t(`wiki.editor.helper.ref.${id}`)
  const firstChecklist = props.checklists[0]?.keySlug ?? 'kennung'
  const firstTerm = props.glossaryTerms[0]?.key ?? 'begriff'
  const firstImage = props.images[0]?.fileId ?? 123

  return [
    {
      titleKey: 'wiki.editor.helper.ref.groups.text',
      entries: [
        { code: '**fett**', description: r('bold'), snippet: inline('**fett**') },
        { code: '*kursiv*', description: r('italic'), snippet: inline('*kursiv*') },
        { code: '~~durchgestrichen~~', description: r('strike'), snippet: inline('~~durchgestrichen~~') },
        { code: '`Code`', description: r('inlineCode'), snippet: inline('`Code`') },
        { code: '[Linktext](https://example.org)', description: r('link'), snippet: inline('[Linktext](https://)') },
        { code: 'https://example.org', description: r('autolink') },
      ],
    },
    {
      titleKey: 'wiki.editor.helper.ref.groups.structure',
      entries: [
        { code: '## Überschrift\n### Unterüberschrift', description: r('headings'), snippet: block('## Überschrift') },
        { code: '- Punkt\n- Punkt', description: r('list'), snippet: block('- Punkt\n- Punkt') },
        { code: '1. Schritt\n2. Schritt', description: r('numberedList'), snippet: block('1. Schritt\n2. Schritt') },
        { code: '> Zitat', description: r('quote'), snippet: block('> Zitat') },
        { code: '```\nCode-Block\n```', description: r('codeBlock'), snippet: block('```\nCode-Block\n```') },
        { code: '---', description: r('rule'), snippet: block('---') },
        { code: WIKI_TABLE_SNIPPET, description: r('table'), snippet: block(WIKI_TABLE_SNIPPET) },
      ],
    },
    {
      titleKey: 'wiki.editor.helper.ref.groups.boxes',
      entries: [
        { code: ':::hinweis\nText\n:::', description: r('hint'), snippet: block(':::hinweis\nText\n:::') },
        { code: ':::warnung\nText\n:::', description: r('warning'), snippet: block(':::warnung\nText\n:::') },
        { code: ':::tipp\nText\n:::', description: r('tip'), snippet: block(':::tipp\nText\n:::') },
      ],
    },
    {
      titleKey: 'wiki.editor.helper.ref.groups.references',
      entries: [
        { code: '[[wiki:bereich]]', description: r('wikiSpace') },
        { code: '[[wiki:bereich/artikel|Eigener Text]]', description: r('wikiArticle') },
        { code: `[[glossar:${firstTerm}|Eigener Text]]`, description: r('glossary'), snippet: props.glossaryTerms.length ? inline(buildGlossaryRef(firstTerm)) : undefined },
        { code: `![Beschreibung](bild:${firstImage})`, description: r('image') },
      ],
    },
    {
      titleKey: 'wiki.editor.helper.ref.groups.blocks',
      entries: [
        {
          code: buildToolLink('MembersList', 'Mitgliederliste öffnen'),
          description: r('tool'),
          params: [r('toolPage'), r('toolMeta'), r('toolLabel')],
        },
        {
          code: buildToolLink('Settings', 'Einstellungen – Kostenstellen', { tab: 'costCentres' }),
          description: r('toolTab'),
        },
        {
          code: buildChecklist(firstChecklist),
          description: r('checklist'),
          snippet: props.checklists.length ? block(buildChecklist(firstChecklist)) : undefined,
        },
        {
          code: ':::embed{widget="name" parameter="wert"}',
          description: r('embed'),
        },
      ],
    },
    {
      titleKey: 'wiki.editor.helper.ref.groups.embeds',
      entries: WIKI_EMBEDS.map(embed => ({
        code: buildEmbed(embed.key, Object.fromEntries(Object.entries(embed.argsSchema ?? {})
          .map(([name]) => [name, t(`wiki.editor.helper.args.${name}.example`)]))),
        description: `${t(embed.labelKey)}: ${t(embed.descriptionKey)}`,
        params: Object.entries(embed.argsSchema ?? {}).map(([name, type]) =>
          `${name} (${t(`wiki.editor.helper.argTypes.${type}`)}, ${t('wiki.editor.helper.optional')}): ${t(`wiki.editor.helper.args.${name}.hint`)}`),
        snippet: block(buildEmbed(embed.key)),
      })),
    },
  ]
})

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const shortcuts = computed(() => {
  const mod = isMac ? '⌘' : t('wiki.editor.helper.shortcuts.ctrlKey')
  return [
  { keys: ['/'], descKey: 'wiki.editor.helper.shortcuts.slash' },
  { keys: [mod, '/'], descKey: 'wiki.editor.helper.shortcuts.helper' },
  { keys: [mod, 'B'], descKey: 'wiki.editor.helper.shortcuts.bold' },
  { keys: [mod, 'I'], descKey: 'wiki.editor.helper.shortcuts.italic' },
  { keys: [mod, 'K'], descKey: 'wiki.editor.helper.shortcuts.link' },
  { keys: [mod, 'V'], descKey: 'wiki.editor.helper.shortcuts.pasteImage' },
  ]
})

watch(() => props.modelValue, (open) => {
  if (!open) return
  tab.value = props.initialTab
  search.value = ''
  category.value = 'all'
  activeIndex.value = 0
  ensureTreeLoaded()
  focusSearch()
})

watch(tab, (value) => {
  if (value === 'insert') focusSearch()
})

/** After CommonModal has focused its first element, so the author can start typing right away. */
function focusSearch() {
  nextTick(() => requestAnimationFrame(() => {
    if (props.modelValue && tab.value === 'insert') searchRef.value?.focus()
  }))
}
</script>
