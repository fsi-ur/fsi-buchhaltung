<template>
  <nav class="space-y-4 text-sm">
    <div v-if="!spaces.length" class="text-base-500">{{ t('wiki.tree.empty') }}</div>

    <div v-for="space in spaces" :key="space.id" class="space-y-1">
      <div v-if="!hideSpaceHeaders" class="flex items-center gap-0.5">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left font-semibold text-base-800 transition-colors hover:bg-base-100 cursor-pointer"
          :aria-expanded="expandedSpaces.has(space.id)"
          @click="toggleSpace(space.id)"
        >
          <Icon
            :name="expandedSpaces.has(space.id) ? 'material-symbols:expand-more-rounded' : 'material-symbols:chevron-right-rounded'"
            class="h-4 w-4 shrink-0 text-base-400"
            aria-hidden="true"
          />
          <Icon :name="space.icon" class="h-4 w-4 shrink-0 text-accent-500" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ space.title }}</span>
          <span class="shrink-0 rounded-full bg-base-100 px-1.5 text-xs font-normal text-base-500">
            {{ space.articles.length }}
          </span>
        </button>
        <button
          type="button"
          class="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1.5 text-base-400 transition-colors hover:bg-base-100 hover:text-base-700"
          :title="t('wiki.space.open', { title: space.title })"
          :aria-label="t('wiki.space.open', { title: space.title })"
          @click="$emit('openSpace', { id: space.id, slug: space.slug })"
        >
          <Icon name="material-symbols:open-in-full-rounded" class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <ul
        v-if="hideSpaceHeaders || expandedSpaces.has(space.id)"
        :class="hideSpaceHeaders ? 'space-y-0.5' : 'ml-4 space-y-0.5 border-l border-base-100 pl-1'"
      >
        <PageWikiNavigationTreeSidebarNode
          v-for="article in space.articles"
          :key="article.id"
          :article="article"
          :space-slug="space.slug"
          :current-article-id="currentArticleId"
          :depth="0"
          :editable="editable"
          @select="$emit('select', $event)"
          @move="applyMove"
          @nudge="applyNudge"
        />
      </ul>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import PageWikiNavigationTreeSidebarNode from './TreeSidebarNode.vue'
import type { WikiTreeArticle, WikiTreeSpace } from '~/types/wiki'

export interface WikiReorderItem {
  id: number
  parentId: number | null
  position: number
}

const props = defineProps<{
  spaces: WikiTreeSpace[]
  currentArticleId?: number | null
  editable?: boolean
  /** Lists the articles only (one space's own page), always expanded. */
  hideSpaceHeaders?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', article: { id: number, slug: string, spaceSlug: string }): void
  (e: 'reorder', items: WikiReorderItem[]): void
  (e: 'openSpace', space: { id: number, slug: string }): void
}>()

const { t } = useI18n()

const expandedSpaces = reactive(new Set<number>())

function toggleSpace(spaceId: number) {
  if (expandedSpaces.has(spaceId)) expandedSpaces.delete(spaceId)
  else expandedSpaces.add(spaceId)
}

function containsArticle(nodes: WikiTreeArticle[], articleId: number): boolean {
  return nodes.some(node => node.id === articleId || containsArticle(node.children, articleId))
}

function findNode(articleId: number): WikiTreeArticle | null {
  for (const space of props.spaces) {
    const found = search(space.articles, articleId)
    if (found) return found
  }
  return null
}

function search(nodes: WikiTreeArticle[], articleId: number): WikiTreeArticle | null {
  for (const node of nodes) {
    if (node.id === articleId) return node
    const found = search(node.children, articleId)
    if (found) return found
  }
  return null
}

function siblingsOf(spaceId: number, parentId: number | null): WikiTreeArticle[] {
  const space = props.spaces.find(entry => entry.id === spaceId)
  if (!space) return []
  if (parentId === null) return [...space.articles]
  return [...(search(space.articles, parentId)?.children ?? [])]
}

function isInSubtree(node: WikiTreeArticle, articleId: number): boolean {
  return node.id === articleId || node.children.some(child => isInSubtree(child, articleId))
}

function emitOrder(siblings: WikiTreeArticle[], parentId: number | null) {
  emit('reorder', siblings.map((node, index) => ({ id: node.id, parentId, position: (index + 1) * 10 })))
}

function applyMove(payload: { dragId: number, targetId: number, mode: 'before' | 'after' | 'child' }) {
  const dragged = findNode(payload.dragId)
  const target = findNode(payload.targetId)
  if (!dragged || !target || dragged.id === target.id) return
  if (dragged.space_id !== target.space_id) return
  // Dropping an article into its own subtree would detach the branch — the server rejects it too
  if (isInSubtree(dragged, target.id)) return

  const parentId = payload.mode === 'child' ? target.id : target.parent_id
  const siblings = siblingsOf(dragged.space_id, parentId).filter(node => node.id !== dragged.id)

  if (payload.mode === 'child') {
    siblings.push(dragged)
  } else {
    const index = siblings.findIndex(node => node.id === target.id)
    siblings.splice(payload.mode === 'before' ? Math.max(index, 0) : index + 1, 0, dragged)
  }

  emitOrder(siblings, parentId)
}

function applyNudge(payload: { id: number, direction: -1 | 1 }) {
  const node = findNode(payload.id)
  if (!node) return

  const siblings = siblingsOf(node.space_id, node.parent_id)
  const index = siblings.findIndex(entry => entry.id === node.id)
  const nextIndex = index + payload.direction
  if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return

  siblings.splice(nextIndex, 0, ...siblings.splice(index, 1))
  emitOrder(siblings, node.parent_id)
}

watch(
  () => [props.spaces, props.currentArticleId] as const,
  ([spaces, currentArticleId]) => {
    if (!spaces.length) return
    if (!currentArticleId) {
      for (const space of spaces) expandedSpaces.add(space.id)
      return
    }
    for (const space of spaces) {
      if (containsArticle(space.articles, currentArticleId)) expandedSpaces.add(space.id)
    }
  },
  { immediate: true, deep: true },
)
</script>
