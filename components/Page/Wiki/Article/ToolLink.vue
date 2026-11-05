<template>
  <span class="my-1 inline-block">
    <button
      v-if="allowed"
      type="button"
      class="btn-primary inline-flex items-center gap-1.5"
      :disabled="disabled"
      :title="disabled ? t('wiki.toolLink.previewHint') : undefined"
      @click="open"
    >
      <Icon name="material-symbols:bolt-rounded" class="text-base" aria-hidden="true" />
      {{ label }}
    </button>

    <span
      v-else
      class="inline-flex items-center gap-1.5 rounded-lg bg-base-100 px-3 py-2 text-sm text-base-500"
    >
      <Icon name="material-symbols:lock-outline" class="text-base" aria-hidden="true" />
      {{ t('wiki.toolLink.noAccess') }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget } from '~/composables/useReturnTarget'
import { PAGES } from '~/config/pages'

const props = defineProps<{
  page: string
  meta: Record<string, any>
  label: string
  /** The article the reader is on, so `returnTarget: "self"` comes back to exactly this page. */
  articleId?: number | null
  /** Preview inside the editor: the button renders but must not navigate away from the draft. */
  disabled?: boolean
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()
const { setPage } = usePage()

const definition = computed(() => PAGES[props.page] ?? null)

const allowed = computed(() => {
  const page = definition.value
  if (!page) return false
  return !page.permissions.length || hasPermission(page.permissions)
})

const label = computed(() => {
  if (props.label) return props.label
  const page = definition.value
  return page ? t(page.labelKey) : props.page
})

function open() {
  if (props.disabled || !allowed.value) return

  const { returnTarget, ...rest } = props.meta ?? {}
  // Plain values only (the server already refuses anything else when the article is published).
  const meta: Record<string, any> = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)),
  )

  if (returnTarget === 'self') {
    if (props.articleId) meta.returnTarget = buildReturnTarget('WikiArticle', { articleId: props.articleId })
  } else if (returnTarget) {
    meta.returnTarget = returnTarget
  }

  setPage(props.page, Object.keys(meta).length ? meta : undefined)
}
</script>
