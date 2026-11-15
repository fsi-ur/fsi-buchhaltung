<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn-primary flex h-9 items-center gap-1.5 px-3 text-sm"
        :title="t('wiki.editor.toolbar.insertTitle', { shortcut: `${modKey}+/` })"
        @click="openHelper('insert')"
      >
        <Icon name="material-symbols:add-circle-outline-rounded" class="h-5 w-5" aria-hidden="true" />
        <span>{{ t('wiki.editor.toolbar.insert') }}</span>
      </button>

      <div class="wiki-toolbar-group">
        <button type="button" class="wiki-toolbar-btn" :title="`${t('wiki.editor.toolbar.bold')} (${modKey}+B)`" :aria-label="t('wiki.editor.toolbar.bold')" @click="wrap('**', '**')">
          <Icon name="material-symbols:format-bold-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="`${t('wiki.editor.toolbar.italic')} (${modKey}+I)`" :aria-label="t('wiki.editor.toolbar.italic')" @click="wrap('*', '*')">
          <Icon name="material-symbols:format-italic-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.heading')" :aria-label="t('wiki.editor.toolbar.heading')" @click="prefixLines('## ')">
          <Icon name="material-symbols:format-h2-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.code')" :aria-label="t('wiki.editor.toolbar.code')" @click="wrap('`', '`')">
          <Icon name="material-symbols:code-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="`${t('wiki.editor.toolbar.link')} (${modKey}+K)`" :aria-label="t('wiki.editor.toolbar.link')" @click="insertLink">
          <Icon name="material-symbols:link-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div class="wiki-toolbar-group">
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.list')" :aria-label="t('wiki.editor.toolbar.list')" @click="prefixLines('- ')">
          <Icon name="material-symbols:format-list-bulleted-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.numberedList')" :aria-label="t('wiki.editor.toolbar.numberedList')" @click="prefixLines('1. ')">
          <Icon name="material-symbols:format-list-numbered-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.table')" :aria-label="t('wiki.editor.toolbar.table')" @click="applySnippet({ text: WIKI_TABLE_SNIPPET, block: true })">
          <Icon name="material-symbols:table-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="wiki-toolbar-btn disabled:cursor-not-allowed disabled:opacity-40"
          :title="articleId ? t('wiki.editor.toolbar.image') : t('wiki.editor.toolbar.imageSaveFirst')"
          :aria-label="t('wiki.editor.toolbar.image')"
          :disabled="!articleId || uploadingImages > 0"
          @click="imageInputRef?.click()"
        >
          <Icon name="material-symbols:add-photo-alternate-outline-rounded" class="h-5 w-5" aria-hidden="true" />
        </button>
        <input
          ref="imageInputRef"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          class="hidden"
          @change="onImageInputChange"
        />
      </div>

      <div class="wiki-toolbar-group">
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.boxTitle')" @click="wrapBox('hinweis')">
          <Icon name="material-symbols:info-outline-rounded" class="h-4 w-4 text-info-500" aria-hidden="true" />
          {{ t('wiki.editor.toolbar.hint') }}
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.boxTitle')" @click="wrapBox('warnung')">
          <Icon name="material-symbols:warning-outline-rounded" class="h-4 w-4 text-warning-500" aria-hidden="true" />
          {{ t('wiki.editor.toolbar.warning') }}
        </button>
        <button type="button" class="wiki-toolbar-btn" :title="t('wiki.editor.toolbar.boxTitle')" @click="wrapBox('tipp')">
          <Icon name="material-symbols:lightbulb-outline-rounded" class="h-4 w-4 text-success-500" aria-hidden="true" />
          {{ t('wiki.editor.toolbar.tip') }}
        </button>
      </div>
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
          @input="onInput"
          @keydown="onKeydown"
          @paste="onPaste"
          @dragover="onDragOver"
          @drop="onDrop"
        ></textarea>
        <p class="mt-1 text-xs text-base-400">
          {{ t('wiki.editor.toolbar.slashHint', { shortcut: `${modKey}+/` }) }}
          <button type="button" class="cursor-pointer font-medium text-link-600 hover:text-link-800" @click="openHelper('reference')">
            {{ t('wiki.editor.toolbar.openReference') }}
          </button>
        </p>
        <p class="mt-0.5 text-xs text-base-400">
          <template v-if="uploadingImages > 0">{{ t('wiki.editor.toolbar.imageUploading') }}</template>
          <template v-else-if="articleId">{{ t('wiki.editor.toolbar.imageHint') }}</template>
          <template v-else>{{ t('wiki.editor.toolbar.imageSaveFirst') }}</template>
        </p>
      </div>

      <div class="flex flex-col" :class="mobileView === 'editor' ? 'hidden xl:flex' : ''">
        <p class="section-title">{{ t('wiki.editor.preview') }}</p>
        <div class="min-h-104 flex-1 overflow-y-auto rounded-lg border border-base-200 bg-white p-4">
          <CommonValidationSummary
            v-if="previewError"
            :errors="[previewError]"
            :title="t('common.validationBlocked')"
          />
          <PageWikiArticleBody v-else-if="previewHtml" :html="previewHtml" :checklists="checklists" :article-id="articleId" preview />
          <p v-else class="text-sm text-base-400">{{ t('wiki.editor.previewEmpty') }}</p>
        </div>
      </div>
    </div>

    <PageWikiArticleImageGallery
      v-if="articleId"
      :article-id="articleId"
      :images="images"
      :markdown="modelValue"
      :disabled="uploadingImages > 0"
      :before-delete="beforeImageDelete"
      @insert="chooseImage"
      @deleted="fileId => $emit('imageDeleted', fileId)"
    />

    <PageWikiArticleInsertHelper
      v-model="helperOpen"
      :initial-tab="helperTab"
      :selected-text="helperSelectedText"
      :checklists="checklists"
      :glossary-terms="glossaryTerms"
      :images="images"
      @insert="onHelperInsert"
      @update:model-value="open => { if (!open) onHelperClosed() }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useWikiGlossary } from '~/composables/useWikiGlossary'
import { useToast } from '~/composables/useToast'
import {
  WIKI_TABLE_SNIPPET,
  altFromFileName,
  applyWikiSnippet,
  buildImage,
  prefixWikiLines,
  type AppliedWikiSnippet,
  type WikiSnippet,
} from '~/utils/wikiSnippets'
import type { WikiInsertHelperTab } from '~/components/Page/Wiki/Article/InsertHelper.vue'
import type { PreviewResponse } from '~/server/api/wiki/preview.post'
import type { UploadWikiImageResponse } from '~/server/api/wiki/articles/[id]/images.post'
import type { GlossaryTermView } from '~/server/utils/wiki/glossary'
import type { WikiChecklistView, WikiImage } from '~/types/wiki'

const props = withDefaults(defineProps<{
  modelValue: string
  checklists?: WikiChecklistView[]
  /** The saved article; images can only be uploaded once it exists. */
  articleId?: number | null
  /** Images already uploaded into the article, offered for re-insertion. */
  images?: WikiImage[]
  /** Flushes pending edits before an image is deleted, so the server sees the current text. */
  beforeImageDelete?: () => Promise<void>
}>(), {
  checklists: () => [],
  articleId: null,
  images: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'imageUploaded', image: WikiImage): void
  (e: 'imageDeleted', fileId: number): void
}>()

const { t } = useI18n()
const { loadGlossary } = useWikiGlossary()
const toast = useToast()

const textareaId = useId()
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const imageInputRef = ref<HTMLInputElement | null>(null)
const uploadingImages = ref(0)
const mobileView = ref<'editor' | 'preview'>('editor')
const previewHtml = ref('')
const previewError = ref('')
const checklists = computed(() => props.checklists)
const glossaryTerms = ref<GlossaryTermView[]>([])

loadGlossary().then((terms) => { glossaryTerms.value = terms })

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const modKey = computed(() => isMac ? '⌘' : t('wiki.editor.helper.shortcuts.ctrlKey'))

function commit(result: AppliedWikiSnippet) {
  emit('update:modelValue', result.value)
  const textarea = textareaRef.value
  if (!textarea) return
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
  })
}

function currentRange() {
  const textarea = textareaRef.value
  if (!textarea) return { start: props.modelValue.length, end: props.modelValue.length }
  return { start: textarea.selectionStart, end: textarea.selectionEnd }
}

function applySnippet(snippet: WikiSnippet, range = currentRange()) {
  commit(applyWikiSnippet(props.modelValue, range.start, range.end, snippet))
}

function wrap(before: string, after: string) {
  applySnippet({ text: before, wrapAfter: after, block: false })
}

/** The selected text goes into the box; without a selection a placeholder is selected for typing over. */
function wrapBox(name: 'hinweis' | 'warnung' | 'tipp') {
  applySnippet({ text: `:::${name}\n`, wrapAfter: '\n:::', placeholder: t('wiki.editor.helper.placeholders.boxText'), block: true })
}

function prefixLines(prefix: string) {
  const { start, end } = currentRange()
  commit(prefixWikiLines(props.modelValue, start, end, prefix))
}

/** Selected text becomes the link text and the URL gets selected; without a selection the link text does. */
function insertLink() {
  const { start, end } = currentRange()
  const selected = props.modelValue.slice(start, end)
  if (!selected) {
    applySnippet({ text: '[', wrapAfter: '](https://)', placeholder: t('wiki.editor.helper.placeholders.linkText'), block: false })
    return
  }
  const result = applyWikiSnippet(props.modelValue, start, end, { text: `[${selected}](https://)`, block: false, replacesSelection: true })
  const urlStart = start + selected.length + 3
  commit({ ...result, selectionStart: urlStart, selectionEnd: urlStart + 'https://'.length })
}

const helperOpen = ref(false)
const helperTab = ref<WikiInsertHelperTab>('insert')
const helperSelectedText = ref('')
/** Where the helper's snippet goes; for the "/" trigger this covers the typed slash. */
const helperRange = ref<{ start: number, end: number, slash: boolean }>({ start: 0, end: 0, slash: false })
let helperInserted = false

function openHelper(tab: WikiInsertHelperTab, slashAt: number | null = null) {
  const range = currentRange()
  helperRange.value = slashAt === null
    ? { ...range, slash: false }
    : { start: slashAt, end: slashAt + 1, slash: true }
  helperSelectedText.value = slashAt === null ? props.modelValue.slice(range.start, range.end) : ''
  helperTab.value = tab
  helperInserted = false
  helperOpen.value = true
}

function onHelperInsert(snippet: WikiSnippet) {
  helperInserted = true
  const { start, end, slash } = helperRange.value
  if (!slash) {
    applySnippet(snippet, { start, end })
    return
  }
  // The typed "/" only opened the helper: drop it, then insert where it was.
  const withoutSlash = props.modelValue.slice(0, start) + props.modelValue.slice(end)
  commit(applyWikiSnippet(withoutSlash, start, start, snippet))
}

function onHelperClosed() {
  if (helperInserted) return
  // Cancelled: back to where the author was; a typed "/" simply stays as text.
  const { start, end, slash } = helperRange.value
  const textarea = textareaRef.value
  if (!textarea) return
  requestAnimationFrame(() => {
    textarea.focus()
    if (slash) textarea.setSelectionRange(end, end)
    else textarea.setSelectionRange(start, end)
  })
}

function onInput(event: globalThis.Event) {
  const textarea = event.target as HTMLTextAreaElement
  emit('update:modelValue', textarea.value)

  // "/" at the start of a line or after a space opens the helper — not inside URLs or "und/oder".
  const input = event as InputEvent
  if (input.inputType !== 'insertText' || input.data !== '/') return
  const slashAt = textarea.selectionStart - 1
  const before = slashAt > 0 ? textarea.value[slashAt - 1] ?? '' : ''
  if (slashAt === 0 || /\s/.test(before)) openHelper('insert', slashAt)
}

function onKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const key = event.key.toLowerCase()
  // "/" needs Shift on German keyboards (Shift+7), so Shift is only refused for the letter shortcuts.
  if (key === '/') openHelper('insert')
  else if (event.shiftKey) return
  else if (key === 'b') wrap('**', '**')
  else if (key === 'i') wrap('*', '*')
  else if (key === 'k') insertLink()
  else return
  event.preventDefault()
}

// ---- Images -------------------------------------------------------------------------------------

function chooseImage(image: WikiImage) {
  applySnippet({ text: buildImage(image.fileId, altFromFileName(image.fileName)), block: true })
}

function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  const files: File[] = []
  for (const entry of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null
    if (file && /^image\//.test(file.type)) files.push(file)
  }
  return files
}

async function uploadImages(files: File[]) {
  if (!props.articleId) {
    toast.error(t('wiki.editor.toolbar.imageSaveFirst'))
    return
  }

  // One after another, so several dropped images land in the order they were picked.
  for (const file of files) {
    uploadingImages.value += 1
    try {
      const formData = new FormData()
      formData.append('file', file, file.name || 'bild.png')
      const res = await apiFetch<UploadWikiImageResponse>(`/api/wiki/articles/${props.articleId}/images`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        toast.error(res.error)
        continue
      }
      emit('imageUploaded', res.image)
      applySnippet({ text: res.markdown, block: true })
    } catch {
      toast.error(t('wiki.editor.toolbar.imageUploadFailed'))
    } finally {
      uploadingImages.value -= 1
    }
  }
}

function onImageInputChange(event: globalThis.Event) {
  const input = event.target as HTMLInputElement
  const files = imageFiles(input.files)
  input.value = ''
  if (files.length) uploadImages(files)
}

function onPaste(event: ClipboardEvent) {
  const files = imageFiles(event.clipboardData?.items)
  if (!files.length) return
  event.preventDefault()
  uploadImages(files)
}

function onDragOver(event: DragEvent) {
  if (Array.from(event.dataTransfer?.items ?? []).some(item => item.kind === 'file')) event.preventDefault()
}

function onDrop(event: DragEvent) {
  const files = imageFiles(event.dataTransfer?.files)
  if (!files.length) return
  event.preventDefault()
  textareaRef.value?.focus()
  uploadImages(files)
}

let previewTimer: ReturnType<typeof setTimeout> | null = null

async function refreshPreview() {
  if (!props.modelValue.trim()) {
    previewHtml.value = ''
    previewError.value = ''
    return
  }

  const res = await apiFetch<PreviewResponse>('/api/wiki/preview', {
    method: 'POST',
    body: {
      markdown: props.modelValue,
      knownChecklists: props.checklists.map(entry => entry.keySlug),
      articleId: props.articleId ?? undefined,
    },
  })

  if (res.ok) {
    previewHtml.value = res.html
    previewError.value = ''
  } else {
    previewError.value = res.error
  }
}

watch(
  () => [props.modelValue, props.checklists.map(entry => entry.keySlug).join(','), props.images.length],
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
