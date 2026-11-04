<template>
  <div ref="rootRef" class="text-base-700 lg:w-full" :class="previewUrl && !compact ? '-mx-6 lg:mx-0' : ''">
    <div
      v-if="!modelValue && !existingFile"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
      @click="fileInput?.click()"
      :class="[
        'relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200',
        isDragging ? 'border-link-500 bg-link-50' : 'border-base-300 bg-base-50 hover:bg-base-100'
      ]"
    >
      <div class="flex flex-col items-center justify-center pt-5 pb-6">
        <svg class="w-10 h-10 mb-3 text-base-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
        </svg>
        <p class="mb-2 text-sm text-base-500"><span class="font-semibold">{{ t('files.clickUpload') }}</span> {{ t('files.dragDrop') }}</p>
        <p class="text-xs text-base-500">{{ allowedTypeLabel }}</p>
      </div>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        :accept="acceptAttribute"
        :multiple="allowMultiImageUpload"
        @change="handleFileSelect"
      />
    </div>

    <div
      v-else-if="previewUrl"
      :class="compact ? 'relative flex flex-col w-full border border-base-200 rounded-lg overflow-hidden bg-base-800 group shadow-lg' : 'relative flex flex-col w-full border-y border-base-200 lg:border lg:rounded-lg overflow-hidden bg-base-800 group shadow-lg'"
      :style="compact ? {} : { height: `${previewHeight}px` }"
    >
      <div class="file-preview-toolbar z-20 flex items-center justify-between gap-3 p-3 bg-black/70 backdrop-blur-sm">
        <div class="flex items-center space-x-3 text-white">
          <span class="text-sm font-medium truncate max-w-50">{{ displayName }}</span>
          <span class="text-xs text-base-300">({{ displaySize }} MB)</span>
        </div>

        <div class="flex items-center space-x-2 bg-base-700/50 rounded-lg p-1">
          <button @click="zoomOut" class="p-1.5 hover:bg-base-600 rounded text-white transition disabled:opacity-50 cursor-pointer" title="Zoom Out">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
          </button>

          <span class="text-xs font-mono text-white w-12 text-center">{{ Math.round(zoomLevel * 100) }}%</span>

          <button @click="zoomIn" class="p-1.5 hover:bg-base-600 rounded text-white transition disabled:opacity-50 cursor-pointer" title="Zoom In">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          </button>

          <div v-if="isPdf" class="w-px h-4 bg-base-500 mx-1"></div>

          <template v-if="isPdf">
            <button @click="prevPage" :disabled="currentPage <= 1" class="p-1.5 hover:bg-base-600 rounded text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <span class="text-xs text-white whitespace-nowrap px-1">
              {{ currentPage }} / {{ pdfPageCount }}
            </span>
            <button @click="nextPage" :disabled="currentPage >= pdfPageCount" class="p-1.5 hover:bg-base-600 rounded text-white transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
          </template>
        </div>

        <div class="flex items-center gap-2">
          <button
            @click="downloadFile"
            class="flex h-9 items-center gap-1.5 rounded-lg bg-base-700/50 px-3 text-xs font-medium text-white transition hover:bg-base-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!previewUrl"
            :aria-label="t('files.download')"
            :title="t('files.download')"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16"/></svg>
            <span>{{ t('files.download') }}</span>
          </button>

          <button
            @click="removeFile"
            class="flex h-9 items-center gap-1.5 rounded-lg bg-danger-600/80 px-3 text-xs font-medium text-white transition hover:bg-danger-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!canEdit"
            :aria-label="t('files.remove')"
            :title="t('files.remove')"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            <span>{{ t('files.remove') }}</span>
          </button>
        </div>
      </div>

      <div
        ref="containerRef"
        class="file-preview-content w-full flex-1 min-h-0 overflow-auto bg-base-800 custom-scrollbar"
        :style="compact ? { maxHeight: `${COMPACT_MAX_HEIGHT}px` } : {}"
      >
        <div v-if="isPdf" class="relative shadow-2xl bg-white transition-all duration-200">
          <VuePdfEmbed
            :source="previewUrl"
            :page="pdfRenderPage"
            :width="pdfRenderWidth"
            :text-layer="true"
            class="relative"
            @loaded="onPdfLoaded"
            @rendered="onPdfRenderSettled"
            @rendering-failed="onPdfRenderSettled"
            @loading-failed="onPdfRenderSettled"
          />
        </div>

        <div v-else-if="isImage" class="min-w-max transition-all duration-200">
          <img
            ref="imageRef"
            :src="previewUrl"
            :style="{ width: computedWidth + 'px' }"
            class="block h-auto shadow-2xl"
            alt="Preview"
            @load="onImageLoaded"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { PDFDocument } from 'pdf-lib'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { PDFDocumentProxy } from 'pdfjs-dist'

const VuePdfEmbed = defineAsyncComponent(() => import('vue-pdf-embed'))

type SupportedFileType = 'pdf' | 'png' | 'jpg' | 'jpeg'

const FILE_TYPE_MIME_MAP: Record<SupportedFileType, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpg', 'image/jpeg'],
  jpeg: ['image/jpeg'],
}

const FILE_TYPE_LABEL_MAP: Record<SupportedFileType, string> = {
  pdf: 'PDF',
  png: 'PNG',
  jpg: 'JPG',
  jpeg: 'JPEG',
}

const props = withDefaults(defineProps<{
  modelValue: File | null
  canEdit?: boolean
  normalizeImages?: boolean
  allowedFileTypes?: SupportedFileType[]
  /** Use when embedding outside the full-page receipt/invoice editor layout: skips the
   * viewport/`data-finance-form-column`-aware height calculation (which assumes it sits
   * directly in that page's cards grid) and caps the preview to a fixed max height instead. */
  compact?: boolean
  existingFile?: {
    id: number
    url: string
    name: string
    mime_type: string
    size: number
  } | null
}>(), {
  normalizeImages: true,
  allowedFileTypes: () => ['pdf', 'png', 'jpg', 'jpeg'],
  compact: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: File | null): void
  (e: 'remove-existing'): void
}>()

const isDragging = ref<boolean>(false)
const previewUrl = ref<string | undefined>(undefined)
const rootRef = ref<HTMLDivElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)
const pdfPageCount = ref<number>(0)
const currentPage = ref<number>(1)
const containerRef = ref<HTMLDivElement | null>(null)
const containerWidth = ref<number>(800)
const previewHeight = ref<number>(800)
const intrinsicContentHeight = ref<number>(800)
const pdfDocument = shallowRef<PDFDocumentProxy | null>(null)
const zoomLevel = ref<number>(1.0)
const pdfLoading = ref<boolean>(false)
const ownedPreviewUrl = ref<string | null>(null)
const { t } = useI18n()
const toast = useToast()

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4.0
const ZOOM_STEP = 0.25
const MAX_IMAGE_LONG_EDGE = 2200
const NORMALIZED_IMAGE_TYPE = 'image/jpeg'
const NORMALIZED_IMAGE_EXTENSION = 'jpg'
const NORMALIZED_IMAGE_QUALITY = 0.85

const computedWidth = computed<number>(() => {
  return Math.floor(containerWidth.value * zoomLevel.value)
})

// vue-pdf-embed breaks (and clears all pages) when its width/page props change again while
// a previous change is still rendering, so prop updates are held back until the render settles.
const pdfRenderWidth = ref<number>(computedWidth.value)
const pdfRenderPage = ref<number>(currentPage.value)
let pdfRendering = false

const syncPdfRenderProps = (): void => {
  if (pdfRendering) return
  if (pdfRenderWidth.value === computedWidth.value && pdfRenderPage.value === currentPage.value) return

  pdfRendering = Boolean(pdfDocument.value)
  pdfRenderWidth.value = computedWidth.value
  pdfRenderPage.value = currentPage.value
}

function onPdfRenderSettled() {
  pdfRendering = false
  syncPdfRenderProps()
}

const allowedMimeTypes = computed(() => [...new Set(props.allowedFileTypes.flatMap((type) => FILE_TYPE_MIME_MAP[type]))])
const acceptAttribute = computed(() => allowedMimeTypes.value.join(','))
const allowedTypeLabel = computed(() => props.allowedFileTypes.map((type) => FILE_TYPE_LABEL_MAP[type]).join(', '))

const activeFileType = computed(() => {
  if (props.modelValue) return props.modelValue.type
  if (props.existingFile) return props.existingFile.mime_type
})

const isPdf = computed(() => activeFileType.value === 'application/pdf')
const isImage = computed(() => activeFileType.value?.startsWith('image/'))
const allowMultiImageUpload = computed(() => {
  const allowsPdf = props.allowedFileTypes.includes('pdf')
  const allowsImages = props.allowedFileTypes.some(type => type !== 'pdf')
  return allowsPdf && allowsImages
})

let resizeObserver: ResizeObserver | null = null

const updateContainerWidth = (): void => {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth
  }
}

const getFormColumn = (): HTMLElement | null => {
  const gridItem = rootRef.value?.parentElement
  const grid = gridItem?.parentElement
  if (!gridItem || !grid) return null
  return Array.from(grid.children).find((child) =>
    child !== gridItem && child instanceof HTMLElement && child.hasAttribute('data-finance-form-column')
  ) as HTMLElement | null
}

const getFormContentHeight = (): number => {
  const formColumn = getFormColumn()
  if (!formColumn) return 0
  return formColumn.getBoundingClientRect().height
}

const getCardsGrid = (): HTMLElement | null => {
  const gridItem = rootRef.value?.parentElement
  const grid = gridItem?.parentElement
  return grid instanceof HTMLElement ? grid : null
}

const getVerticalPadding = (element: HTMLElement | null): number => {
  if (!element) return 0
  const style = window.getComputedStyle(element)
  const top = Number.parseFloat(style.paddingTop || '0') || 0
  const bottom = Number.parseFloat(style.paddingBottom || '0') || 0
  return top + bottom
}

const getViewportAvailableHeight = (): number => {
  if (!rootRef.value) return 0

  const main = rootRef.value.closest('main') as HTMLElement | null
  const pageRoot = rootRef.value.closest('#page-root') as HTMLElement | null
  const cardsGrid = getCardsGrid()

  const mainPadding = getVerticalPadding(main)
  const pagePadding = getVerticalPadding(pageRoot)

  let headerFootprint = 0
  if (pageRoot && cardsGrid) {
    const pageRootRect = pageRoot.getBoundingClientRect()
    const cardsGridRect = cardsGrid.getBoundingClientRect()
    const pagePaddingTop = Number.parseFloat(window.getComputedStyle(pageRoot).paddingTop || '0') || 0
    headerFootprint = Math.max(0, cardsGridRect.top - pageRootRect.top - pagePaddingTop)
  }

  return Math.max(0, window.innerHeight - mainPadding - pagePadding - headerFootprint)
}

const COMPACT_MAX_HEIGHT = 480

const updatePreviewHeight = (): void => {
  if (!rootRef.value || !previewUrl.value) return

  if (props.compact) {
    previewHeight.value = Math.max(1, Math.min(intrinsicContentHeight.value, COMPACT_MAX_HEIGHT))
    return
  }

  const viewportAvailableHeight = getViewportAvailableHeight()
  const formHeight = getFormContentHeight()
  const targetHeight = formHeight > viewportAvailableHeight ? formHeight : viewportAvailableHeight
  previewHeight.value = Math.max(1, Math.min(intrinsicContentHeight.value, targetHeight))
}

const updateLayout = (): void => {
  updateContainerWidth()
  updatePreviewHeight()
}

let pdfMeasurementToken = 0

const updateIntrinsicHeight = async (): Promise<void> => {
  if (isImage.value) {
    const image = imageRef.value
    if (!image?.naturalWidth || !image.naturalHeight) return

    intrinsicContentHeight.value = Math.ceil(computedWidth.value * (image.naturalHeight / image.naturalWidth))
    updatePreviewHeight()
    return
  }

  if (isPdf.value && pdfDocument.value) {
    const measurementToken = ++pdfMeasurementToken
    const page = await pdfDocument.value.getPage(currentPage.value)
    if (measurementToken !== pdfMeasurementToken) return

    const viewport = page.getViewport({ scale: 1 })
    if (viewport.width > 0 && viewport.height > 0) {
      intrinsicContentHeight.value = Math.ceil(computedWidth.value * (viewport.height / viewport.width))
      updatePreviewHeight()
    }
  }
}

const initializeObservers = (): void => {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (typeof ResizeObserver === 'undefined') return

  const targets = [containerRef.value, getFormColumn()].filter((el): el is HTMLElement => Boolean(el))
  if (!targets.length) return

  resizeObserver = new ResizeObserver(() => {
    updateLayout()
    void updateIntrinsicHeight()
  })

  for (const target of targets) resizeObserver.observe(target)
}

onMounted(() => {
  updateLayout()
  window.addEventListener('resize', updateLayout)
})

function revokeOwnedPreviewUrl() {
  if (!ownedPreviewUrl.value) return
  URL.revokeObjectURL(ownedPreviewUrl.value)
  ownedPreviewUrl.value = null
}

onUnmounted(() => {
  revokeOwnedPreviewUrl()
  window.removeEventListener('resize', updateLayout)
  resizeObserver?.disconnect()
})

watch(
  () => [props.modelValue, props.existingFile],
  async () => {
    revokeOwnedPreviewUrl()

    if (props.modelValue) {
      ownedPreviewUrl.value = URL.createObjectURL(props.modelValue)
      previewUrl.value = ownedPreviewUrl.value
    } else if (props.existingFile) {
      previewUrl.value = props.existingFile.url
    } else {
      previewUrl.value = undefined
    }

    await nextTick()
    currentPage.value = 1
    zoomLevel.value = 1.0

    intrinsicContentHeight.value = 800
    pdfDocument.value = null
    pdfRendering = isPdf.value
    pdfRenderWidth.value = computedWidth.value
    pdfRenderPage.value = currentPage.value
    updateLayout()
    initializeObservers()
    void updateIntrinsicHeight()
  },
  { immediate: true }
)

watch([computedWidth, currentPage], async () => {
  syncPdfRenderProps()
  await nextTick()
  void updateIntrinsicHeight()
})

const displayName = computed(() => {
  if (props.modelValue) return props.modelValue.name
  if (props.existingFile) return props.existingFile.name
  return ''
})

const displaySize = computed(() => {
  if (props.modelValue) return (props.modelValue.size / 1024 / 1024).toFixed(2)
  if (props.existingFile) return (props.existingFile.size / 1024 / 1024).toFixed(2)
  return ''
})

function onPdfLoaded(doc: PDFDocumentProxy) {
  pdfDocument.value = doc
  pdfPageCount.value = doc.numPages
  pdfLoading.value = false
  nextTick(() => void updateIntrinsicHeight())
}

function onImageLoaded() {
  nextTick(() => void updateIntrinsicHeight())
}

function fileHasAllowedMimeType(file: File) {
  return allowedMimeTypes.value.includes(file.type)
}

function isImageFile(file: File) {
  return file.type.startsWith('image/')
}

function sanitizeFileNamePart(name: string) {
  return name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'upload'
}

function normalizedImageFileName(file: File) {
  const baseName = sanitizeFileNamePart(file.name)
  return `${baseName}.${NORMALIZED_IMAGE_EXTENSION}`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function loadImageDimensions(dataUrl: string) {
  return new Promise<{ width: number, height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = dataUrl
  })
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image'))
    }
    image.src = objectUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }

      reject(new Error('Failed to encode image'))
    }, type, quality)
  })
}

async function normalizeImageFile(file: File) {
  if (!props.normalizeImages || !isImageFile(file)) return file

  const image = await loadImageElement(file)
  const longEdge = Math.max(image.naturalWidth, image.naturalHeight)
  const scale = longEdge > MAX_IMAGE_LONG_EDGE ? MAX_IMAGE_LONG_EDGE / longEdge : 1
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale))
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Failed to prepare image')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  const blob = await canvasToBlob(canvas, NORMALIZED_IMAGE_TYPE, NORMALIZED_IMAGE_QUALITY)
  return new File([blob], normalizedImageFileName(file), {
    type: NORMALIZED_IMAGE_TYPE,
    lastModified: file.lastModified,
  })
}

async function normalizeFiles(files: File[]) {
  return Promise.all(files.map(file => normalizeImageFile(file)))
}

async function createPdfFromImages(files: File[]) {
  const pdf = await PDFDocument.create()

  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file)
    const dimensions = await loadImageDimensions(dataUrl)
    const embeddedImage = file.type === 'image/png'
      ? await pdf.embedPng(dataUrl)
      : await pdf.embedJpg(dataUrl)

    const page = pdf.addPage([dimensions.width, dimensions.height])
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: dimensions.width,
      height: dimensions.height,
    })
  }

  const pdfBytes = await pdf.save()
  const baseName = sanitizeFileNamePart(files[0]?.name || 'upload')
  const pdfBlob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
  return new File([pdfBlob], `${baseName}.pdf`, { type: 'application/pdf' })
}

async function processFiles(files: File[]) {
  if (files.length === 0) return

  if (!files.every(fileHasAllowedMimeType)) {
    toast.error(t('files.uploadError'))
    return
  }

  let normalizedFiles: File[]
  try {
    normalizedFiles = await normalizeFiles(files)
  } catch {
    toast.error(t('files.uploadError'))
    return
  }

  if (files.length === 1) {
    emit('update:modelValue', normalizedFiles[0] || null)
    return
  }

  if (!allowMultiImageUpload.value || !normalizedFiles.every(isImageFile)) {
    toast.error(t('files.uploadError'))
    return
  }

  try {
    const mergedPdf = await createPdfFromImages(normalizedFiles)
    emit('update:modelValue', mergedPdf)
  } catch {
    toast.error(t('files.uploadError'))
  }
}

async function handleDrop(e: DragEvent) {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  await processFiles(Array.from(files))
}

async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement | null
  const files = input?.files
  const selectedFiles = files ? Array.from(files) : []

  if (selectedFiles.length > 0) await processFiles(selectedFiles)
  if (input) input.value = ''
}

function removeFile() {
  if (props.modelValue) emit('update:modelValue', null)
  if (props.existingFile) emit('remove-existing')
}

function downloadFile() {
  if (!previewUrl.value) return

  const anchor = document.createElement('a')
  anchor.href = previewUrl.value
  anchor.download = displayName.value || 'download'
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function zoomIn() {
  if (zoomLevel.value < MAX_ZOOM) zoomLevel.value += ZOOM_STEP
}

function zoomOut() {
  if (zoomLevel.value > MIN_ZOOM) zoomLevel.value -= ZOOM_STEP
}

function nextPage() {
  if (currentPage.value < pdfPageCount.value) currentPage.value++
}

function prevPage() {
  if (currentPage.value > 1) currentPage.value--
}
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  display: block;
  width: 10px;
  height: 10px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: #1e293b;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #475569;
  border-radius: 5px;
  border: 2px solid #1e293b;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #64748b;
}

.custom-scrollbar {
  scrollbar-gutter: stable;
  scrollbar-width: auto;
  scrollbar-color: #475569 #1e293b;
}

.file-preview-toolbar {
  flex-wrap: wrap;
}

@media (hover: hover) and (pointer: fine) {
  .file-preview-toolbar {
    position: absolute;
    top: 0;
    right: 0;
    left: 0;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .group:hover .file-preview-toolbar,
  .group:focus-within .file-preview-toolbar {
    opacity: 1;
  }
}

:deep(.vue-pdf-embed__page > canvas:not(.hiddenCanvasElement)) {
  position: absolute;
  display: block;
  width: 100%;
  height: auto;
  z-index: 1;
  pointer-events: none;
}

:deep(.vue-pdf-embed__page > canvas.hiddenCanvasElement) {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}

:deep(.textLayer) {
  position: absolute;
  inset: 0;
  z-index: 2;
  line-height: 1;
  font-size: 1px;
  pointer-events: auto;
  -webkit-user-select: text;
  -moz-user-select: text;
  user-select: text;
}

:deep(.textLayer span) {
  position: absolute !important;
  display: block !important;
  white-space: pre;
  line-height: 1;
  padding: 0;
  margin: 0;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  user-select: text !important;
  background: transparent;
  color: transparent;
  transform-origin: 0 0;
}

:deep(.textLayer span:empty),
:deep(.text-layer span:empty) {
  display: none !important;
}

:deep(.textLayer span::selection),
:deep(.textLayer span::-moz-selection) {
  background: rgba(96, 165, 250, 0.6) !important;
}
</style>
