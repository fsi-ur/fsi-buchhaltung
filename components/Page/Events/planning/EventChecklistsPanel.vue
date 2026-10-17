<template>
  <section class="space-y-6">
    <div class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{{ t('event.planning.checklists') }}</h2>
          <p class="text-sm text-base-500">{{ t('event.planning.checklistHint') }}</p>
        </div>
        <PageAuditScopedHistoryButton v-if="props.eventId" :tables="['event_checklists', 'event_checklist_items>event_checklists:event_id']" :parent-id="props.eventId" :context="t('event.planning.checklists')" />
      </div>
    </div>

    <div :class="['grid gap-6', canManage !== false ? 'xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]' : '']">
      <aside v-if="canManage !== false" class="space-y-6">
        <section class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold text-base-900">{{ t('event.planning.checklistTemplates') }}</h3>
              <p class="text-sm text-base-500">{{ t('event.planning.checklistTemplatesHint') }}</p>
            </div>
          </div>

          <button
            type="button"
            class="btn-secondary mt-4 inline-flex w-full items-center justify-center gap-2"
            :disabled="disabled || checklistTemplates.length === 0"
            @click="templateBrowserOpen = true"
          >
            <Icon name="material-symbols:folder-open-rounded" />
            {{ t('event.planning.openChecklistTemplates') }}
            <span class="rounded bg-white px-1.5 py-0.5 text-xs text-base-600">{{ checklistTemplates.length }}</span>
          </button>

          <p v-if="checklistTemplates.length === 0" class="mt-3 rounded-lg border border-dashed border-base-300 p-3 text-sm text-base-500">
            {{ t('event.planning.noChecklistTemplates') }}
          </p>
        </section>

        <section ref="builderSectionEl" class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
          <div class="flex items-center justify-between gap-3">
            <h3 class="font-semibold text-base-900">{{ builderTitle }}</h3>
            <button
              type="button"
              class="btn-primary inline-flex items-center gap-2 h-8.5"
              :disabled="disabled"
              @click="resetDraft"
            >
              <Icon name="material-symbols:add-rounded" />
              {{ t('event.planning.createChecklist') }}
            </button>
          </div>
          <div class="mt-3 space-y-3">
            <div>
              <label class="text-xs font-medium text-base-500">{{ t('event.planning.checklistTitle') }}</label>
              <input v-model="draft.title" class="input mt-1" :disabled="disabled">
            </div>
            <div>
              <label class="text-xs font-medium text-base-500">{{ t('event.planning.checklistDescription') }}</label>
              <textarea v-model="draft.description" class="input mt-1 min-h-20" :disabled="disabled" />
            </div>
            <div>
              <label class="text-xs font-medium text-base-500">{{ t('event.planning.checklistItems') }}</label>
              <div class="mt-1 space-y-2">
                <div
                  v-for="item in draft.items"
                  :key="item.id"
                  :data-draft-item-id="item.id"
                  class="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 rounded-md"
                  :class="draggedDraftItemId === item.id ? 'opacity-45' : ''"
                  @dragover.prevent="dragOverDraftItem(item.id)"
                  @drop.prevent="dropDraftItem(item.id)"
                  @dragend="finishItemDrag"
                >
                  <button
                    type="button"
                    class="inline-flex h-9.5 w-9.5 items-center justify-center rounded-md border border-base-200 bg-white text-base-500 cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60 touch-none"
                    draggable="true"
                    :disabled="disabled || draft.items.length <= 1"
                    :title="t('event.planning.reorderChecklistItem')"
                    @mousedown.stop
                    @dragstart="startDraftItemDrag(item.id, $event)"
                    @touchstart.prevent="startDraftItemTouchDrag(item.id, $event)"
                  >
                    <Icon name="material-symbols:unfold-more-rounded" />
                  </button>
                  <input
                    v-model="item.label"
                    :ref="(element) => setDraftItemInput(item.id, element)"
                    class="input"
                    :placeholder="t('event.planning.checklistItemPlaceholder')"
                    :disabled="disabled"
                    @keydown.enter.prevent="addDraftItemAfter(item.id)"
                  >
                  <button
                    type="button"
                    class="inline-flex h-9.5 w-9.5 items-center justify-center rounded-md border border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 disabled:opacity-60 cursor-pointer"
                    :disabled="disabled"
                    :title="t('actions.remove')"
                    @click="removeDraftItem(item.id)"
                  >
                    <Icon name="material-symbols:close-rounded" />
                  </button>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-secondary inline-flex items-center gap-2" :disabled="disabled" @click="addDraftItem">
                <Icon name="material-symbols:add-rounded" />
                {{ t('event.planning.addChecklistItem') }}
              </button>
              <button v-if="editingTemplateId === null" type="button" class="btn-primary inline-flex items-center gap-2" :disabled="disabled || !canSaveDraft" @click="saveDraftToEvent">
                <Icon name="material-symbols:checklist-rounded" />
                {{ editingChecklistId === null ? t('event.planning.addChecklist') : t('actions.save') }}
              </button>
              <button
                v-if="canSaveTemplates !== false"
                type="button"
                class="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60 not-disabled:cursor-pointer disabled:cursor-not-allowed"
                :class="draftIsSavedAsTemplate || editingTemplateId !== null ? 'border-success-200 bg-success-50 text-success-700' : 'border-base-200 bg-white text-base-700 hover:bg-base-50'"
                :disabled="disabled || !canSaveDraft || draftIsSavedAsTemplate"
                @click="saveDraftAsTemplate"
              >
                <Icon name="material-symbols:bookmark-add-rounded" />
                {{ editingTemplateId === null ? templateSaveLabel : t('event.planning.saveTemplate') }}
              </button>
              <button v-if="editingChecklistId !== null || editingTemplateId !== null" type="button" class="btn-secondary" :disabled="disabled" @click="resetDraft">
                {{ t('actions.cancel') }}
              </button>
            </div>
          </div>
        </section>
      </aside>

      <section :class="['gap-4 lg:columns-2', canManage === false ? 'xl:columns-3' : '']">
        <div v-for="checklist in checklists" :key="checklist.id" class="mb-4 break-inside-avoid -mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="truncate font-semibold text-base-900">{{ checklist.title }}</h3>
              <p class="text-sm text-base-500">{{ checklist.description || t('event.planning.noChecklistDescription') }}</p>
            </div>
            <span class="shrink-0 rounded-md bg-base-100 px-2 py-1 text-xs font-semibold text-base-600">
              {{ completedItemCount(checklist) }}/{{ checklist.items.length }}
            </span>
          </div>

          <!-- Compact icon toolbar -->
          <div class="mt-2 flex items-center gap-1">
            <button
              v-if="canManage !== false"
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-base-200 bg-white text-base-500 hover:bg-base-50 hover:text-base-700 disabled:opacity-60 cursor-pointer"
              :disabled="disabled"
              :title="t('actions.edit')"
              @click="editChecklist(checklist)"
            >
              <Icon name="material-symbols:edit-rounded" class="text-base" />
            </button>
            <button
              v-if="canSaveTemplates !== false"
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-60"
              :class="isChecklistSavedAsTemplate(checklist) ? 'border-success-200 bg-success-50 text-success-600 cursor-not-allowed' : 'border-base-200 bg-white text-base-500 hover:bg-base-50 hover:text-base-700 cursor-pointer'"
              :disabled="disabled || isChecklistSavedAsTemplate(checklist)"
              :title="isChecklistSavedAsTemplate(checklist) ? t('event.planning.savedAsTemplate') : t('event.planning.saveAsTemplate')"
              @click="saveChecklistAsTemplate(checklist)"
            >
              <Icon name="material-symbols:bookmark-add-rounded" class="text-base" />
            </button>

            <!-- Task link button -->
            <template v-if="checklist.taskId !== null">
              <button
                type="button"
                class="inline-flex h-7 min-w-7 items-center gap-1 rounded-md border border-link-200 bg-link-50 px-1.5 text-xs font-medium text-link-700 hover:bg-link-100 cursor-pointer"
                :title="t('event.planning.navigateToTask')"
                @click="emit('navigate-to-tasks')"
              >
                <Icon name="material-symbols:task-alt-rounded" class="shrink-0 text-base" />
                <span class="max-w-24 truncate">{{ linkedTaskTitle(checklist.taskId) }}</span>
              </button>
              <button
                v-if="!disabled"
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-base-200 bg-white text-base-400 hover:bg-base-50 hover:text-base-600 cursor-pointer"
                :title="t('event.planning.unlinkFromTask')"
                @click="unlinkTask(checklist.id)"
              >
                <Icon name="material-symbols:link-off-rounded" class="text-base" />
              </button>
            </template>
            <template v-else-if="!disabled">
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-base-200 bg-white text-base-400 hover:bg-base-50 hover:text-base-700 cursor-pointer"
                :title="t('event.planning.linkToTask')"
                @click="openLinkTask(checklist.id)"
              >
                <Icon name="material-symbols:link-rounded" class="text-base" />
              </button>
              <button
                type="button"
                class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-base-200 bg-white text-base-400 hover:bg-accent-50 hover:text-accent-600 cursor-pointer"
                :title="t('event.planning.createTaskFromChecklist')"
                @click="openCreateTask(checklist.id)"
              >
                <Icon name="material-symbols:add-task-rounded" class="text-base" />
              </button>
            </template>

            <span class="flex-1" />
            <button
              v-if="canManage !== false"
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-danger-200 bg-danger-50 text-danger-600 hover:bg-danger-100 disabled:opacity-60 cursor-pointer"
              :disabled="disabled"
              :title="t('actions.remove')"
              @click="removeChecklist(checklist.id)"
            >
              <Icon name="material-symbols:delete-rounded" class="text-base" />
            </button>
          </div>

          <!-- Link task dropdown (only when open) -->
          <div v-if="linkingChecklistId === checklist.id" class="mt-2 flex items-center gap-1.5">
            <CommonSearchSelect
              class="checklist-compact-input min-w-0 flex-1"
              :model-value="taskLinkQuery"
              :options="taskLinkOptions(checklist.id)"
              :placeholder="t('event.planning.selectTask')"
              :empty-text="t('event.planning.noUnlinkedTasks')"
              @update:model-value="taskLinkQuery = $event"
              @select="selectTaskForChecklist(checklist.id, $event)"
              @clear-selection="taskLinkQuery = ''"
            />
            <button type="button" class="shrink-0 text-xs text-base-400 hover:text-base-600 cursor-pointer" @click="closeLinkTask">
              {{ t('actions.cancel') }}
            </button>
          </div>

          <!-- Create task inline form (only when open) -->
          <div v-else-if="creatingTaskForChecklistId === checklist.id" class="mt-2 space-y-1.5">
            <div class="flex items-center gap-1.5">
              <input
                v-model="newTaskTitle"
                class="input min-w-0 flex-1 py-0.75 text-sm"
                :placeholder="t('event.planning.taskTitle')"
                @keydown.enter.prevent="submitCreateTask(checklist.id)"
                @keydown.esc.prevent="cancelCreateTask"
              >
              <button type="button" class="btn-primary inline-flex h-7 items-center gap-1 px-2 text-xs" :disabled="!newTaskTitle.trim()" @click="submitCreateTask(checklist.id)">
                <Icon name="material-symbols:add-rounded" />
                {{ t('event.planning.createTaskFromChecklist') }}
              </button>
              <button type="button" class="shrink-0 text-xs text-base-400 hover:text-base-600 cursor-pointer" @click="cancelCreateTask">
                {{ t('actions.cancel') }}
              </button>
            </div>
            <CommonDateInput v-model="newTaskDeadline" mode="date" :empty-value="null" size="sm" />
          </div>

          <div class="mt-4 space-y-2">
            <label
              v-for="item in sortedItems(checklist)"
              :key="item.id"
              class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors"
              :class="[
                item.done ? 'border-success-200 bg-success-50/50' : 'border-base-200',
                canTickItems(checklist) ? 'cursor-pointer hover:bg-base-50' : 'cursor-default',
              ]"
            >
              <input
                type="checkbox"
                class="checkbox"
                :checked="item.done"
                :disabled="!canTickItems(checklist)"
                @change="setChecklistItemDone(checklist.id, item.id, ($event.target as HTMLInputElement).checked)"
              >
              <span :class="item.done ? 'line-through text-base-400' : 'text-base-700'">{{ item.label }}</span>
            </label>
          </div>
        </div>

        <div v-if="checklists.length === 0" class="rounded-xl border border-dashed border-base-300 bg-base-50 p-4 text-sm text-base-500">
          {{ t('event.planning.noChecklists') }}
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="templateBrowserOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-base-900/45 p-4"
        @click.self="templateBrowserOpen = false"
        @keydown.esc="templateBrowserOpen = false"
      >
        <section class="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl">
          <div class="flex items-start justify-between gap-3 border-b border-base-200 p-4">
            <div>
              <h3 class="text-lg font-semibold text-base-900">{{ t('event.planning.checklistTemplates') }}</h3>
              <p class="text-sm text-base-500">{{ t('event.planning.checklistTemplateBrowserHint') }}</p>
            </div>
            <div class="flex items-center gap-2">
              <PageAuditTableHistoryButton :tables="['event_checklist_templates', 'event_checklist_template_items']" :return-meta="{ tab: 'checklists' }" />
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-base-200 bg-white text-base-600 hover:bg-base-50 cursor-pointer"
                :title="t('actions.close')"
                @click="templateBrowserOpen = false"
              >
                <Icon name="material-symbols:close-rounded" />
              </button>
            </div>
          </div>

          <div class="border-b border-base-200 p-4">
            <label class="text-xs font-medium text-base-500">{{ t('event.planning.searchChecklistTemplates') }}</label>
            <input
              v-model="templateSearch"
              class="input mt-1"
              :placeholder="t('event.planning.searchChecklistTemplates')"
            >
          </div>

          <div class="event-checklist-template-scroll max-h-[60vh] overflow-y-auto p-4">
            <div class="grid gap-2 md:grid-cols-2">
              <article
                v-for="template in filteredChecklistTemplates"
                :key="template.id"
                class="rounded-lg border border-base-200 bg-base-50 p-3"
              >
                <button
                  type="button"
                  class="w-full text-left cursor-pointer"
                  :disabled="disabled"
                  @click="loadTemplate(template)"
                >
                  <span class="flex items-start justify-between gap-3">
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-semibold text-base-900">{{ template.title }}</span>
                      <span class="mt-0.5 block line-clamp-2 text-xs text-base-500">{{ template.description || t('event.planning.noChecklistDescription') }}</span>
                    </span>
                    <span class="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-semibold text-base-600">
                      {{ template.items.length }}
                    </span>
                  </span>
                </button>
                <div v-if="canSaveTemplates !== false" class="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn-secondary inline-flex items-center gap-1.5 px-2 py-1 text-xs"
                    :disabled="disabled"
                    @click="editTemplate(template)"
                  >
                    <Icon name="material-symbols:edit-rounded" />
                    {{ t('actions.edit') }}
                  </button>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-md border border-danger-200 bg-danger-50 px-2 py-1 text-xs font-medium text-danger-700 hover:bg-danger-100 disabled:opacity-60 cursor-pointer"
                    :disabled="disabled"
                    @click="removeTemplate(template.id)"
                  >
                    <Icon name="material-symbols:delete-rounded" />
                    {{ t('actions.remove') }}
                  </button>
                </div>
              </article>
            </div>

            <p v-if="filteredChecklistTemplates.length === 0" class="rounded-lg border border-dashed border-base-300 p-3 text-sm text-base-500">
              {{ t('event.planning.noMatchingChecklistTemplates') }}
            </p>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useTouchDrag } from '~/composables/useTouchDrag'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { PlanningChecklist, EventPlanningTask } from './types'

const props = defineProps<{
  disabled?: boolean
  canManage?: boolean
  canSaveTemplates?: boolean
  eventId?: number | null
  tasks?: EventPlanningTask[]
  tickOnlyChecklistIds?: number[]
}>()

const checklists = defineModel<PlanningChecklist[]>('checklists', { required: true })
const checklistTemplates = defineModel<PlanningChecklist[]>('templates', { required: true })
const emit = defineEmits<{
  (e: 'save-checklists', value: PlanningChecklist[]): void
  (e: 'save-templates', value: PlanningChecklist[]): void
  (e: 'create-task-from-checklist', value: { checklistId: number; title: string; deadline: string | null }): void
  (e: 'navigate-to-tasks'): void
  (e: 'set-item-done', value: { checklistId: number; itemId: number; done: boolean }): void
}>()
const { t } = useI18n()

const templateBrowserOpen = ref(false)
const templateSearch = ref('')
const editingChecklistId = ref<number | null>(null)
const editingTemplateId = ref<number | null>(null)
const nextChecklistId = ref(-1)
const nextTemplateId = ref(-1000)
const nextDraftItemId = ref(-1)
const draftItemInputs = ref<Record<number, HTMLInputElement | null>>({})
const draggedDraftItemId = ref<number | null>(null)
const draft = reactive<PlanningChecklist>(createEmptyChecklist(0))
const builderSectionEl = ref<HTMLElement | null>(null)

const { startTouchDrag: startDraftItemDragTouch } = useTouchDrag({
  findTarget(el) {
    const row = el?.closest('[data-draft-item-id]')
    if (!row) return null
    return { type: 'item', id: row.getAttribute('data-draft-item-id') ?? '' }
  },
  onOver(target) {
    if (target?.type === 'item') dragOverDraftItem(Number(target.id))
  },
  onDrop(target) {
    if (target?.type === 'item') dropDraftItem(Number(target.id))
    else finishItemDrag()
  },
  onEnd: finishItemDrag,
})

function startDraftItemTouchDrag(itemId: number, event: TouchEvent) {
  if (props.disabled || draft.items.length <= 1) return
  draggedDraftItemId.value = itemId
  const row = (event.currentTarget as HTMLElement).closest('[data-draft-item-id]') as HTMLElement | null
  if (row) startDraftItemDragTouch(event, row)
}

const canSaveDraft = computed(() => {
  return Boolean(draft.title.trim() && draft.items.some(item => item.label.trim()))
})
const builderTitle = computed(() => {
  if (editingTemplateId.value !== null) return t('event.planning.editChecklistTemplate')
  return t('event.planning.checklistBuilder')
})
const draftIsSavedAsTemplate = computed(() => {
  return editingTemplateId.value === null && isTemplateContentSaved(buildDraftChecklist())
})
const templateSaveLabel = computed(() => draftIsSavedAsTemplate.value
  ? t('event.planning.savedAsTemplate')
  : t('event.planning.saveAsTemplate'))
const filteredChecklistTemplates = computed(() => {
  const search = templateSearch.value.trim().toLocaleLowerCase()
  if (!search) return checklistTemplates.value

  return checklistTemplates.value.filter((template) => {
    const itemText = template.items.map(item => item.label).join(' ')
    return `${template.title} ${template.description} ${itemText}`.toLocaleLowerCase().includes(search)
  })
})

watch(
  checklists,
  (value) => {
    const ids = value.flatMap(checklist => [checklist.id, ...checklist.items.map(item => item.id)])
    const minimumId = Math.min(-1, ...ids)
    nextChecklistId.value = Math.min(nextChecklistId.value, minimumId - 1)
    nextDraftItemId.value = Math.min(nextDraftItemId.value, minimumId - 1)
  },
  { immediate: true, deep: true },
)

watch(
  checklistTemplates,
  (value) => {
    const ids = value.flatMap(template => [template.id, ...template.items.map(item => item.id)])
    const minimumId = Math.min(-1000, ...ids)
    nextTemplateId.value = Math.min(nextTemplateId.value, minimumId - 1)
    nextDraftItemId.value = Math.min(nextDraftItemId.value, minimumId - 1)
  },
  { immediate: true, deep: true },
)

function createEmptyChecklist(id: number): PlanningChecklist {
  return {
    id,
    title: '',
    description: '',
    items: [
      { id: nextDraftItemId.value--, label: '', done: false },
    ],
    taskId: null,
  }
}

function replaceDraft(nextDraft: PlanningChecklist) {
  draft.id = nextDraft.id
  draft.title = nextDraft.title
  draft.description = nextDraft.description
  draft.items = nextDraft.items.map(item => ({ ...item }))
}

function resetDraft() {
  editingChecklistId.value = null
  editingTemplateId.value = null
  replaceDraft(createEmptyChecklist(0))
}


function addDraftItem() {
  draft.items.push({ id: nextDraftItemId.value--, label: '', done: false })
}

async function addDraftItemAfter(itemId: number) {
  const index = draft.items.findIndex(item => item.id === itemId)
  const nextItem = { id: nextDraftItemId.value--, label: '', done: false }

  if (index === -1) {
    draft.items.push(nextItem)
  } else {
    draft.items.splice(index + 1, 0, nextItem)
  }

  await nextTick()
  draftItemInputs.value[nextItem.id]?.focus()
}

function setDraftItemInput(itemId: number, element: unknown) {
  draftItemInputs.value[itemId] = element instanceof HTMLInputElement ? element : null
}

function removeDraftItem(itemId: number) {
  if (draft.items.length <= 1) {
    draft.items = draft.items.map(item => item.id === itemId ? { ...item, label: '', done: false } : item)
    return
  }

  draft.items = draft.items.filter(item => item.id !== itemId)
  const nextInputs = { ...draftItemInputs.value }
  delete nextInputs[itemId]
  draftItemInputs.value = nextInputs
}

function startDraftItemDrag(itemId: number, event: DragEvent) {
  if (props.disabled || draft.items.length <= 1) return
  draggedDraftItemId.value = itemId
  event.dataTransfer?.setData('text/plain', String(itemId))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function dragOverDraftItem(targetItemId: number) {
  if (draggedDraftItemId.value === null || draggedDraftItemId.value === targetItemId) return
  draft.items = moveItemById(draft.items, draggedDraftItemId.value, targetItemId)
}

function dropDraftItem(targetItemId: number) {
  dragOverDraftItem(targetItemId)
  finishItemDrag()
}

function finishItemDrag() {
  draggedDraftItemId.value = null
}

function moveItemById<T extends { id: number }>(items: T[], sourceItemId: number, targetItemId: number) {
  const sourceIndex = items.findIndex(item => item.id === sourceItemId)
  const targetIndex = items.findIndex(item => item.id === targetItemId)
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return items

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(sourceIndex, 1)
  if (!movedItem) return items
  nextItems.splice(targetIndex, 0, movedItem)
  return nextItems
}

function normalizeDraftItems(keepDone = false) {
  return draft.items
    .map(item => ({ ...item, label: item.label.trim(), done: keepDone ? item.done : false }))
    .filter(item => item.label)
}

function duplicateDraftItems(keepDone = false) {
  return normalizeDraftItems(keepDone).map(item => ({
    id: nextDraftItemId.value--,
    label: item.label,
    done: item.done,
  }))
}

function buildDraftChecklist(): PlanningChecklist {
  return {
    id: draft.id,
    title: draft.title.trim(),
    description: draft.description.trim(),
    items: normalizeDraftItems(false),
    taskId: null,
  }
}

function saveDraftToEvent() {
  if (!canSaveDraft.value) return

  const existingTaskId = editingChecklistId.value !== null
    ? (checklists.value.find(c => c.id === editingChecklistId.value)?.taskId ?? null)
    : null

  const nextChecklist: PlanningChecklist = {
    id: editingChecklistId.value ?? nextChecklistId.value--,
    title: draft.title.trim(),
    description: draft.description.trim(),
    items: normalizeDraftItems(true),
    taskId: existingTaskId,
  }

  let nextChecklists: PlanningChecklist[]
  if (editingChecklistId.value === null) {
    nextChecklists = [...checklists.value, nextChecklist]
  } else {
    nextChecklists = checklists.value.map(checklist => checklist.id === editingChecklistId.value ? nextChecklist : checklist)
  }

  persistChecklists(nextChecklists)
  resetDraft()
}

function saveDraftAsTemplate() {
  if (!canSaveDraft.value) return

  if (editingTemplateId.value !== null) {
    const nextTemplate = {
      ...buildDraftChecklist(),
      id: editingTemplateId.value,
    }

    persistTemplates(checklistTemplates.value.map(template => template.id === editingTemplateId.value ? nextTemplate : template))
    resetDraft()
    return
  }

  if (draftIsSavedAsTemplate.value) return

  persistTemplates([
    {
      id: nextTemplateId.value--,
      title: draft.title.trim(),
      description: draft.description.trim(),
      items: duplicateDraftItems(false),
      taskId: null,
    },
    ...checklistTemplates.value,
  ])
}

function saveChecklistAsTemplate(checklist: PlanningChecklist) {
  if (isChecklistSavedAsTemplate(checklist)) return

  persistTemplates([
    duplicateChecklist(checklist, nextTemplateId.value--, false),
    ...checklistTemplates.value,
  ])
}

function loadTemplate(template: PlanningChecklist) {
  persistChecklists([
    ...checklists.value,
    duplicateChecklist(template, nextChecklistId.value--, false),
  ])
  templateBrowserOpen.value = false
}

async function editChecklist(checklist: PlanningChecklist) {
  editingChecklistId.value = checklist.id
  editingTemplateId.value = null
  replaceDraft(copyChecklist(checklist, true))
  await nextTick()
  builderSectionEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function editTemplate(template: PlanningChecklist) {
  editingChecklistId.value = null
  editingTemplateId.value = template.id
  templateBrowserOpen.value = false
  replaceDraft(copyChecklist(template, false))
}

function removeTemplate(templateId: number) {
  persistTemplates(checklistTemplates.value.filter(template => template.id !== templateId))
  if (editingTemplateId.value === templateId) resetDraft()
}

function removeChecklist(checklistId: number) {
  persistChecklists(checklists.value.filter(checklist => checklist.id !== checklistId))
  if (editingChecklistId.value === checklistId) resetDraft()
}

function canTickItems(checklist: PlanningChecklist) {
  return !props.disabled || (props.tickOnlyChecklistIds ?? []).includes(checklist.id)
}

function setChecklistItemDone(checklistId: number, itemId: number, done: boolean) {
  if (props.disabled) {
    if ((props.tickOnlyChecklistIds ?? []).includes(checklistId)) emit('set-item-done', { checklistId, itemId, done })
    return
  }

  persistChecklists(checklists.value.map((checklist) => {
    if (checklist.id !== checklistId) return checklist
    return {
      ...checklist,
      items: checklist.items.map(item => item.id === itemId ? { ...item, done } : item),
    }
  }))
}

function completedItemCount(checklist: PlanningChecklist) {
  return checklist.items.filter(item => item.done).length
}

function sortedItems(checklist: PlanningChecklist) {
  return [...checklist.items].sort((a, b) => Number(a.done) - Number(b.done))
}

function isChecklistSavedAsTemplate(checklist: PlanningChecklist) {
  return isTemplateContentSaved(checklist)
}

function isTemplateContentSaved(checklist: PlanningChecklist) {
  const signature = checklistSignature(checklist)
  return Boolean(signature) && checklistTemplates.value.some(template => template.id !== editingTemplateId.value && checklistSignature(template) === signature)
}

function checklistSignature(checklist: PlanningChecklist) {
  const title = checklist.title.trim()
  const items = checklist.items.map(item => item.label.trim()).filter(Boolean)
  if (!title || !items.length) return ''

  return JSON.stringify({
    title,
    description: checklist.description.trim(),
    items,
  })
}

function copyChecklist(checklist: PlanningChecklist, keepDone: boolean): PlanningChecklist {
  return {
    id: checklist.id,
    title: checklist.title,
    description: checklist.description,
    items: checklist.items.map(item => ({
      id: item.id,
      label: item.label,
      done: keepDone ? item.done : false,
    })),
    taskId: checklist.taskId,
  }
}

function duplicateChecklist(checklist: PlanningChecklist, id: number, keepDone: boolean): PlanningChecklist {
  return {
    id,
    title: checklist.title,
    description: checklist.description,
    items: checklist.items.map(item => ({
      id: nextDraftItemId.value--,
      label: item.label,
      done: keepDone ? item.done : false,
    })),
    taskId: null,
  }
}

// ---- Task linking ----

const linkingChecklistId = ref<number | null>(null)
const taskLinkQuery = ref('')
const creatingTaskForChecklistId = ref<number | null>(null)
const newTaskTitle = ref('')
const newTaskDeadline = ref<string | null>(null)

watch(linkingChecklistId, () => { taskLinkQuery.value = '' })

const claimedTaskIds = computed(() => new Set(checklists.value.flatMap(c => c.taskId ? [c.taskId] : [])))

function availableTasksForLinking(forChecklistId: number) {
  const currentTaskId = checklists.value.find(c => c.id === forChecklistId)?.taskId ?? null
  return (props.tasks ?? []).filter(t => t.linkedChecklistId === null || t.id === currentTaskId)
    .filter(t => !claimedTaskIds.value.has(t.id) || t.id === currentTaskId)
}

function taskLinkOptions(forChecklistId: number): SearchSelectOption<EventPlanningTask>[] {
  return availableTasksForLinking(forChecklistId).map(t => ({ key: t.id, label: t.title, value: t }))
}

function linkedTaskTitle(taskId: number) {
  return props.tasks?.find(t => t.id === taskId)?.title ?? String(taskId)
}

function openLinkTask(checklistId: number) {
  if (linkingChecklistId.value === checklistId) {
    linkingChecklistId.value = null
    return
  }
  linkingChecklistId.value = checklistId
  creatingTaskForChecklistId.value = null
}

function closeLinkTask() {
  linkingChecklistId.value = null
}

function selectTaskForChecklist(checklistId: number, selected: unknown) {
  const task = selected as EventPlanningTask | null
  if (!task) return
  persistChecklists(checklists.value.map(c =>
    c.id === checklistId ? { ...c, taskId: task.id } : c,
  ))
  linkingChecklistId.value = null
}

function unlinkTask(checklistId: number) {
  persistChecklists(checklists.value.map(c =>
    c.id === checklistId ? { ...c, taskId: null } : c,
  ))
}

function openCreateTask(checklistId: number) {
  if (creatingTaskForChecklistId.value === checklistId) {
    cancelCreateTask()
    return
  }
  const checklist = checklists.value.find(c => c.id === checklistId)
  newTaskTitle.value = checklist?.title ?? ''
  newTaskDeadline.value = null
  creatingTaskForChecklistId.value = checklistId
  linkingChecklistId.value = null
}

function cancelCreateTask() {
  creatingTaskForChecklistId.value = null
  newTaskTitle.value = ''
  newTaskDeadline.value = null
}

function submitCreateTask(checklistId: number) {
  const title = newTaskTitle.value.trim()
  if (!title) return
  emit('create-task-from-checklist', { checklistId, title, deadline: newTaskDeadline.value })
  cancelCreateTask()
}

function persistChecklists(nextChecklists: PlanningChecklist[]) {
  checklists.value = nextChecklists
  emit('save-checklists', nextChecklists)
}

function persistTemplates(nextTemplates: PlanningChecklist[]) {
  checklistTemplates.value = nextTemplates
  emit('save-templates', nextTemplates)
}
</script>

<style scoped>
.checklist-compact-input :deep(input),
.checklist-compact-input:deep(input) {
  height: 1.75rem;
  padding-top: 0.125rem;
  padding-bottom: 0.125rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.checklist-compact-input {
  height: 1.75rem;
}

.event-checklist-template-scroll {
  scrollbar-width: auto;
  scrollbar-color: #94a3b8 #e2e8f0;
}

.event-checklist-template-scroll::-webkit-scrollbar {
  width: 12px;
}

.event-checklist-template-scroll::-webkit-scrollbar-track {
  background: #e2e8f0;
  border-radius: 9999px;
}

.event-checklist-template-scroll::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 9999px;
  border: 2px solid #e2e8f0;
}
</style>
