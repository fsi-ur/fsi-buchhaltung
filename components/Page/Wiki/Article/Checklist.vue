<template>
  <div class="my-4 rounded-xl border border-base-200 bg-base-50/70 p-4">
    <p class="flex items-center gap-2 text-sm font-semibold text-base-800">
      <Icon name="material-symbols:checklist-rounded" class="text-lg text-base-400" aria-hidden="true" />
      {{ checklist ? checklist.title : t('wiki.checklist.unknownTitle') }}
    </p>

    <p v-if="!checklist" class="mt-3 text-sm text-base-500">
      {{ t('wiki.checklist.unknown', { key: keySlug }) }}
    </p>

    <template v-else>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p class="flex items-center gap-2 text-sm text-base-600">
          <span
            class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-base-200"
            role="progressbar"
            :aria-valuenow="doneCount"
            aria-valuemin="0"
            :aria-valuemax="checklist.items.length"
            :aria-label="t('wiki.checklist.progress', { done: doneCount, total: checklist.items.length })"
          >
            <span
              class="block h-full rounded-full bg-success-500 transition-all"
              :style="{ width: `${checklist.items.length ? Math.round((doneCount / checklist.items.length) * 100) : 0}%` }"
            ></span>
          </span>
          {{ t('wiki.checklist.progress', { done: doneCount, total: checklist.items.length }) }}
          <span v-if="checklist.mode === 'shared'" class="text-base-400"> · {{ t('wiki.checklist.sharedHint') }}</span>
        </p>

        <div v-if="checklist.mode === 'shared'" class="flex flex-wrap items-center gap-2">
          <MenuDropdown v-if="runs.length" :id="`run-${checklist.id}`" v-model="openMenu" wrapper-class="relative w-auto">
            <template #trigger="{ styling }">
              <button type="button" :class="[styling, 'w-auto cursor-pointer py-1 text-xs']">
                <span class="truncate">{{ activeRun ? runLabel(activeRun) : t('wiki.checklist.selectRun') }}</span>
                <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
              </button>
            </template>
            <template #default="{ styling }">
              <button
                v-for="run in runs"
                :key="run.id"
                type="button"
                :class="styling"
                @click="selectRun(run.id)"
              >
                {{ runLabel(run) }}
              </button>
            </template>
          </MenuDropdown>

          <button type="button" class="btn-secondary py-1 text-xs" :disabled="preview" @click="openRunModal">
            {{ t('wiki.checklist.newRun') }}
          </button>
        </div>
      </div>

      <p v-if="checklist.mode === 'shared' && activeRun" class="mt-1 text-xs text-base-500">
        {{ t('wiki.checklist.runStartedBy', { name: activeRun.createdByName }) }}
        <span v-if="activeRun.dueDate"> · {{ t('wiki.checklist.runDue', { date: formatDate(activeRun.dueDate) }) }}</span>
        <span v-if="activeRun.closedAt"> · {{ t('wiki.checklist.runClosed') }}</span>
      </p>

      <p v-else-if="checklist.mode === 'shared'" class="mt-1 text-xs text-base-500">
        {{ t('wiki.checklist.noRuns') }}
      </p>

      <ul class="mt-3 list-none space-y-2 pl-0">
        <li v-for="item in checklist.items" :key="item.id" class="list-none pl-0">
          <label
            class="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border p-3 transition-colors"
            :class="[
              isDone(item) ? 'border-success-200 bg-success-50/40' : 'border-base-200 bg-white',
              canTick ? 'cursor-pointer hover:border-accent-300 hover:bg-accent-50/40' : 'cursor-default',
            ]"
          >
            <input
              type="checkbox"
              class="checkbox mt-0.5"
              :checked="isDone(item)"
              :disabled="!canTick"
              @change="toggle(item, ($event.target as HTMLInputElement).checked)"
            />

            <span class="min-w-0 flex-1">
              <span class="block text-sm" :class="isDone(item) ? 'text-base-400 line-through' : 'text-base-800'">
                {{ item.label }}
              </span>
              <span v-if="item.hint" class="mt-0.5 block text-xs text-base-500">{{ item.hint }}</span>
              <span v-if="attribution(item)" class="mt-0.5 block text-xs text-success-700">{{ attribution(item) }}</span>
            </span>

            <PageWikiArticleToolLink
              v-if="item.targetPage"
              :page="item.targetPage"
              :meta="item.targetMeta ?? { returnTarget: 'self' }"
              :label="t('wiki.checklist.open')"
              :article-id="articleId ?? null"
              :disabled="preview"
            />
          </label>
        </li>
      </ul>

      <div v-if="activeRun && activeRun.canClose && !preview" class="mt-3 flex justify-end">
        <button type="button" class="btn-secondary py-1 text-xs" @click="setClosed(!activeRun.closedAt)">
          {{ activeRun.closedAt ? t('wiki.checklist.reopenRun') : t('wiki.checklist.closeRun') }}
        </button>
      </div>
    </template>
  </div>

  <CommonModal v-model="runModalOpen" :title="t('wiki.checklist.newRunTitle')">
    <div class="space-y-3">
      <div class="field">
        <label :for="`run-title-${keySlug}`">{{ t('wiki.checklist.runTitleField') }}</label>
        <input :id="`run-title-${keySlug}`" v-model="runDraft.title" class="input" />
      </div>
      <div class="field">
        <label :for="`run-due-${keySlug}`">{{ t('wiki.checklist.runDueField') }}</label>
        <CommonDateInput :id="`run-due-${keySlug}`" v-model="runDraft.dueDate" :empty-value="null" />
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="runModalOpen = false">{{ t('actions.cancel') }}</button>
        <button type="button" class="btn-primary" :disabled="creatingRun" @click="createRun">
          {{ t('wiki.checklist.createRun') }}
        </button>
      </div>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { useToast } from '~/composables/useToast'
import type { CreateWikiChecklistRunResponse } from '~/server/api/wiki/checklists/runs/create.post'
import type { WikiChecklistItemView, WikiChecklistRunView, WikiChecklistView } from '~/types/wiki'

const props = defineProps<{
  checklist: WikiChecklistView | null
  keySlug: string
  articleId?: number | null
  preview?: boolean
}>()

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const toast = useToast()

const items = ref<WikiChecklistItemView[]>([])
const runs = ref<WikiChecklistRunView[]>([])
const activeRunId = ref<number | null>(null)
const openMenu = ref<string | null>(null)
const runModalOpen = ref(false)
const creatingRun = ref(false)
const runDraft = reactive({ title: '', dueDate: null as string | null })

const activeRun = computed(() => runs.value.find(run => run.id === activeRunId.value) ?? null)

const canTick = computed(() => {
  if (props.preview || !props.checklist) return false
  if (props.checklist.mode === 'personal') return true
  return Boolean(activeRun.value && !activeRun.value.closedAt)
})

const doneCount = computed(() => items.value.filter(isDone).length)

function isDone(item: WikiChecklistItemView) {
  if (props.checklist?.mode === 'shared') {
    return Boolean(activeRun.value?.entries.some(entry => entry.itemId === item.id))
  }
  return items.value.find(entry => entry.id === item.id)?.done ?? false
}

function attribution(item: WikiChecklistItemView) {
  if (props.checklist?.mode !== 'shared') return ''
  const entry = activeRun.value?.entries.find(candidate => candidate.itemId === item.id)
  if (!entry) return ''
  return t('wiki.checklist.completedBy', { name: entry.completedByName, date: formatDate(entry.completedAt) })
}

function runLabel(run: WikiChecklistRunView) {
  return run.closedAt ? `${run.title} (${t('wiki.checklist.runClosed')})` : run.title
}

function selectRun(runId: number) {
  activeRunId.value = runId
  openMenu.value = null
}

function openRunModal() {
  runDraft.title = props.checklist?.title ?? ''
  runDraft.dueDate = null
  runModalOpen.value = true
}

async function toggle(item: WikiChecklistItemView, done: boolean) {
  if (!props.checklist || !canTick.value) return

  const shared = props.checklist.mode === 'shared'
  const run = activeRun.value
  const target = items.value.find(entry => entry.id === item.id)

  if (shared && run) {
    run.entries = done
      ? [...run.entries.filter(entry => entry.itemId !== item.id), {
          itemId: item.id,
          completedAt: new Date().toISOString(),
          completedBy: 0,
          completedByName: t('wiki.checklist.you'),
        }]
      : run.entries.filter(entry => entry.itemId !== item.id)
  } else if (target) {
    target.done = done
  }

  const res = shared && run
    ? await apiFetch<{ ok: boolean, error?: string }>(`/api/wiki/checklists/runs/${run.id}/state`, {
      method: 'POST',
      body: { itemId: item.id, done },
    })
    : await apiFetch<{ ok: boolean, error?: string }>('/api/wiki/checklists/personal', {
      method: 'POST',
      body: { checklistId: props.checklist.id, itemId: item.id, done },
    })

  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    reset()
  }
}

async function createRun() {
  if (!props.checklist) return
  const title = runDraft.title.trim()
  if (!title) {
    toast.error(t('wiki.checklist.runTitleRequired'))
    return
  }

  creatingRun.value = true
  try {
    const res = await apiFetch<CreateWikiChecklistRunResponse>('/api/wiki/checklists/runs/create', {
      method: 'POST',
      body: { checklistId: props.checklist.id, title, dueDate: runDraft.dueDate },
    })

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    runs.value = [{
      id: res.runId,
      title,
      dueDate: runDraft.dueDate,
      closedAt: null,
      createdBy: 0,
      createdByName: t('wiki.checklist.you'),
      createdAt: new Date().toISOString(),
      entries: [],
      canClose: true,
    }, ...runs.value]
    activeRunId.value = res.runId
    runModalOpen.value = false
    toast.success(t('wiki.checklist.runCreatedToast'))
  } finally {
    creatingRun.value = false
  }
}

async function setClosed(closed: boolean) {
  const run = activeRun.value
  if (!run) return

  const res = await apiFetch<{ ok: boolean, error?: string }>(`/api/wiki/checklists/runs/${run.id}/close`, {
    method: 'POST',
    body: { closed },
  })

  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    return
  }

  run.closedAt = closed ? new Date().toISOString() : null
  toast.success(closed ? t('wiki.checklist.closedToast') : t('wiki.checklist.reopenedToast'))
}

function reset() {
  items.value = (props.checklist?.items ?? []).map(item => ({ ...item }))
  runs.value = (props.checklist?.runs ?? []).map(run => ({ ...run, entries: [...run.entries] }))
  // Default to the newest run that is still open, so the board lands on the one it is working on.
  activeRunId.value = runs.value.find(run => !run.closedAt)?.id ?? runs.value[0]?.id ?? null
}

watch(() => props.checklist, reset, { immediate: true, deep: true })
</script>
