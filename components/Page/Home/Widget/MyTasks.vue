<template>
  <PageHomeWidgetFrame
    :title="t('home.widgets.myTasks.title')"
    icon="material-symbols:task-alt-rounded"
    :loading="loading"
    :is-empty="!tasks.length"
    empty-icon="material-symbols:task-alt-rounded"
    :empty-text="t('home.widgets.myTasks.empty')"
  >
    <template v-if="tasks.length" #subtitle>
      <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-base-300">
        <span>{{ t('home.widgets.myTasks.openCount', { count: tasks.length }) }}</span>
        <span v-if="overdueCount" class="inline-flex items-center gap-1 font-semibold text-danger-300">
          <Icon name="material-symbols:warning-rounded" class="text-sm" />
          {{ t('home.widgets.myTasks.overdueCount', { count: overdueCount }) }}
        </span>
      </p>
    </template>

    <TransitionGroup tag="ul" name="my-task" class="relative flex flex-col gap-2">
      <li
        v-for="task in shownTasks"
        :key="task.id"
        data-my-task-row
        :class="{ 'my-task-completing': completingId === task.id }"
      >
        <div
          class="rounded-lg border border-l-4 border-base-200 p-3 transition hover:border-t-base-300 hover:border-r-base-300 hover:border-b-base-300"
          :class="[urgencyBorderClass(task), statusMenuId === task.id ? 'bg-base-50' : 'hover:bg-base-50']"
        >
          <div class="flex items-start gap-2.5">
            <!-- Status -->
            <button
              type="button"
              class="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition"
              :class="savingId === task.id ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-base-200'"
              :disabled="savingId === task.id"
              :title="t('home.widgets.myTasks.changeStatus')"
              :aria-label="t('home.widgets.myTasks.changeStatus')"
              :aria-expanded="statusMenuId === task.id"
              @click="toggleStatusMenu(task.id)"
            >
              <Icon
                :name="savingId === task.id ? 'material-symbols:progress-activity' : STATUS_META[task.status].icon"
                class="text-xl"
                :class="[STATUS_META[task.status].iconClass, { 'animate-spin': savingId === task.id }]"
              />
            </button>

            <!-- Title + context -->
            <button
              type="button"
              class="group min-w-0 flex-1 text-left"
              :class="canOpen(task) ? 'cursor-pointer' : 'cursor-default'"
              :disabled="!canOpen(task)"
              @click="openTask(task)"
            >
              <span class="flex items-start justify-between gap-2">
                <span class="min-w-0 truncate font-medium text-base-900" :class="{ 'group-hover:underline': canOpen(task) }">
                  {{ task.title }}
                </span>
                <span class="mt-0.5 flex shrink-0 items-center gap-1 text-xs" :class="urgencyTextClass(task)">
                  <Icon :name="urgencyOf(task) === 'overdue' ? 'material-symbols:warning-rounded' : 'material-symbols:event-upcoming-rounded'" class="text-sm" />
                  {{ deadlineLabel(task) }}
                </span>
              </span>

              <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-base-500">
                <span class="min-w-0 truncate">{{ task.eventName }}</span>
                <span
                  v-if="task.status === 'in_progress'"
                  class="rounded-full bg-info-100 px-1.5 py-px text-[11px] font-medium text-info-700"
                >
                  {{ t('event.planning.taskStatus.inProgress') }}
                </span>
                <span
                  v-if="!task.assignedDirectly && task.viaSubdivisions.length"
                  class="inline-flex items-center gap-0.5 text-base-400"
                  :title="task.viaSubdivisions.map(s => s.name).join(', ')"
                >
                  <Icon name="material-symbols:groups-rounded" class="text-sm" />
                  {{ t('home.widgets.myTasks.via', { name: task.viaSubdivisions.map(s => s.code).join(', ') }) }}
                </span>
                <span v-if="task.checklistProgress?.total" class="inline-flex items-center gap-0.5 text-base-400">
                  <Icon name="material-symbols:checklist-rounded" class="text-sm" />
                  {{ task.checklistProgress.done }}/{{ task.checklistProgress.total }}
                </span>
              </span>
            </button>

            <Icon
              v-if="canOpen(task)"
              name="material-symbols:chevron-right-rounded"
              class="mt-0.5 shrink-0 text-lg text-base-300"
            />
          </div>

          <!-- Inline status menu (inline rather than a popover: the widget frame clips overflow) -->
          <div
            v-if="statusMenuId === task.id"
            class="mt-2.5 grid grid-cols-3 gap-1 rounded-lg bg-base-100 p-1 text-xs font-medium"
            role="menu"
          >
            <button
              v-for="option in STATUS_OPTIONS"
              :key="option"
              type="button"
              role="menuitemradio"
              :aria-checked="task.status === option"
              class="flex cursor-pointer items-center justify-center gap-1 rounded-md px-2 py-1.5 transition"
              :class="task.status === option ? 'bg-white text-base-900 shadow-sm' : 'text-base-600 hover:bg-white/60 hover:text-base-900'"
              @click="changeStatus(task, option)"
            >
              <Icon :name="STATUS_META[option].icon" class="shrink-0 text-sm" :class="STATUS_META[option].iconClass" />
              <span class="truncate">{{ t(STATUS_META[option].labelKey) }}</span>
            </button>
          </div>
        </div>
      </li>
    </TransitionGroup>

    <button
      v-if="tasks.length > MAX_COLLAPSED"
      type="button"
      class="mt-3 w-full cursor-pointer rounded-lg py-1.5 text-center text-xs font-medium text-base-500 transition hover:bg-base-50 hover:text-base-800"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('home.widgets.myTasks.showLess') : t('home.widgets.myTasks.showMore', { count: tasks.length - MAX_COLLAPSED }) }}
    </button>
  </PageHomeWidgetFrame>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { GetMyTasksResponse } from '~/server/api/tasks/mine.get'
import type { UpdateTaskStatusResponse } from '~/server/api/tasks/[id]/status.put'
import type { EventTaskStatus, MyEventTask } from '~/types/event'
import { daysUntilDeadline, sortMyTasks, taskUrgency, type TaskUrgency } from '~/utils/myTasks'

const emit = defineEmits<{
  /** The dashboard hides this widget entirely while the user has no open tasks. */
  (e: 'update:hidden', hidden: boolean): void
}>()

const { t } = useI18n()
const toast = useToast()
const { setPage } = usePage()
const { hasPermission, resolveFlag } = useAuth()
const { formatDate } = useLocaleFormatters()

const MAX_COLLAPSED = 5
const STATUS_OPTIONS: EventTaskStatus[] = ['open', 'in_progress', 'done']
const STATUS_META: Record<EventTaskStatus, { icon: string; iconClass: string; labelKey: string }> = {
  open: { icon: 'material-symbols:circle-outline', iconClass: 'text-base-400', labelKey: 'event.planning.taskStatus.open' },
  in_progress: { icon: 'material-symbols:clock-loader-40', iconClass: 'text-info-500', labelKey: 'event.planning.taskStatus.inProgress' },
  done: { icon: 'material-symbols:check-circle-rounded', iconClass: 'text-success-500', labelKey: 'event.planning.taskStatus.done' },
}

const loading = ref(true)
const loadedOnce = ref(false)
const tasks = ref<MyEventTask[]>([])
const expanded = ref(false)
const statusMenuId = ref<number | null>(null)
const savingId = ref<number | null>(null)
const completingId = ref<number | null>(null)
const { nowLocal } = useAppTimeZone()
const now = ref(nowLocal())

const shownTasks = computed(() => expanded.value ? tasks.value : tasks.value.slice(0, MAX_COLLAPSED))
const overdueCount = computed(() => tasks.value.filter(task => urgencyOf(task) === 'overdue').length)

// Hidden until the first load says there is something to show, so users without tasks never see it.
watchEffect(() => emit('update:hidden', !loadedOnce.value || !tasks.value.length))

function urgencyOf(task: MyEventTask): TaskUrgency {
  return taskUrgency(task.deadline, now.value)
}

function urgencyBorderClass(task: MyEventTask) {
  switch (urgencyOf(task)) {
    case 'overdue': return 'border-l-danger-500'
    case 'today':
    case 'soon': return 'border-l-warning-400'
    case 'later': return 'border-l-success-400'
    default: return 'border-l-base-300'
  }
}

function urgencyTextClass(task: MyEventTask) {
  switch (urgencyOf(task)) {
    case 'overdue': return 'font-semibold text-danger-600'
    case 'today': return 'font-semibold text-warning-600'
    case 'soon': return 'text-warning-600'
    default: return 'text-base-400'
  }
}

function deadlineLabel(task: MyEventTask) {
  if (!task.deadline) return t('home.widgets.myTasks.noDeadline')

  const time = task.deadline.length > 10 ? task.deadline.slice(11, 16) : ''
  const days = daysUntilDeadline(task.deadline, now.value)
  const day = days === 0
    ? t('calendar.today')
    : days === 1
      ? t('calendar.tomorrow')
      : formatDate(task.deadline.slice(0, 10))
  const label = time ? `${day} · ${time}` : day

  return urgencyOf(task) === 'overdue' ? t('home.widgets.myTasks.overdueSince', { date: label }) : label
}

// The event editor page itself is gated on events.access, on top of the task tab's own check.
function canOpen(task: MyEventTask) {
  return hasPermission('events.access') && resolveFlag(task.canOpenEvent, 'events.view')
}

function openTask(task: MyEventTask) {
  if (!canOpen(task)) return
  setPage('EventCreate', {
    eventId: task.eventId,
    tab: 'tasks',
    returnTarget: buildReturnTarget('Home'),
  })
}

function toggleStatusMenu(taskId: number) {
  statusMenuId.value = statusMenuId.value === taskId ? null : taskId
}

async function saveStatus(taskId: number, status: EventTaskStatus) {
  try {
    const res = await $fetch<UpdateTaskStatusResponse>(`/api/tasks/${taskId}/status`, {
      method: 'PUT',
      body: { status },
    })
    return res.ok
  } catch {
    return false
  }
}

function putBack(task: MyEventTask) {
  tasks.value = sortMyTasks([...tasks.value.filter(entry => entry.id !== task.id), task])
}

async function changeStatus(task: MyEventTask, status: EventTaskStatus) {
  statusMenuId.value = null
  if (status === task.status || savingId.value !== null) return

  const previous = { ...task }
  savingId.value = task.id

  // Optimistic: a finished task leaves the list right away; the toast offers the way back.
  if (status === 'done') {
    // Render the marker class first: a leaving element keeps the classes of its last render.
    completingId.value = task.id
    await nextTick()
    tasks.value = tasks.value.filter(entry => entry.id !== task.id)
    await nextTick()
    completingId.value = null
  } else {
    putBack({ ...task, status })
  }

  const ok = await saveStatus(task.id, status)
  savingId.value = null

  if (!ok) {
    putBack(previous)
    toast.error(t('home.widgets.myTasks.updateFailed'))
    return
  }

  if (status === 'done') {
    toast.show(t('home.widgets.myTasks.doneToast', { title: task.title }), 'success', undefined, {
      label: t('home.widgets.myTasks.undo'),
      handler: () => undoDone(previous),
    })
  }
}

async function undoDone(previous: MyEventTask) {
  putBack(previous)
  if (!await saveStatus(previous.id, previous.status)) {
    tasks.value = tasks.value.filter(entry => entry.id !== previous.id)
    toast.error(t('home.widgets.myTasks.updateFailed'))
  }
}

function onDocumentClick(event: MouseEvent) {
  if (!(event.target as HTMLElement | null)?.closest('[data-my-task-row]')) statusMenuId.value = null
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') statusMenuId.value = null
}

watch(statusMenuId, (id) => {
  if (id !== null) {
    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener('keydown', onDocumentKeydown, true)
  } else {
    document.removeEventListener('click', onDocumentClick, true)
    document.removeEventListener('keydown', onDocumentKeydown, true)
  }
})

async function load() {
  loading.value = true
  try {
    const res = await $fetch<GetMyTasksResponse>('/api/tasks/mine')
    tasks.value = res.ok ? sortMyTasks(res.tasks) : []
  } catch {
    tasks.value = []
  } finally {
    now.value = nowLocal()
    loading.value = false
    loadedOnce.value = true
  }
}

let clockId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  load()
  clockId = setInterval(() => { now.value = nowLocal() }, 60000)
})

onBeforeUnmount(() => {
  if (clockId) clearInterval(clockId)
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onDocumentKeydown, true)
})

useAppRefresh().onRefresh(load)
</script>

<style scoped>
.my-task-move,
.my-task-enter-active,
.my-task-leave-active {
  transition: all 0.25s ease;
}

.my-task-enter-from,
.my-task-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.my-task-completing.my-task-leave-active {
  position: absolute;
  inset-inline: 0;
}
</style>
