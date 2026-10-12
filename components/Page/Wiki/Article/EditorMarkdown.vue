<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="wiki-toolbar-group">
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.bold')" :aria-label="t('wiki.editor.toolbar.bold')" @click="wrap('**', '**')">
          <Icon name="material-symbols:format-bold-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.italic')" :aria-label="t('wiki.editor.toolbar.italic')" @click="wrap('*', '*')">
          <Icon name="material-symbols:format-italic-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.heading')" :aria-label="t('wiki.editor.toolbar.heading')" @click="prefixLine('## ')">
          <Icon name="material-symbols:format-h2-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.code')" :aria-label="t('wiki.editor.toolbar.code')" @click="wrap('`', '`')">
          <Icon name="material-symbols:code-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.link')" :aria-label="t('wiki.editor.toolbar.link')" @click="wrap('[', '](https://)')">
          <Icon name="material-symbols:link-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div class="wiki-toolbar-group">
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.list')" :aria-label="t('wiki.editor.toolbar.list')" @click="prefixLine('- ')">
          <Icon name="material-symbols:format-list-bulleted-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.numberedList')" :aria-label="t('wiki.editor.toolbar.numberedList')" @click="prefixLine('1. ')">
          <Icon name="material-symbols:format-list-numbered-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.table')" :aria-label="t('wiki.editor.toolbar.table')" @click="insertBlock(TABLE_SNIPPET)">
          <Icon name="material-symbols:table-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div class="wiki-toolbar-group">
        <button type="button" class="wiki-toolbar-btn" @click="insertBlock(':::hinweis\n\n:::')">
          <Icon name="material-symbols:info-outline-rounded" class="h-4 w-4 text-info-500" aria-hidden="true" />
          {{ t('wiki.editor.toolbar.hint') }}
        </button>
        <button type="button" class="wiki-toolbar-btn" @click="insertBlock(':::warnung\n\n:::')">
          <Icon name="material-symbols:warning-outline-rounded" class="h-4 w-4 text-warning-500" aria-hidden="true" />
          {{ t('wiki.editor.toolbar.warning') }}
        </button>
        <button type="button" class="wiki-toolbar-btn" @click="insertBlock(':::tipp\n\n:::')">
          <Icon name="material-symbols:lightbulb-outline-rounded" class="h-4 w-4 text-success-500" aria-hidden="true" />
          {{ t('wiki.editor.toolbar.tip') }}
        </button>
      </div>

      <MenuDropdown v-model="openInsertMenu" id="insert" wrapper-class="relative w-auto">
        <template #trigger="{ styling }">
          <button type="button" :class="[styling, 'w-auto cursor-pointer gap-1.5 py-2 text-sm']">
            <Icon name="material-symbols:add-circle-outline-rounded" class="text-base text-base-500" aria-hidden="true" />
            <span>{{ t('wiki.editor.toolbar.insert') }}</span>
            <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
          </button>
        </template>

        <template #default="{ styling }">
          <div class="px-3 py-1 text-xs font-semibold text-base-500">{{ t('wiki.editor.toolbar.insertTool') }}</div>
          <button
            v-for="page in toolPages"
            :key="`tool:${page}`"
            type="button"
            :class="styling"
            @click="chooseInsert(`tool:${page}`)"
          >
            {{ pageLabel(page) }}
          </button>
          <div v-if="settingsTabs.length" class="px-3 py-1 text-xs font-semibold text-base-500">{{ t('wiki.editor.toolbar.insertSettingsTab') }}</div>
          <button
            v-for="tab in settingsTabs"
            :key="`settingsTab:${tab.key}`"
            type="button"
            :class="styling"
            @click="chooseInsert(`settingsTab:${tab.key}`)"
          >
            {{ t(tab.labelKey) }}
          </button>
          <template v-if="canLinkEventTab">
            <div class="px-3 py-1 text-xs font-semibold text-base-500">{{ t('wiki.editor.toolbar.insertEventTab') }}</div>
            <button type="button" :class="styling" @click="openEventTabPicker">
              {{ t('wiki.editor.toolbar.insertEventTab') }}
            </button>
          </template>
          <div class="px-3 py-1 text-xs font-semibold text-base-500">{{ t('wiki.editor.toolbar.insertEmbed') }}</div>
          <button
            v-for="embed in embeds"
            :key="`embed:${embed.key}`"
            type="button"
            :class="styling"
            @click="chooseInsert(`embed:${embed.key}`)"
          >
            {{ t(embed.labelKey) }}
            <span v-if="embed.argsSchema" class="ml-1 text-xs text-base-400">
              {{ Object.keys(embed.argsSchema).join(', ') }}
            </span>
          </button>
          <div class="px-3 py-1 text-xs font-semibold text-base-500">{{ t('wiki.editor.toolbar.insertChecklist') }}</div>
          <p v-if="!checklists.length" class="px-3 py-1 text-xs text-base-400">
            {{ t('wiki.editor.toolbar.noChecklists') }}
          </p>
          <button
            v-for="checklist in checklists"
            :key="`checklist:${checklist.keySlug}`"
            type="button"
            :class="styling"
            @click="chooseInsert(`checklist:${checklist.keySlug}`)"
          >
            {{ checklist.title }}
            <span class="ml-1 text-xs text-base-400">{{ checklist.keySlug }}</span>
          </button>
          <div class="px-3 py-1 text-xs font-semibold text-base-500">{{ t('wiki.editor.toolbar.insertGlossary') }}</div>
          <p v-if="!glossaryTerms.length" class="px-3 py-1 text-xs text-base-400">
            {{ t('wiki.editor.toolbar.noGlossaryTerms') }}
          </p>
          <button
            v-for="entry in glossaryTerms"
            :key="`glossary:${entry.key}`"
            type="button"
            :class="styling"
            @click="chooseInsert(`glossary:${entry.key}`)"
          >
            {{ entry.term }}
            <span class="ml-1 text-xs text-base-400">{{ entry.key }}</span>
          </button>
        </template>
      </MenuDropdown>
    </div>

    <div class="segmented xl:hidden" role="group">
      <button
        type="button"
        class="segmented-option"
        :class="mobileView === 'editor' ? 'segmented-option-active' : ''"
        :aria-pressed="mobileView === 'editor'"
        @click="mobileView = 'editor'"
      >{{ t('wiki.editor.showEditor') }}</button>
      <button
        type="button"
        class="segmented-option"
        :class="mobileView === 'preview' ? 'segmented-option-active' : ''"
        :aria-pressed="mobileView === 'preview'"
        @click="mobileView = 'preview'"
      >{{ t('wiki.editor.showPreview') }}</button>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div class="flex flex-col" :class="mobileView === 'preview' ? 'hidden xl:flex' : ''">
        <label class="section-title" :for="textareaId">{{ t('wiki.editor.markdown') }}</label>
        <textarea
          :id="textareaId"
          ref="textareaRef"
          :value="modelValue"
          class="input min-h-104 flex-1 font-mono text-sm leading-relaxed"
          spellcheck="false"
          @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </div>

      <div class="flex flex-col" :class="mobileView === 'editor' ? 'hidden xl:flex' : ''">
        <p class="section-title">{{ t('wiki.editor.preview') }}</p>
        <div class="min-h-104 flex-1 overflow-y-auto rounded-lg border border-base-200 bg-white p-4">
          <CommonValidationSummary
            v-if="previewError"
            :errors="[previewError]"
            :title="t('common.validationBlocked')"
          />
          <PageWikiArticleBody v-else-if="previewHtml" :html="previewHtml" :checklists="checklists" preview />
          <p v-else class="text-sm text-base-400">{{ t('wiki.editor.previewEmpty') }}</p>
        </div>
      </div>
    </div>

    <CommonModal v-model="eventTabModalOpen" :title="t('wiki.editor.eventTabLink.title')">
      <div class="field">
        <label class="section-title">{{ t('wiki.editor.eventTabLink.eventLabel') }}</label>
        <CommonSearchSelect
          v-model="eventQuery"
          :options="eventOptions"
          :selected-label="selectedEvent ? eventLabel(selectedEvent) : ''"
          :placeholder="t('wiki.editor.eventTabLink.eventPlaceholder')"
          :empty-text="t('wiki.editor.eventTabLink.noEvents')"
          @select="onSelectEvent"
          @clear-selection="selectedEvent = null"
        />
      </div>

      <div v-if="selectedEvent" class="field">
        <label class="section-title">{{ t('wiki.editor.eventTabLink.tabLabel') }}</label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tab in linkableEventTabs"
            :key="tab.key"
            type="button"
            class="cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
            :class="selectedEventTab === tab.key
              ? 'border-accent-400 bg-accent-50 text-accent-700'
              : 'border-base-200 bg-white text-base-600 hover:bg-base-100'"
            @click="selectedEventTab = tab.key"
          >
            {{ t(tab.labelKey) }}
          </button>
        </div>
      </div>

      <template #footer>
        <button type="button" class="btn-secondary" @click="eventTabModalOpen = false">
          {{ t('wiki.editor.eventTabLink.cancel') }}
        </button>
        <button
          type="button"
          class="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!selectedEvent || !selectedEventTab"
          @click="insertEventTabLink"
        >
          {{ t('wiki.editor.eventTabLink.insert') }}
        </button>
      </template>
    </CommonModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { PAGES } from '~/config/pages'
import { WIKI_EMBEDS } from '~/config/wikiEmbeds'
import { SETTINGS_TABS } from '~/config/settingsTabs'
import { EVENT_PLANNING_TABS } from '~/config/eventPlanningTabs'
import { useAuth } from '~/composables/useAuth'
import { useWikiGlossary } from '~/composables/useWikiGlossary'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { PreviewResponse } from '~/server/api/wiki/preview.post'
import type { GetEventsResponse } from '~/server/api/events/index.get'
import type { GlossaryTermView } from '~/server/utils/wiki/glossary'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { Event } from '~/types/event'
import type { WikiChecklistView } from '~/types/wiki'

const props = withDefaults(defineProps<{
  modelValue: string
  checklists?: WikiChecklistView[]
}>(), {
  checklists: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()
const { loadGlossary } = useWikiGlossary()
const { formatDateTime } = useLocaleFormatters()

const TABLE_SNIPPET = '| Spalte | Spalte |\n| --- | --- |\n| Wert | Wert |'

const textareaId = useId()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const mobileView = ref<'editor' | 'preview'>('editor')
const openInsertMenu = ref<string | null>(null)
const previewHtml = ref('')
const previewError = ref('')
const embeds = WIKI_EMBEDS
const checklists = computed(() => props.checklists)
const glossaryTerms = ref<GlossaryTermView[]>([])

loadGlossary().then((terms) => { glossaryTerms.value = terms })

const toolPages = Object.entries(PAGES)
  .filter(([, page]) => !page.permissions.length || hasPermission(page.permissions))
  .map(([name]) => name)
  .sort()

function pageLabel(name: string) {
  const page = PAGES[name]
  return page ? `${t(page.labelKey)} (${name})` : name
}

const settingsTabs = computed(() => SETTINGS_TABS
  .filter(tab => !tab.permission || hasPermission(tab.permission)))

const canLinkEventTab = computed(() => {
  const page = PAGES.EventCreate
  if (!page) return false
  return !page.permissions.length || hasPermission(page.permissions)
})

const runtimeConfig = useRuntimeConfig()
const cashRegisterAvailable = computed(() =>
  runtimeConfig.public.cashRegisterMode === 'connected' && hasPermission('cash_register.manage'),
)
const linkableEventTabs = computed(() => EVENT_PLANNING_TABS
  .filter(tab => tab.key !== 'cashRegister' || cashRegisterAvailable.value))
const DEFAULT_EVENT_TAB = EVENT_PLANNING_TABS[0]?.key ?? 'overview'

const eventTabModalOpen = ref(false)
const eventQuery = ref('')
const events = ref<Event[]>([])
const eventsLoaded = ref(false)
const selectedEvent = ref<Event | null>(null)
const selectedEventTab = ref(DEFAULT_EVENT_TAB)

const eventOptions = computed<SearchSelectOption<number>[]>(() => events.value
  .map(event => ({
    key: event.id,
    label: eventLabel(event),
    searchText: [event.name, event.location].filter(Boolean).join(' '),
    value: event.id,
  })))

function eventLabel(event: Event) {
  const startsAt = formatDateTime(event.starts_at)
  return [event.name, startsAt, event.location].filter(Boolean).join(' | ')
}

async function ensureEventsLoaded() {
  if (eventsLoaded.value) return
  eventsLoaded.value = true
  const res = await $fetch<GetEventsResponse>('/api/events')
  if (res.ok) events.value = res.events
}

function openEventTabPicker() {
  openInsertMenu.value = null
  eventQuery.value = ''
  selectedEvent.value = null
  selectedEventTab.value = DEFAULT_EVENT_TAB
  eventTabModalOpen.value = true
  ensureEventsLoaded()
}

function onSelectEvent(value: unknown) {
  selectedEvent.value = events.value.find(event => event.id === value) ?? null
}

function escapeAttr(value: string) {
  return value.replace(/"/g, "'")
}

function insertEventTabLink() {
  const event = selectedEvent.value
  if (!event || !selectedEventTab.value) return

  const tab = EVENT_PLANNING_TABS.find(entry => entry.key === selectedEventTab.value)
  const label = escapeAttr(`${event.name} – ${tab ? t(tab.labelKey) : selectedEventTab.value}`)
  const meta = JSON.stringify({ returnTarget: 'self', eventId: event.id, tab: selectedEventTab.value })
  eventTabModalOpen.value = false
  insertBlock(`:::tool{page="EventCreate" meta='${meta}' label="${label}"}`)
}

function replaceSelection(build: (selected: string) => { text: string, cursor?: number }) {
  const textarea = textareaRef.value
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = props.modelValue.slice(start, end)
  const { text, cursor } = build(selected)

  const next = props.modelValue.slice(0, start) + text + props.modelValue.slice(end)
  emit('update:modelValue', next)

  requestAnimationFrame(() => {
    textarea.focus()
    const position = start + (cursor ?? text.length)
    textarea.setSelectionRange(position, position)
  })
}

function wrap(before: string, after: string) {
  replaceSelection(selected => ({ text: `${before}${selected}${after}`, cursor: before.length + selected.length }))
}

function prefixLine(prefix: string) {
  replaceSelection(selected => ({ text: `${prefix}${selected}` }))
}

function insertBlock(snippet: string) {
  replaceSelection(selected => ({ text: `${selected ? `${selected}\n\n` : ''}${snippet}\n` }))
}

function chooseInsert(value: string) {
  openInsertMenu.value = null

  const [kind, key = ''] = value.split(':')
  if (kind === 'glossary') {
    replaceSelection(selected => ({ text: `[[glossar:${key}${selected ? `|${selected}` : ''}]]` }))
    return
  }
  if (kind === 'checklist') {
    insertBlock(`:::checklist{id="${key}"}`)
    return
  }
  if (kind === 'tool') {
    const page = PAGES[key]
    insertBlock(`:::tool{page="${key}" meta='{"returnTarget":"self"}' label="${page ? t(page.labelKey) : key}"}`)
    return
  }
  if (kind === 'settingsTab') {
    const tab = SETTINGS_TABS.find(entry => entry.key === key)
    const label = escapeAttr(`${t('pages.settings')} – ${tab ? t(tab.labelKey) : key}`)
    insertBlock(`:::tool{page="Settings" meta='{"returnTarget":"self","tab":"${key}"}' label="${label}"}`)
    return
  }

  insertBlock(`:::embed{widget="${key}"}`)
}

let previewTimer: ReturnType<typeof setTimeout> | null = null

async function refreshPreview() {
  if (!props.modelValue.trim()) {
    previewHtml.value = ''
    previewError.value = ''
    return
  }

  const res = await $fetch<PreviewResponse>('/api/wiki/preview', {
    method: 'POST',
    body: { markdown: props.modelValue, knownChecklists: props.checklists.map(entry => entry.keySlug) },
  })

  if (res.ok) {
    previewHtml.value = res.html
    previewError.value = ''
  } else {
    previewError.value = res.error
  }
}

watch(
  () => [props.modelValue, props.checklists.map(entry => entry.keySlug).join(',')],
  () => {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(refreshPreview, 400)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
})
</script>
