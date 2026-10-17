<template>
  <section class="space-y-6">
    <div class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{{ t('event.planning.tasks') }}</h2>
          <p class="text-sm text-base-500">{{ t('event.planning.taskBoardHint') }}</p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <PageAuditScopedHistoryButton v-if="props.eventId" :tables="['event_tasks', 'event_task_members>event_tasks:event_id', 'event_task_subdivisions>event_tasks:event_id']" :parent-id="props.eventId" :context="t('event.planning.tasks')" />
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium cursor-pointer"
            :class="showOnlyMine ? 'border-info-300 bg-info-50 text-info-800' : 'border-base-200 bg-white text-base-600 hover:bg-base-50'"
            @click="showOnlyMine = !showOnlyMine"
          >
            <Icon name="material-symbols:person-rounded" />
            {{ t('event.planning.onlyMyTasks') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium cursor-pointer"
            :class="showOnlyOverdue ? 'border-danger-300 bg-danger-50 text-danger-800' : 'border-base-200 bg-white text-base-600 hover:bg-base-50'"
            @click="showOnlyOverdue = !showOnlyOverdue"
          >
            <Icon name="material-symbols:warning-rounded" />
            {{ t('event.planning.overdueOnly') }}
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium cursor-pointer"
            :class="showOnlyDueSoon ? 'border-warning-300 bg-warning-50 text-warning-800' : 'border-base-200 bg-white text-base-600 hover:bg-base-50'"
            @click="showOnlyDueSoon = !showOnlyDueSoon"
          >
            <Icon name="material-symbols:schedule-rounded" />
            {{ t('event.planning.dueSoonOnly') }}
          </button>

          <button
            v-if="isDirty || saving"
            type="button"
            class="btn-primary inline-flex items-center gap-2 h-8.5"
            :disabled="disabled || saving"
            @click="emit('save', tasks)"
          >
            <Icon v-if="saving" name="material-symbols:progress-activity" class="animate-spin" />
            <Icon v-else name="material-symbols:save-rounded" />
            {{ t('actions.save') }}
          </button>
          <span
            v-else
            class="inline-flex items-center gap-1.5 rounded-md border border-base-200 bg-white px-2.5 py-1.5 text-sm font-medium text-base-400"
          >
            <Icon name="material-symbols:check-circle-rounded" class="text-success-500" />
            {{ t('actions.saved') }}
          </span>
        </div>
      </div>

      <div v-if="canManage !== false" class="mt-4 rounded-lg border border-base-200 bg-base-50 p-3">
        <div class="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(12rem,auto)] lg:items-end xl:grid-cols-[minmax(14rem,1fr)_11rem_13rem_13rem_auto]">
          <div class="sm:col-span-2 lg:col-span-2 xl:col-span-1">
            <label class="text-xs font-medium text-base-500">{{ t('event.planning.taskTitle') }}</label>
            <input
              v-model="quickAdd.title"
              class="input mt-1"
              :placeholder="t('event.planning.quickAddTaskPlaceholder')"
              :disabled="disabled"
              @keydown.enter.prevent="addTask"
            >
          </div>

          <div>
            <div class="flex items-center justify-between gap-2">
              <label class="text-xs font-medium text-base-500">{{ t('event.planning.deadline') }}</label>
              <button
                type="button"
                class="py-0 leading-none text-xs font-medium text-accent-600 hover:text-accent-700 disabled:opacity-60 cursor-pointer"
                :disabled="disabled"
                @click="quickAddDateMode = quickAddDateMode === 'date' ? 'datetime' : 'date'"
              >
                {{ quickAddDateMode === 'date' ? t('event.planning.dateOnly') : t('event.planning.dateAndTime') }}
              </button>
            </div>
            <CommonDateInput v-model="quickAdd.deadline" class="mt-1" :mode="quickAddDateMode" :disabled="disabled" :empty-value="null" />
          </div>

          <div>
            <label class="text-xs font-medium text-base-500">{{ t('event.planning.assignedMembers') }}</label>
            <CommonSearchSelect
              v-model="quickAddMemberQuery"
              class="mt-1"
              :options="quickMemberOptions"
              :placeholder="t('event.planning.addMemberToTask')"
              :empty-text="t('event.noMatchingMembers')"
              :disabled="disabled"
              @select="selectQuickMember($event)"
              @clear-selection="quickAddMemberQuery = ''"
            />
          </div>

          <div>
            <label class="text-xs font-medium text-base-500">{{ t('event.planning.subdivision') }}</label>
            <CommonSearchSelect
              v-model="quickAddSubdivisionQuery"
              class="mt-1"
              :options="quickSubdivisionOptions"
              :placeholder="t('event.planning.addSubdivisionToTask')"
              :empty-text="t('event.noMatchingSubdivisions')"
              :disabled="disabled"
              @select="selectQuickSubdivision($event)"
              @clear-selection="quickAddSubdivisionQuery = ''"
            />
          </div>

          <button type="button" class="btn-primary inline-flex items-center justify-center gap-2 lg:w-full h-9.5 xl:w-auto" :disabled="disabled || !quickAdd.title.trim()" @click="addTask">
            <Icon name="material-symbols:add-rounded" />
            {{ t('event.planning.addTask') }}
          </button>
        </div>

        <div v-if="quickAdd.memberIds.length || quickAdd.subdivisionIds.length" class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-for="memberId in quickAdd.memberIds"
            :key="`quick-member-${memberId}`"
            class="inline-flex items-center gap-1 rounded border border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-700"
          >
            {{ memberLabel(memberId) }}
            <button
              type="button"
              class="inline-flex h-4 w-4 items-center justify-center rounded text-base-500 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-60 cursor-pointer"
              :disabled="disabled"
              @click="quickAdd.memberIds = quickAdd.memberIds.filter(id => id !== memberId)"
            >
              <Icon name="material-symbols:close-rounded" class="text-sm" />
            </button>
          </span>
          <span
            v-for="subdivisionId in quickAdd.subdivisionIds"
            :key="`quick-subdivision-${subdivisionId}`"
            class="inline-flex items-center gap-1 rounded border border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-700"
          >
            {{ subdivisionLabel(subdivisionId) }}
            <button
              type="button"
              class="inline-flex h-4 w-4 items-center justify-center rounded text-base-500 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-60 cursor-pointer"
              :disabled="disabled"
              @click="quickAdd.subdivisionIds = quickAdd.subdivisionIds.filter(id => id !== subdivisionId)"
            >
              <Icon name="material-symbols:close-rounded" class="text-sm" />
            </button>
          </span>
        </div>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <section
        v-for="column in statusColumns"
        :key="column.status"
        :data-column-status="column.status"
        class="-mx-6 min-h-72 min-w-0 bg-white p-3 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg"
      >
        <div class="flex items-center justify-between gap-3 border-b border-base-200 pb-3">
          <div>
            <h3 class="font-semibold text-base-900">{{ column.label }}</h3>
            <p class="text-xs text-base-500">{{ t('event.planning.taskCount', { count: tasksByStatus[column.status].length }) }}</p>
          </div>
          <span class="h-2.5 w-2.5 rounded-full" :class="column.dotClass" />
        </div>

        <div class="mt-3 space-y-3">
          <article
            v-for="task in tasksByStatus[column.status]"
            :key="task.id"
            :data-task-id="task.id"
            :draggable="canDragTask(task)"
            class="rounded-lg border border-base-200 border-l-4 bg-base-50 p-3 transition-all"
            :class="[
              draggedTaskId === task.id ? 'opacity-40' : '',
              dragOverTaskId === task.id ? 'ring-2 ring-inset ring-accent-400' : '',
              deadlineBorderClass(task),
            ]"
            @dragstart="canDragTask(task) && onDragStart(task.id, $event)"
            @dragover.prevent="canDropOnTask(task) && onDragOver(task.id)"
            @dragleave="onTaskDragLeave(task.id, $event)"
            @drop.prevent.stop="canDropOnTask(task) && onDrop(task.id, column.status)"
            @dragend="onDragEnd"
          >
            <div class="flex items-start gap-2">
              <span
                v-if="!disabled || isStatusOnlyTask(task)"
                class="mt-0.5 shrink-0 touch-none"
                :class="task.linkedChecklistId ? 'cursor-default' : 'cursor-grab'"
                @touchstart.prevent="!task.linkedChecklistId && startTaskCardTouchDrag(task.id, $event)"
              >
                <Icon
                  :name="task.linkedChecklistId ? 'material-symbols:lock' : 'material-symbols:drag-indicator'"
                  :class="task.linkedChecklistId ? 'text-info-400' : 'text-base-300'"
                  :title="task.linkedChecklistId ? t('event.planning.checklistControlled') : undefined"
                />
              </span>
              <input
                :value="task.title"
                class="min-w-0 flex-1 truncate bg-transparent text-sm font-semibold text-base-900 outline-none disabled:opacity-70"
                :disabled="disabled"
                @input="updateTask(task.id, { title: ($event.target as HTMLInputElement).value })"
              >
              <!-- Checklist link icon button -->
              <button
                v-if="task.linkedChecklistId"
                type="button"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-info-200 bg-info-50 text-info-600 hover:bg-info-100 cursor-pointer"
                :title="`${linkedChecklistTitle(task)}${task.linkedChecklistProgress ? ` (${task.linkedChecklistProgress.done}/${task.linkedChecklistProgress.total})` : ''}`"
                @click="emit('navigate-to-checklists')"
              >
                <Icon name="material-symbols:checklist-rounded" />
              </button>
              <button
                v-else-if="!disabled"
                type="button"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-base-200 bg-white text-base-400 hover:bg-base-50 hover:text-base-600 cursor-pointer"
                :title="t('event.planning.linkChecklist')"
                @click="linkingChecklistForTaskId = linkingChecklistForTaskId === task.id ? null : task.id"
              >
                <Icon name="material-symbols:checklist-rounded" />
              </button>
              <button
                v-if="canManage !== false"
                type="button"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 disabled:opacity-60 cursor-pointer"
                :disabled="disabled"
                :title="t('actions.remove')"
                @click="removeTask(task.id)"
              >
                <Icon name="material-symbols:delete-rounded" />
              </button>
            </div>

            <!-- Checklist link dropdown (opens inline below title) -->
            <div v-if="linkingChecklistForTaskId === task.id && !disabled" class="mt-1.5 flex items-center gap-1.5">
              <CommonSearchSelect
                class="event-task-compact-input min-w-0 flex-1"
                :model-value="checklistLinkQuery"
                :options="checklistLinkOptions"
                :placeholder="t('event.planning.selectChecklist')"
                :empty-text="t('event.planning.noUnlinkedChecklists')"
                @update:model-value="checklistLinkQuery = $event"
                @select="selectChecklistForTask(task.id, $event)"
                @clear-selection="checklistLinkQuery = ''"
              />
              <button type="button" class="shrink-0 text-xs text-base-400 hover:text-base-600 cursor-pointer" @click="linkingChecklistForTaskId = null">
                {{ t('actions.cancel') }}
              </button>
            </div>

            <div class="mt-2 flex items-center gap-1.5">
              <Icon name="material-symbols:event-upcoming-rounded" class="shrink-0" :class="deadlineTextClass(task)" />
              <CommonDateInput
                class="min-w-0 flex-1"
                size="sm"
                :model-value="task.deadline"
                :mode="taskDateMode(task)"
                :disabled="disabled"
                :empty-value="null"
                @update:model-value="updateTask(task.id, { deadline: $event })"
              />
              <button
                type="button"
                class="inline-flex shrink-0 items-center justify-center text-accent-600 hover:text-accent-700 disabled:opacity-60 not-disabled:cursor-pointer"
                :title="taskDateMode(task) === 'date' ? t('event.planning.dateAndTime') : t('event.planning.dateOnly')"
                :disabled="disabled"
                @click="toggleTaskDateMode(task)"
              >
                <span class="flex items-center xl:hidden">
                  <Icon
                    class="text-base"
                    :name="taskDateMode(task) === 'date' ? 'material-symbols:schedule-rounded' : 'material-symbols:calendar-today-rounded'"
                  />
                </span>
                <span class="hidden text-xs font-medium xl:inline">
                  {{ taskDateMode(task) === 'date' ? t('event.planning.dateOnly') : t('event.planning.dateAndTime') }}
                </span>
              </button>
            </div>

            <div class="mt-3 space-y-2">
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="memberId in task.memberIds"
                  :key="`task-${task.id}-member-${memberId}`"
                  class="inline-flex items-center gap-1 rounded border border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-700"
                >
                  {{ memberLabel(memberId) }}
                  <button
                    v-if="canManage !== false"
                    type="button"
                    class="inline-flex h-4 w-4 items-center justify-center rounded text-base-500 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-60 cursor-pointer"
                    :disabled="disabled"
                    @click="removeTaskMember(task.id, memberId)"
                  >
                    <Icon name="material-symbols:close-rounded" class="text-sm" />
                  </button>
                </span>
                <span
                  v-for="subdivisionId in task.subdivisionIds"
                  :key="`task-${task.id}-subdivision-${subdivisionId}`"
                  class="inline-flex items-center gap-1 rounded border border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-700"
                >
                  {{ subdivisionLabel(subdivisionId) }}
                  <button
                    v-if="canManage !== false"
                    type="button"
                    class="inline-flex h-4 w-4 items-center justify-center rounded text-base-500 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-60 cursor-pointer"
                    :disabled="disabled"
                    @click="removeTaskSubdivision(task.id, subdivisionId)"
                  >
                    <Icon name="material-symbols:close-rounded" class="text-sm" />
                  </button>
                </span>
                <span v-if="!task.memberIds.length && !task.subdivisionIds.length" class="rounded border border-dashed border-base-300 bg-white px-1.5 py-0.5 text-[0.7rem] font-medium text-base-500">
                  {{ t('event.planning.unassigned') }}
                </span>
              </div>

              <div v-if="canManage !== false" class="grid gap-2 sm:grid-cols-2">
                <CommonSearchSelect
                  class="event-task-compact-input"
                  :model-value="memberQueries[task.id] ?? ''"
                  :options="memberOptionsFor(task)"
                  :placeholder="t('event.planning.addMemberToTask')"
                  :empty-text="t('event.noMatchingMembers')"
                  :disabled="disabled"
                  @update:model-value="memberQueries[task.id] = $event"
                  @select="addTaskMember(task.id, $event)"
                  @clear-selection="memberQueries[task.id] = ''"
                />
                <CommonSearchSelect
                  class="event-task-compact-input"
                  :model-value="subdivisionQueries[task.id] ?? ''"
                  :options="subdivisionOptionsFor(task)"
                  :placeholder="t('event.planning.addSubdivisionToTask')"
                  :empty-text="t('event.noMatchingSubdivisions')"
                  :disabled="disabled"
                  @update:model-value="subdivisionQueries[task.id] = $event"
                  @select="addTaskSubdivision(task.id, $event)"
                  @clear-selection="subdivisionQueries[task.id] = ''"
                />
              </div>
            </div>
          </article>

          <div
            v-if="draggedTaskId !== null && tasksByStatus[column.status].length > 0"
            class="h-8 rounded-md border-2 border-dashed transition-colors"
            :class="dragOverColumnStatus === column.status ? 'border-accent-400 bg-accent-50' : 'border-transparent'"
            @dragover.prevent="canDropDraggedTask && onDragOverColumn(column.status)"
            @dragleave="onColumnDragLeave($event)"
            @drop.prevent="canDropDraggedTask && onDrop(null, column.status)"
          />
          <div
            v-if="tasksByStatus[column.status].length === 0"
            class="min-h-28 rounded-lg border border-dashed p-3 text-sm transition-colors"
            :class="dragOverColumnStatus === column.status ? 'border-accent-400 bg-accent-50 text-accent-600' : 'border-base-300 bg-base-50 text-base-500'"
            @dragover.prevent="canDropDraggedTask && onDragOverColumn(column.status)"
            @dragleave="onColumnDragLeave($event)"
            @drop.prevent="canDropDraggedTask && onDrop(null, column.status)"
          >
            {{ t('event.planning.noTasksInColumn') }}
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useTouchDrag } from '~/composables/useTouchDrag'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { EventMemberOption, EventSubdivisionOption } from '~/types/event'
import type { EventPlanningTask, EventPlanningTaskStatus, PlanningChecklist } from './types'

type DateMode = 'date' | 'datetime'

const props = defineProps<{
  disabled?: boolean
  canManage?: boolean
  saving?: boolean
  loading?: boolean
  eventId?: number | null
  members: EventMemberOption[]
  subdivisions: EventSubdivisionOption[]
  currentMemberId?: number | null
  checklists?: PlanningChecklist[]
  /**
   * Tasks whose status the user may change although they can't edit the list (they are assigned
   * to them). Moving one of these emits `change-status` instead of editing the list locally.
   */
  statusOnlyTaskIds?: number[]
}>()

const emit = defineEmits<{
  (e: 'save', tasks: EventPlanningTask[]): void
  (e: 'link-checklist-to-task', value: { checklistId: number; taskId: number }): void
  (e: 'navigate-to-checklists'): void
  (e: 'change-status', value: { taskId: number; status: EventPlanningTaskStatus }): void
}>()

const tasks = defineModel<EventPlanningTask[]>('tasks', { required: true })
const { t } = useI18n()

const nextDraftTaskId = ref(-1)

const quickAdd = reactive({
  title: '',
  deadline: null as string | null,
  memberIds: [] as number[],
  subdivisionIds: [] as number[],
})
const quickAddDateMode = ref<DateMode>('date')
const quickAddMemberQuery = ref('')
const quickAddSubdivisionQuery = ref('')
const memberQueries = reactive<Record<number, string>>({})
const subdivisionQueries = reactive<Record<number, string>>({})
const taskDateModes = reactive<Record<number, DateMode>>({})
const showOnlyMine = ref(false)
const showOnlyOverdue = ref(false)
const showOnlyDueSoon = ref(false)

const draggedTaskId = ref<number | null>(null)
const dragOverTaskId = ref<number | null>(null)
const dragOverColumnStatus = ref<EventPlanningTaskStatus | null>(null)

const { startTouchDrag: startTaskTouchDrag } = useTouchDrag({
  findTarget(el) {
    const card = el?.closest('[data-task-id]')
    if (card) return { type: 'task', id: card.getAttribute('data-task-id') ?? '' }
    const col = el?.closest('[data-column-status]')
    if (col) return { type: 'column', id: col.getAttribute('data-column-status') ?? '' }
    return null
  },
  onOver(target) {
    if (!target) {
      dragOverTaskId.value = null
      dragOverColumnStatus.value = null
    }
    else if (target.type === 'task') onDragOver(Number(target.id))
    else if (target.type === 'column') onDragOverColumn(target.id as EventPlanningTaskStatus)
  },
  onDrop(target) {
    if (target?.type === 'task') {
      const taskId = Number(target.id)
      const status = tasks.value.find(t => t.id === taskId)?.status ?? 'open'
      onDrop(taskId, status)
    }
    else if (target?.type === 'column') onDrop(null, target.id as EventPlanningTaskStatus)
    else onDragEnd()
  },
  onEnd: onDragEnd,
})

function startTaskCardTouchDrag(taskId: number, event: TouchEvent) {
  draggedTaskId.value = taskId
  const article = (event.currentTarget as HTMLElement).closest('article') as HTMLElement | null
  if (article) startTaskTouchDrag(event, article)
}

const savedSnapshot = ref(JSON.stringify(tasks.value))
const isDirty = computed(() => JSON.stringify(tasks.value) !== savedSnapshot.value)

watch(() => props.loading, (now, was) => {
  if (was && !now) savedSnapshot.value = JSON.stringify(tasks.value)
})

watch(() => props.saving, (now, was) => {
  if (was && !now) savedSnapshot.value = JSON.stringify(tasks.value)
})

const statusColumns = computed(() => [
  { status: 'open' as const, label: t('event.planning.taskStatus.open'), dotClass: 'bg-base-400' },
  { status: 'in_progress' as const, label: t('event.planning.taskStatus.inProgress'), dotClass: 'bg-info-500' },
  { status: 'done' as const, label: t('event.planning.taskStatus.done'), dotClass: 'bg-success-500' },
])

const quickMemberOptions = computed(() => memberOptions(quickAdd.memberIds))
const quickSubdivisionOptions = computed(() => subdivisionOptions(quickAdd.subdivisionIds))

const filteredTasks = computed(() => tasks.value
  .map(normalizeTask)
  .filter((task) => {
    if (showOnlyMine.value && (!props.currentMemberId || !task.memberIds.includes(props.currentMemberId))) return false
    if (showOnlyOverdue.value && !isOverdue(task)) return false
    if (showOnlyDueSoon.value && !isDueSoon(task)) return false
    return true
  }))

const tasksByStatus = computed<Record<EventPlanningTaskStatus, EventPlanningTask[]>>(() => ({
  open: filteredTasks.value.filter(task => task.status === 'open'),
  in_progress: filteredTasks.value.filter(task => task.status === 'in_progress'),
  done: filteredTasks.value.filter(task => task.status === 'done'),
}))

watch(
  tasks,
  (value) => {
    let changed = false
    const nextTasks = value.map((task) => {
      const normalized = normalizeTask(task)
      if (normalized !== task) changed = true
      return normalized
    })
    if (changed) tasks.value = nextTasks
  },
  { immediate: true, deep: true },
)

function normalizeTask(task: EventPlanningTask): EventPlanningTask {
  const status = task.status ?? 'open'
  const normalized = {
    ...task,
    deadline: task.deadline || null,
    status,
    memberIds: task.memberIds ?? [],
    subdivisionIds: task.subdivisionIds ?? [],
    linkedChecklistId: task.linkedChecklistId ?? null,
    linkedChecklistProgress: task.linkedChecklistProgress ?? null,
  }

  return normalized.status === task.status
    && normalized.deadline === task.deadline
    && normalized.memberIds === task.memberIds
    && normalized.subdivisionIds === task.subdivisionIds
    ? task
    : normalized
}

function addTask() {
  const title = quickAdd.title.trim()
  if (!title) return

  const next = [
    ...tasks.value,
    {
      id: nextDraftTaskId.value--,
      title,
      deadline: quickAdd.deadline || null,
      status: 'open' as const,
      memberIds: [...quickAdd.memberIds],
      subdivisionIds: [...quickAdd.subdivisionIds],
      linkedChecklistId: null,
      linkedChecklistProgress: null,
    },
  ]
  tasks.value = next

  quickAdd.title = ''
  quickAdd.deadline = null
  quickAdd.memberIds = []
  quickAdd.subdivisionIds = []
  quickAddMemberQuery.value = ''
  quickAddSubdivisionQuery.value = ''

  emit('save', next)
}

function updateTask(taskId: number, patch: Partial<EventPlanningTask>) {
  tasks.value = tasks.value.map(task => task.id === taskId
    ? normalizeTask({ ...task, ...patch })
    : task)
}


function removeTask(taskId: number) {
  tasks.value = tasks.value.filter(task => task.id !== taskId)
  delete memberQueries[taskId]
  delete subdivisionQueries[taskId]
  delete taskDateModes[taskId]
}

function selectQuickMember(value: unknown) {
  const member = value as EventMemberOption | null
  if (!member || quickAdd.memberIds.includes(member.id)) return
  quickAdd.memberIds.push(member.id)
  quickAddMemberQuery.value = ''
}

function selectQuickSubdivision(value: unknown) {
  const subdivision = value as EventSubdivisionOption | null
  if (!subdivision || quickAdd.subdivisionIds.includes(subdivision.id)) return
  quickAdd.subdivisionIds.push(subdivision.id)
  quickAddSubdivisionQuery.value = ''
}

function addTaskMember(taskId: number, value: unknown) {
  const member = value as EventMemberOption | null
  if (!member) return
  const task = tasks.value.find(entry => entry.id === taskId)
  if (!task || task.memberIds.includes(member.id)) return
  updateTask(taskId, { memberIds: [...task.memberIds, member.id] })
  memberQueries[taskId] = ''
}

function addTaskSubdivision(taskId: number, value: unknown) {
  const subdivision = value as EventSubdivisionOption | null
  if (!subdivision) return
  const task = tasks.value.find(entry => entry.id === taskId)
  if (!task || task.subdivisionIds.includes(subdivision.id)) return
  updateTask(taskId, { subdivisionIds: [...task.subdivisionIds, subdivision.id] })
  subdivisionQueries[taskId] = ''
}

function removeTaskMember(taskId: number, memberId: number) {
  const task = tasks.value.find(entry => entry.id === taskId)
  if (!task) return
  const memberIds = task.memberIds.filter(id => id !== memberId)
  updateTask(taskId, { memberIds })
}

function removeTaskSubdivision(taskId: number, subdivisionId: number) {
  const task = tasks.value.find(entry => entry.id === taskId)
  if (!task) return
  const subdivisionIds = task.subdivisionIds.filter(id => id !== subdivisionId)
  updateTask(taskId, { subdivisionIds })
}

function memberOptionsFor(task: EventPlanningTask) {
  return memberOptions(task.memberIds)
}

function subdivisionOptionsFor(task: EventPlanningTask) {
  return subdivisionOptions(task.subdivisionIds)
}

function memberOptions(selectedIds: number[]): SearchSelectOption<EventMemberOption>[] {
  return props.members
    .filter(member => !selectedIds.includes(member.id))
    .map(member => ({
      key: member.id,
      label: member.full_name,
      value: member,
    }))
}

function subdivisionOptions(selectedIds: number[]): SearchSelectOption<EventSubdivisionOption>[] {
  return props.subdivisions
    .filter(subdivision => !selectedIds.includes(subdivision.id))
    .map(subdivision => ({
      key: subdivision.id,
      label: subdivisionLabel(subdivision.id),
      value: subdivision,
      searchText: `${subdivision.code} ${subdivision.name}`,
    }))
}

function memberLabel(memberId: number) {
  return props.members.find(member => member.id === memberId)?.full_name ?? String(memberId)
}

function subdivisionLabel(subdivisionId: number) {
  const subdivision = props.subdivisions.find(entry => entry.id === subdivisionId)
  return subdivision ? `${subdivision.code} - ${subdivision.name}` : String(subdivisionId)
}

function taskDateMode(task: EventPlanningTask): DateMode {
  return taskDateModes[task.id] ?? (task.deadline && task.deadline.length <= 10 ? 'date' : 'datetime')
}

function toggleTaskDateMode(task: EventPlanningTask) {
  taskDateModes[task.id] = taskDateMode(task) === 'date' ? 'datetime' : 'date'
}

function deadlineBorderClass(task: EventPlanningTask): string {
  if (!task.deadline) return 'border-l-base-300'
  if (isOverdue(task)) return 'border-l-danger-500'
  if (isDueSoon(task)) return 'border-l-warning-400'
  return 'border-l-success-400'
}

function deadlineTextClass(task: EventPlanningTask): string {
  if (!task.deadline) return 'text-base-300'
  if (isOverdue(task)) return 'text-danger-500'
  if (isDueSoon(task)) return 'text-warning-400'
  return 'text-success-400'
}

function isOverdue(task: EventPlanningTask) {
  if (task.status === 'done') return false
  const dueDate = parseTaskDate(task.deadline)
  return Boolean(dueDate && dueDate.getTime() < Date.now())
}

function isDueSoon(task: EventPlanningTask) {
  if (task.status === 'done') return false
  const dueDate = parseTaskDate(task.deadline)
  if (!dueDate) return false
  const now = Date.now()
  const soon = now + 3 * 24 * 60 * 60 * 1000
  return dueDate.getTime() >= now && dueDate.getTime() <= soon
}

function parseTaskDate(value: string | null) {
  if (!value) return null
  const normalized = value.length <= 10 ? `${value}T23:59:59` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}


function onDragStart(taskId: number, event: DragEvent) {
  draggedTaskId.value = taskId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(taskId: number) {
  if (draggedTaskId.value === taskId) return
  dragOverTaskId.value = taskId
  dragOverColumnStatus.value = null
}

function onDragOverColumn(status: EventPlanningTaskStatus) {
  dragOverTaskId.value = null
  dragOverColumnStatus.value = status
}

function onTaskDragLeave(taskId: number, event: DragEvent) {
  const el = event.currentTarget as HTMLElement
  if (el.contains(event.relatedTarget as Node)) return
  if (dragOverTaskId.value === taskId) dragOverTaskId.value = null
}

function onColumnDragLeave(event: DragEvent) {
  const el = event.currentTarget as HTMLElement
  if (el.contains(event.relatedTarget as Node)) return
  dragOverColumnStatus.value = null
}

function onDragEnd() {
  draggedTaskId.value = null
  dragOverTaskId.value = null
  dragOverColumnStatus.value = null
}

// ---- Checklist linking ----

const linkingChecklistForTaskId = ref<number | null>(null)
const checklistLinkQuery = ref('')

watch(linkingChecklistForTaskId, () => { checklistLinkQuery.value = '' })

const availableChecklistsForTask = computed(() => {
  const linkedIds = new Set(tasks.value.flatMap(t => t.linkedChecklistId ? [t.linkedChecklistId] : []))
  return (props.checklists ?? []).filter(c => !linkedIds.has(c.id))
})

const checklistLinkOptions = computed<SearchSelectOption<PlanningChecklist>[]>(() =>
  availableChecklistsForTask.value.map(c => ({ key: c.id, label: c.title, value: c })),
)

function linkedChecklistTitle(task: EventPlanningTask) {
  if (!task.linkedChecklistId) return ''
  const checklist = props.checklists?.find(c => c.id === task.linkedChecklistId)
  return checklist?.title ?? String(task.linkedChecklistId)
}

function selectChecklistForTask(taskId: number, checklist: unknown) {
  const c = checklist as PlanningChecklist | null
  if (!c) return
  emit('link-checklist-to-task', { checklistId: c.id, taskId })
  linkingChecklistForTaskId.value = null
}

// ---- Drag: block for checklist-linked tasks ----

/** Only status changes are allowed for this task — the rest of the list is read-only to the user. */
function isStatusOnlyTask(task: EventPlanningTask) {
  return props.disabled && (props.statusOnlyTaskIds ?? []).includes(task.id)
}

function canDragTask(task: EventPlanningTask) {
  return !task.linkedChecklistId && (!props.disabled || isStatusOnlyTask(task))
}

const canDropDraggedTask = computed(() => {
  if (draggedTaskId.value === null) return false
  if (!props.disabled) return true
  const dragged = tasks.value.find(t => t.id === draggedTaskId.value)
  return Boolean(dragged && isStatusOnlyTask(dragged))
})

// A status-only drop only picks the column, so any card may serve as the target there.
function canDropOnTask(task: EventPlanningTask) {
  return canDropDraggedTask.value && (props.disabled || !task.linkedChecklistId)
}

function onDrop(targetTaskId: number | null, targetStatus: EventPlanningTaskStatus) {
  const sourceId = draggedTaskId.value
  onDragEnd()
  if (!sourceId || sourceId === targetTaskId) return

  const source = tasks.value.find(t => t.id === sourceId)
  if (!source) return

  if (source.linkedChecklistId) return

  if (props.disabled) {
    if (isStatusOnlyTask(source) && source.status !== targetStatus) {
      emit('change-status', { taskId: source.id, status: targetStatus })
    }
    return
  }

  const updated = normalizeTask({ ...source, status: targetStatus })
  const without = tasks.value.filter(t => t.id !== sourceId)

  let next: EventPlanningTask[]
  if (targetTaskId !== null) {
    const idx = without.findIndex(t => t.id === targetTaskId)
    next = idx === -1
      ? [...without, updated]
      : [...without.slice(0, idx), updated, ...without.slice(idx)]
  } else {
    let insertAt = without.length
    for (let i = without.length - 1; i >= 0; i--) {
      if (without[i]?.status === targetStatus) { insertAt = i + 1; break }
    }
    next = [...without.slice(0, insertAt), updated, ...without.slice(insertAt)]
  }

  tasks.value = next
}
</script>

<style scoped>
.event-task-compact-input :deep(input) {
  height: 1.75rem;
  padding-top: 0.125rem;
  padding-bottom: 0.125rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.event-task-compact-input {
  height: 1.75rem;
  padding-top: 0.125rem;
  padding-bottom: 0.125rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
}
</style>
