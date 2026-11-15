<template>
  <li>
    <div
      :class="[
        'flex items-center gap-1 rounded-md',
        canMove && 'cursor-grab active:cursor-grabbing',
        dropMode === 'child' && 'ring-2 ring-accent-300',
        dropMode === 'before' && 'border-t-2 border-accent-400',
        dropMode === 'after' && 'border-b-2 border-accent-400',
      ]"
      :title="canMove ? t('wiki.tree.dragHint') : undefined"
      :draggable="canMove"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="dropMode = null"
      @drop="onDrop"
      @dragend="dropMode = null"
    >
      <button
        v-if="article.children.length"
        type="button"
        class="rounded-md p-1 text-base-400 transition-colors hover:bg-base-100 hover:text-base-700 cursor-pointer"
        :aria-label="expanded ? t('wiki.tree.collapse') : t('wiki.tree.expand')"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <Icon
          :name="expanded ? 'material-symbols:expand-more-rounded' : 'material-symbols:chevron-right-rounded'"
          class="h-4 w-4"
          aria-hidden="true"
        />
      </button>
      <span v-else class="w-5 shrink-0" aria-hidden="true"></span>

      <button
        type="button"
        :class="[
          'min-w-0 flex-1 rounded-md px-2 py-2 text-left transition-colors cursor-pointer',
          isCurrent
            ? 'border-l-2 border-accent-500 bg-accent-50 font-semibold text-accent-700'
            : 'text-base-700 hover:bg-base-100 hover:text-base-900',
        ]"
        :aria-current="isCurrent ? 'page' : undefined"
        @click="$emit('select', { id: article.id, slug: article.slug, spaceSlug })"
      >
        <span
          :class="['block truncate', article.status === 'archived' ? 'text-base-400 line-through decoration-base-300' : '']"
        >{{ article.title }}</span>
        <PageWikiStatusPill :status="article.status" class="mt-0.5" />
      </button>

      <span v-if="canMove" class="flex shrink-0 items-center">
        <Icon
          name="material-symbols:drag-indicator"
          class="h-4 w-4 text-base-300"
          :aria-label="t('wiki.tree.dragHint')"
        />
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-md p-1 text-base-400 transition-colors hover:bg-base-100 hover:text-base-700 cursor-pointer"
          :title="t('wiki.tree.moveUp')"
          :aria-label="t('wiki.tree.moveUp')"
          @click="$emit('nudge', { id: article.id, direction: -1 })"
        >
          <Icon name="material-symbols:keyboard-arrow-up-rounded" class="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-md p-1 text-base-400 transition-colors hover:bg-base-100 hover:text-base-700 cursor-pointer"
          :title="t('wiki.tree.moveDown')"
          :aria-label="t('wiki.tree.moveDown')"
          @click="$emit('nudge', { id: article.id, direction: 1 })"
        >
          <Icon name="material-symbols:keyboard-arrow-down-rounded" class="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
    </div>

    <ul v-if="expanded && article.children.length" class="ml-3 space-y-0.5 border-l border-base-100 pl-1">
      <PageWikiNavigationTreeSidebarNode
        v-for="child in article.children"
        :key="child.id"
        :article="child"
        :space-slug="spaceSlug"
        :current-article-id="currentArticleId"
        :depth="depth + 1"
        :editable="editable"
        @select="$emit('select', $event)"
        @move="$emit('move', $event)"
        @nudge="$emit('nudge', $event)"
      />
    </ul>
  </li>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import type { WikiTreeArticle } from '~/types/wiki'

const props = defineProps<{
  article: WikiTreeArticle
  spaceSlug: string
  currentArticleId?: number | null
  depth: number
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', article: { id: number, slug: string, spaceSlug: string }): void
  (e: 'move', payload: { dragId: number, targetId: number, mode: 'before' | 'after' | 'child' }): void
  (e: 'nudge', payload: { id: number, direction: -1 | 1 }): void
}>()

const { t } = useI18n()

const isCurrent = computed(() => props.currentArticleId === props.article.id)
const canMove = computed(() => Boolean(props.editable) && props.article.accessLevel !== 'read')

const dropMode = ref<'before' | 'after' | 'child' | null>(null)

function containsCurrent(nodes: WikiTreeArticle[]): boolean {
  if (!props.currentArticleId) return false
  return nodes.some(node => node.id === props.currentArticleId || containsCurrent(node.children))
}

const expanded = ref(props.depth === 0 || containsCurrent(props.article.children))

watch(
  () => props.currentArticleId,
  () => {
    if (containsCurrent(props.article.children)) expanded.value = true
  },
)

function onDragStart(event: DragEvent) {
  if (!canMove.value) return
  event.dataTransfer?.setData('text/plain', String(props.article.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function resolveMode(event: DragEvent) {
  const target = event.currentTarget as HTMLElement
  const bounds = target.getBoundingClientRect()
  const offset = (event.clientY - bounds.top) / bounds.height
  if (offset < 0.25) return 'before' as const
  if (offset > 0.75) return 'after' as const
  return 'child' as const
}

function onDragOver(event: DragEvent) {
  if (!canMove.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropMode.value = resolveMode(event)
}

function onDrop(event: DragEvent) {
  if (!canMove.value) return
  event.preventDefault()
  event.stopPropagation()

  const mode = dropMode.value ?? resolveMode(event)
  dropMode.value = null

  const dragId = Number(event.dataTransfer?.getData('text/plain'))
  if (!Number.isInteger(dragId) || dragId <= 0 || dragId === props.article.id) return

  emit('move', { dragId, targetId: props.article.id, mode })
}
</script>
