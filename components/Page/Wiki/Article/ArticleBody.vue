<template>
  <div>
    <div
      ref="containerRef"
      class="wiki-article-body"
      v-html="html"
      @click="onClick"
    ></div>

    <Teleport v-for="tool in toolMounts" :key="tool.id" :to="tool.el">
      <PageWikiArticleToolLink
        :page="tool.page"
        :meta="tool.meta"
        :label="tool.label"
        :article-id="articleId ?? null"
        :disabled="preview"
      />
    </Teleport>

    <Teleport v-for="entry in checklistMounts" :key="entry.id" :to="entry.el">
      <PageWikiArticleChecklist
        :checklist="checklistByKey[entry.keySlug] ?? null"
        :key-slug="entry.keySlug"
        :article-id="articleId ?? null"
        :preview="preview"
      />
    </Teleport>

    <Teleport v-for="embed in embedMounts" :key="embed.id" :to="embed.el">
      <PageWikiArticleEmbedHost
        :embed-key="embed.key"
        :result="embedResults[embed.id] ?? null"
        :loading="embedsLoading"
      />
    </Teleport>

    <Teleport v-for="entry in glossaryMounts" :key="entry.id" :to="entry.el">
      <PageWikiGlossaryTerm
        :term-key="entry.termKey"
        :label="entry.label"
        :article-id="articleId ?? null"
        :preview="preview"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget } from '~/composables/useReturnTarget'
import type { WikiLinkResolution } from '~/server/utils/wiki/detail'
import type { WikiEmbedsResolveResponse } from '~/server/api/wiki/embeds/resolve.post'
import type { WikiChecklistView, WikiEmbedRequestItem, WikiEmbedResult } from '~/types/wiki'

const props = defineProps<{
  html: string
  links?: WikiLinkResolution
  /** The article being read, so `returnTarget: "self"` on a tool link can come back here. */
  articleId?: number | null
  /** Definitions + tick state for the `:::checklist{id="…"}` blocks in `html`. */
  checklists?: WikiChecklistView[]
  preview?: boolean
}>()

const { t } = useI18n()
const { setPage } = usePage()
const appBaseUrl = useRuntimeConfig().app.baseURL || '/'

function fileUrl(fileId: string) {
  return `${appBaseUrl.replace(/\/+$/, '')}/api/files/${fileId}`
}

interface ToolMount {
  id: number
  el: HTMLElement
  page: string
  meta: Record<string, any>
  label: string
}

interface ChecklistMount {
  id: number
  el: HTMLElement
  keySlug: string
}

interface GlossaryMount {
  id: number
  el: HTMLElement
  termKey: string
  label: string
}

interface EmbedMount {
  id: number
  el: HTMLElement
  key: string
  args: Record<string, string | number | boolean>
}

const containerRef = ref<HTMLElement | null>(null)
const toolMounts = ref<ToolMount[]>([])
const embedMounts = ref<EmbedMount[]>([])
const checklistMounts = ref<ChecklistMount[]>([])
const glossaryMounts = ref<GlossaryMount[]>([])
const embedResults = ref<Record<number, WikiEmbedResult | null>>({})
const embedsLoading = ref(false)

const checklistByKey = computed(() => {
  const map: Record<string, WikiChecklistView> = {}
  for (const checklist of props.checklists ?? []) map[checklist.keySlug] = checklist
  return map
})

function parseJsonAttribute(node: HTMLElement, attribute: string): Record<string, any> {
  const raw = node.getAttribute(attribute)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function hydrateArticleLinks(container: HTMLElement) {
  const anchors = container.querySelectorAll<HTMLAnchorElement>('a[data-wiki-article]')
  for (const anchor of anchors) {
    const path = anchor.getAttribute('data-wiki-article') ?? ''
    const target = props.links?.[path] ?? null
    const label = anchor.getAttribute('data-wiki-label') ?? ''

    if (!target) {
      anchor.classList.add('wiki-link-broken')
      anchor.textContent = `${label || path} (${t('wiki.article.brokenLink')})`
      anchor.removeAttribute('data-wiki-target')
      continue
    }

    anchor.classList.remove('wiki-link-broken')
    anchor.setAttribute('data-wiki-target', String(target.id))
    anchor.setAttribute('title', t('wiki.article.linkTitle'))
    if (!label) anchor.textContent = target.title
  }
}

function hydrateImages(container: HTMLElement) {
  for (const image of container.querySelectorAll<HTMLImageElement>('img[data-wiki-image]')) {
    const url = fileUrl(image.getAttribute('data-wiki-image') ?? '')
    if (image.getAttribute('src') !== url) image.setAttribute('src', url)
  }
}

function collectMounts(container: HTMLElement) {
  const tools: ToolMount[] = []
  const embeds: EmbedMount[] = []
  const checklists: ChecklistMount[] = []
  let nextId = 0

  for (const node of container.querySelectorAll<HTMLElement>('[data-wiki-tool]')) {
    node.textContent = ''
    tools.push({
      id: nextId++,
      el: node,
      page: node.getAttribute('data-wiki-tool') ?? '',
      meta: parseJsonAttribute(node, 'data-wiki-tool-meta'),
      label: node.getAttribute('data-wiki-label') ?? '',
    })
  }

  for (const node of container.querySelectorAll<HTMLElement>('[data-wiki-embed]')) {
    node.textContent = ''
    embeds.push({
      id: nextId++,
      el: node,
      key: node.getAttribute('data-wiki-embed') ?? '',
      args: parseJsonAttribute(node, 'data-wiki-args') as Record<string, string | number | boolean>,
    })
  }

  for (const node of container.querySelectorAll<HTMLElement>('[data-wiki-checklist]')) {
    node.textContent = ''
    checklists.push({
      id: nextId++,
      el: node,
      keySlug: node.getAttribute('data-wiki-checklist') ?? '',
    })
  }

  const glossary: GlossaryMount[] = []
  for (const node of container.querySelectorAll<HTMLElement>('[data-wiki-glossary]')) {
    const label = node.textContent ?? ''
    node.textContent = ''
    glossary.push({
      id: nextId++,
      el: node,
      termKey: node.getAttribute('data-wiki-glossary') ?? '',
      label,
    })
  }

  toolMounts.value = tools
  embedMounts.value = embeds
  checklistMounts.value = checklists
  glossaryMounts.value = glossary
}

async function resolveEmbeds() {
  const mounts = embedMounts.value
  if (!mounts.length) {
    embedResults.value = {}
    embedsLoading.value = false
    return
  }

  embedsLoading.value = true
  const requests: WikiEmbedRequestItem[] = mounts.map(mount => ({ key: mount.key, args: mount.args }))

  try {
    const res = await $fetch<WikiEmbedsResolveResponse>('/api/wiki/embeds/resolve', {
      method: 'POST',
      body: { embeds: requests },
    })

    const results: Record<number, WikiEmbedResult | null> = {}
    if (res.ok) {
      mounts.forEach((mount, position) => { results[mount.id] = res.results[position] ?? null })
    } else {
      mounts.forEach(mount => { results[mount.id] = { key: mount.key, args: mount.args, visible: true, data: null, error: res.error } })
    }
    embedResults.value = results
  } catch {
    const results: Record<number, WikiEmbedResult | null> = {}
    mounts.forEach(mount => {
      results[mount.id] = { key: mount.key, args: mount.args, visible: true, data: null, error: t('wiki.embeds.failed') }
    })
    embedResults.value = results
  } finally {
    embedsLoading.value = false
  }
}

async function hydrate() {
  await nextTick()
  const container = containerRef.value
  if (!container) return

  hydrateArticleLinks(container)
  hydrateImages(container)
  collectMounts(container)
  await resolveEmbeds()
}

function onClick(event: MouseEvent) {
  const image = (event.target as HTMLElement | null)?.closest<HTMLImageElement>('img[data-wiki-image]')
  if (image) {
    window.open(fileUrl(image.getAttribute('data-wiki-image') ?? ''), '_blank', 'noopener')
    return
  }

  const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[data-wiki-article]')
  if (!anchor) return

  event.preventDefault()
  const targetId = anchor.getAttribute('data-wiki-target')
  if (!targetId) return

  setPage('WikiArticle', {
    articleId: Number(targetId),
    returnTarget: props.articleId ? buildReturnTarget('WikiArticle', { articleId: props.articleId }) : undefined,
  })
}

watch(() => props.html, () => {
  toolMounts.value = []
  embedMounts.value = []
  checklistMounts.value = []
  glossaryMounts.value = []
  embedResults.value = {}
})

watch(() => [props.html, props.links], hydrate, { deep: true, flush: 'post' })

onMounted(hydrate)
</script>
