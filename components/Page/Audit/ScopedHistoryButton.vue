<template>
  <button
    v-if="canView"
    type="button"
    class="btn-secondary inline-flex items-center gap-1.5"
    aria-haspopup="dialog"
    :title="modalTitle"
    @click="open = true"
  >
    <Icon name="material-symbols:history-rounded" class="h-4 w-4" aria-hidden="true" />
    {{ label || t('audit.title') }}
  </button>

  <CommonModal v-if="canView" v-model="open" width-class="max-w-3xl">
    <template #title>
      <div>
        <h3 class="text-lg font-semibold text-base-900">{{ modalTitle }}</h3>
        <p class="mt-0.5 text-sm text-base-500">{{ t('audit.subtitle') }}</p>
      </div>
    </template>

    <PageAuditScopedHistory v-if="open" :tables="props.tables" :parent-id="props.parentId" :endpoint="props.endpoint" />
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useAuth } from '~/composables/useAuth'
import PageAuditScopedHistory from './ScopedHistory.vue'

const props = withDefaults(defineProps<{
  tables: string[]
  parentId: number | string
  /** Overrides the button caption. */
  label?: string
  /**
   * Section name appended to the modal heading. Set it whenever a page shows more than one scoped
   * history button, so the open dialog says which section it is showing.
   */
  context?: string
  /** Alternative history endpoint (same response shape as /api/audit/scoped). */
  endpoint?: string
  /**
   * Show the button without `audit.view` — only together with an `endpoint` that does its own
   * authorization (e.g. scoped subdivision permissions).
   */
  visible?: boolean
}>(), {
  label: undefined,
  context: undefined,
  endpoint: undefined,
  visible: false,
})

const { t } = useI18n()
const { hasPermission } = useAuth()
const open = ref(false)

const canView = computed(() => (props.visible && Boolean(props.endpoint)) || hasPermission('audit.view'))

const modalTitle = computed(() => (props.context ? `${t('audit.title')} – ${props.context}` : props.label || t('audit.title')))
</script>
