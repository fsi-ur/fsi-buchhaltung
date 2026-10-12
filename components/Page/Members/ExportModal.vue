<template>
  <CommonModal :model-value="modelValue" :title="t('member.export.title')" width-class="max-w-xl" @update:model-value="$emit('update:modelValue', $event)">
    <p class="text-sm text-base-500">{{ t('member.export.hint') }}</p>

    <div>
      <span class="block text-sm font-medium text-base-700">{{ t('member.export.format') }}</span>
      <div class="mt-1.5 grid grid-cols-2 gap-2">
        <button
          v-for="option in formatOptions"
          :key="option.value"
          type="button"
          :class="[
            'flex items-start gap-2.5 rounded-lg border p-3 text-left cursor-pointer',
            format === option.value ? 'border-base-800 bg-base-50' : 'border-base-200 hover:bg-base-50',
          ]"
          @click="format = option.value"
        >
          <Icon :name="option.icon" class="mt-0.5 shrink-0 text-lg text-base-700" />
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-base-900">{{ option.label }}</span>
            <span class="mt-0.5 block text-xs text-base-500">{{ option.hint }}</span>
          </span>
        </button>
      </div>
    </div>

    <div>
      <span class="block text-sm font-medium text-base-700">{{ t('member.export.preset') }}</span>
      <div class="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md border border-base-200 px-3 py-1.5 text-sm text-base-700 hover:bg-base-50 cursor-pointer"
          @click="applyAttendancePreset"
        >
          {{ t('member.export.presetAttendance') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-base-200 px-3 py-1.5 text-sm text-base-700 hover:bg-base-50 cursor-pointer"
          @click="applyListPreset"
        >
          {{ t('member.export.presetList') }}
        </button>
      </div>
      <p class="mt-1 text-xs text-base-500">{{ t('member.export.presetHint') }}</p>
    </div>

    <label class="block">
      <span class="text-sm font-medium text-base-700">{{ t('member.export.docTitle') }}</span>
      <input v-model="title" type="text" class="input mt-1 w-full" :placeholder="t('member.export.titlePlaceholder')">
    </label>

    <div>
      <span class="block text-sm font-medium text-base-700">{{ t('member.export.statuses') }}</span>
      <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
        <label v-for="option in statusOptions" :key="option.value" class="flex cursor-pointer items-center gap-2 text-sm text-base-700">
          <input v-model="statuses" type="checkbox" class="checkbox" :value="option.value">
          {{ option.label }}
        </label>
      </div>
    </div>

    <div>
      <span class="block text-sm font-medium text-base-700">{{ t('member.export.columns') }}</span>
      <div class="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <label v-for="option in dataColumnOptions" :key="option.key" class="flex cursor-pointer items-center gap-2 text-sm text-base-700">
          <input v-model="selectedColumns" type="checkbox" class="checkbox" :value="option.key">
          {{ option.label }}
        </label>
      </div>
    </div>

    <div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium text-base-700">{{ t('member.export.blankColumns') }}</span>
        <button
          type="button"
          class="rounded-md border border-base-200 px-2.5 py-1 text-sm text-base-700 hover:bg-base-50 cursor-pointer"
          @click="addBlankColumn"
        >
          {{ t('member.export.addBlankColumn') }}
        </button>
      </div>
      <p class="mt-1 text-xs text-base-500">{{ t('member.export.blankColumnsHint') }}</p>

      <div v-if="blankColumns.length" class="mt-2 space-y-2">
        <div v-for="(column, index) in blankColumns" :key="index" class="flex items-center gap-2">
          <input v-model="column.label" type="text" class="input flex-1 min-w-0" :placeholder="t('member.export.blankLabelPlaceholder')">
          <input v-model="column.hint" type="text" class="input flex-1 min-w-0" :placeholder="t('member.export.blankHintPlaceholder')">
          <button
            type="button"
            class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 cursor-pointer"
            :title="t('actions.remove')"
            @click="blankColumns.splice(index, 1)"
          >
            <Icon name="material-symbols:delete-rounded" class="text-base" />
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" :disabled="downloading" @click="$emit('update:modelValue', false)">
        {{ t('actions.cancel') }}
      </button>
      <button
        type="button"
        class="btn-primary inline-flex items-center gap-2"
        :disabled="downloading"
        @click="download"
      >
        <Icon name="material-symbols:download-rounded" />
        {{ t('member.export.download') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { downloadMemberListExport, type MemberExportFormat } from '~/utils/memberExportDownload'
import { MemberStatus, type MemberExportColumn, type MemberExportConfig, type MemberExportDataColumnKey } from '~/types/member'
const { today: appToday } = useAppTimeZone()

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const { t } = useI18n()
const toast = useToast()

const MAX_COLUMNS = 10

const format = ref<MemberExportFormat>('pdf')
const title = ref('')
const statuses = ref<MemberStatus[]>([MemberStatus.Active])
const selectedColumns = ref<MemberExportDataColumnKey[]>(['last_name', 'first_name'])
const blankColumns = ref<Array<{ label: string, hint: string }>>([])

const formatOptions = computed<Array<{ value: MemberExportFormat, label: string, hint: string, icon: string }>>(() => [
  { value: 'pdf', label: t('member.export.formatPdf'), hint: t('member.export.formatPdfHint'), icon: 'material-symbols:picture-as-pdf-rounded' },
  { value: 'excel', label: t('member.export.formatExcel'), hint: t('member.export.formatExcelHint'), icon: 'material-symbols:table-rounded' },
])

const statusOptions = computed(() => [
  { value: MemberStatus.Active, label: t('member.states.active') },
  { value: MemberStatus.Passive, label: t('member.states.passive') },
  { value: MemberStatus.Hold, label: t('member.states.hold') },
  { value: MemberStatus.Left, label: t('member.states.left') },
])

const dataColumnOptions = computed<Array<{ key: MemberExportDataColumnKey, label: string }>>(() => [
  { key: 'last_name', label: t('member.lastName') },
  { key: 'first_name', label: t('member.firstName') },
  { key: 'birthdate', label: t('member.birthdate') },
  { key: 'subject', label: t('member.subject') },
  { key: 'status', label: t('member.status') },
  { key: 'email', label: t('member.email') },
  { key: 'phone', label: t('member.phone') },
  { key: 'address', label: t('member.export.columnAddress') },
  { key: 'joined_at', label: t('member.joinedAt') },
  { key: 'left_at', label: t('member.leftAt') },
])

function formattedToday() {
  const today = appToday()
  return `${today.slice(8, 10)}.${today.slice(5, 7)}.${today.slice(0, 4)}`
}

function applyAttendancePreset() {
  title.value = t('member.export.attendanceTitle', { date: formattedToday() })
  statuses.value = [MemberStatus.Active]
  selectedColumns.value = ['last_name', 'first_name']
  blankColumns.value = [
    { label: t('member.export.attendanceSignature'), hint: t('member.export.attendanceSignatureHint') },
    { label: t('member.export.attendanceProxy'), hint: t('member.export.attendanceProxyHint') },
  ]
}

function applyListPreset() {
  title.value = t('member.export.presetList')
  statuses.value = [MemberStatus.Active, MemberStatus.Passive, MemberStatus.Hold]
  selectedColumns.value = ['last_name', 'first_name', 'birthdate', 'subject', 'status', 'joined_at']
  blankColumns.value = []
}

function addBlankColumn() {
  blankColumns.value.push({ label: '', hint: '' })
}

watch(() => props.modelValue, (open) => {
  if (open && !title.value.trim()) applyAttendancePreset()
})

const downloading = ref(false)

function buildConfig(): MemberExportConfig | null {
  if (!title.value.trim()) {
    toast.error(t('member.export.validation.titleRequired'))
    return null
  }
  if (!statuses.value.length) {
    toast.error(t('member.export.validation.statusesRequired'))
    return null
  }

  const columns: MemberExportColumn[] = []
  for (const option of dataColumnOptions.value) {
    if (!selectedColumns.value.includes(option.key)) continue
    columns.push({ key: option.key, label: option.label })
  }
  for (const blank of blankColumns.value) {
    if (!blank.label.trim()) {
      toast.error(t('member.export.validation.blankLabelRequired'))
      return null
    }
    const hint = blank.hint.trim()
    columns.push({ key: 'blank', label: blank.label.trim(), ...(hint ? { hint } : {}) })
  }

  if (!columns.length) {
    toast.error(t('member.export.validation.columnsRequired'))
    return null
  }
  if (columns.length > MAX_COLUMNS) {
    toast.error(t('member.export.validation.tooManyColumns', { max: MAX_COLUMNS }))
    return null
  }

  return { title: title.value.trim(), columns, statuses: statuses.value }
}

async function download() {
  const config = buildConfig()
  if (!config) return

  downloading.value = true
  try {
    const res = await downloadMemberListExport(format.value, config)
    if (res.ok) {
      toast.success(t('member.export.downloadSuccess'))
      emit('update:modelValue', false)
    } else {
      toast.error(res.error || t('member.export.downloadFailed'))
    }
  } catch {
    toast.error(t('member.export.downloadFailed'))
  } finally {
    downloading.value = false
  }
}
</script>
