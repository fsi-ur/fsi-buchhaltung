<template>
  <div class="space-y-6">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h2 class="text-lg font-semibold">{{ t('member.masterData') }}</h2>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.firstName') }}</label>
          <input v-model="form.first_name" class="input" :disabled="disabled">
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.lastName') }}</label>
          <input v-model="form.last_name" class="input" :disabled="disabled">
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.birthdate') }}</label>
          <CommonDateInput v-model="form.birthdate" :disabled="disabled" />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.status') }}</label>
          <MenuDropdown v-model="openStatus" :id="0" :disabled="disabled">
            <template #trigger="{ styling }">
              <button :class="[styling, !disabled ? 'cursor-pointer' : '']" :disabled="disabled">
                <span>{{ statusLabel(form.status) }}</span>
                <Icon v-if="!disabled" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
              </button>
            </template>

            <template #default="{ styling }">
              <button :class="styling" @click="selectStatus(MemberStatus.Active)">{{ t('member.states.active') }}</button>
              <button :class="styling" @click="selectStatus(MemberStatus.Passive)">{{ t('member.states.passive') }}</button>
              <button :class="styling" @click="selectStatus(MemberStatus.Hold)">{{ t('member.states.hold') }}</button>
              <button :class="styling" @click="selectStatus(MemberStatus.Left)">{{ t('member.states.left') }}</button>
            </template>
          </MenuDropdown>
        </div>
      </div>

      <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
        <input v-model="form.honorary" type="checkbox" class="checkbox" :disabled="disabled">
        {{ t('member.honorary') }}
      </label>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h3 class="font-semibold">{{ t('member.contact') }}</h3>

      <div class="grid md:grid-cols-4 gap-4">
        <div class="md:col-span-3">
          <label class="text-sm font-medium text-base-600">{{ t('member.street') }}</label>
          <input v-model="form.street" class="input" :disabled="disabled">
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.streetNumber') }}</label>
          <input v-model="form.street_number" class="input" :disabled="disabled">
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.postalCode') }}</label>
          <input v-model="form.postal_code" class="input" :disabled="disabled">
        </div>

        <div class="md:col-span-3">
          <label class="text-sm font-medium text-base-600">{{ t('member.city') }}</label>
          <input v-model="form.city" class="input" :disabled="disabled">
        </div>

        <div class="md:col-span-2">
          <label class="text-sm font-medium text-base-600">{{ t('member.phone') }}</label>
          <input v-model="form.phone" class="input" :disabled="disabled">
        </div>

        <div class="md:col-span-2">
          <label class="text-sm font-medium text-base-600">{{ t('member.email') }}</label>
          <input v-model="form.email" type="email" class="input" :disabled="disabled">
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h3 class="font-semibold">{{ t('member.membership') }}</h3>

      <div class="grid md:grid-cols-3 gap-4 items-end">
        <div class="md:col-span-3">
          <label class="text-sm font-medium text-base-600">{{ t('member.subject') }}</label>

          <div v-if="renamingSubject" class="flex items-center gap-2">
            <input
              v-model="renameSubjectValue"
              class="input w-full"
              :disabled="renamingSubjectSaving"
              @keydown.enter.prevent="confirmRenameSubject"
              @keydown.escape.prevent="cancelRenameSubject"
            >
            <button
              type="button"
              class="flex items-center justify-center h-10 w-10 shrink-0 rounded-md hover:bg-base-100 text-success-600 cursor-pointer disabled:opacity-50"
              :disabled="renamingSubjectSaving"
              :title="t('actions.save')"
              @click="confirmRenameSubject"
            >
              <Icon name="material-symbols:check-rounded" class="text-xl" />
            </button>
            <button
              type="button"
              class="flex items-center justify-center h-10 w-10 shrink-0 rounded-md hover:bg-base-100 text-base-500 cursor-pointer disabled:opacity-50"
              :disabled="renamingSubjectSaving"
              :title="t('actions.cancel')"
              @click="cancelRenameSubject"
            >
              <Icon name="material-symbols:close-rounded" class="text-xl" />
            </button>
          </div>

          <CommonSearchSelect
            v-else
            v-model="subjectQuery"
            :options="subjectOptions"
            :selected-label="form.subject_name || ''"
            :placeholder="canEditSubjects ? t('member.subjectEditablePlaceholder') : t('member.subjectPlaceholder')"
            :empty-text="t('member.noSubjects')"
            :disabled="disabled"
            :allow-create="canEditSubjects"
            :create-action-label="t('actions.createNew')"
            @select="onSubjectSelect"
            @create="createSubjectFromQuery"
            @clear-selection="form.subject_name = ''"
          >
            <template #after-trigger>
              <button
                v-if="canEditSubjects && !disabled && selectedSubject"
                type="button"
                class="flex items-center justify-center h-10 w-10 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer"
                :title="t('member.renameSubject')"
                @click.stop.prevent="startRenameSubject"
              >
                <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
              </button>
            </template>
          </CommonSearchSelect>
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.appliedAt') }}</label>
          <CommonDateInput v-model="form.applied_at" :disabled="disabled" />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.joinedAt') }}</label>
          <CommonDateInput v-model="form.joined_at" :disabled="disabled" />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.leftAt') }}</label>
          <CommonDateInput v-model="leftAtInput" :disabled="disabled" :empty-value="null" />
        </div>
      </div>

      <div>
        <label class="text-sm font-medium text-base-600">{{ t('member.notes') }}</label>
        <textarea v-model="form.notes" rows="3" class="input resize-none" :disabled="disabled" />
      </div>
    </section>

    <section v-if="canManageSubdivisions" class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h3 class="font-semibold">{{ t('member.subdivisions') }}</h3>

      <CommonSelectionListField
        :query="subdivisionQuery"
        :options="subdivisionOptions"
        :selected-items="selectedSubdivisionItems"
        :placeholder="t('member.subdivisionPlaceholder')"
        :empty-text="t('member.noSubdivisions')"
        :empty-selection-text="t('member.noSubdivisionsAssigned')"
        :remove-label="t('actions.remove')"
        :helper-text="t('member.subdivisionHelper')"
        :disabled="disabled"
        @update:query="subdivisionQuery = $event"
        @select="selectSubdivision"
        @clear-selection="subdivisionQuery = ''"
        @remove="removeSubdivision"
      />

      <p
        v-if="hasInactiveSelectedSubdivisions"
        class="text-sm text-warning-700"
      >
        {{ t('member.inactiveSubdivisionHintRemove') }}
      </p>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h3 class="font-semibold">{{ t('member.positions') }}</h3>

      <div
        v-for="(assignment, i) in form.positions"
        :key="positionRowKey(assignment)"
        class="grid grid-cols-1 md:grid-cols-[3fr_2fr_2fr_auto] gap-2 items-center"
      >
        <CommonSearchSelect
          :model-value="positionQueryFor(assignment)"
          :options="positionOptions"
          :selected-label="selectedPositionLabel(i)"
          :placeholder="t('member.positionPlaceholder')"
          :empty-text="t('member.noPositions')"
          :disabled="disabled"
          @update:model-value="setPositionQuery(assignment, $event)"
          @select="selectPositionFromOption(i, $event)"
          @clear-selection="clearPosition(i)"
        />

        <CommonDateInput v-model="assignment.since" :disabled="disabled" />
        <CommonDateInput v-model="assignment.until" :disabled="disabled" :empty-value="null" />

        <button
          v-if="!disabled"
          class="text-danger-500 cursor-pointer p-2 w-10 rounded-md hover:bg-base-100"
          type="button"
          @click="removePosition(i)"
        >
          ✕
        </button>

        <p
          v-if="isAssignedPositionInactive(i)"
          class="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-900 md:col-span-3"
        >
          {{ t('member.inactivePositionHintEndAssignment') }}
        </p>
      </div>

      <button
        v-if="!disabled"
        type="button"
        class="flex items-center gap-2 text-accent-500 font-medium cursor-pointer"
        @click="addPosition"
      >
        <span class="text-xl">+</span> {{ t('actions.addPosition') }}
      </button>
    </section>

    <section v-if="canManageUsers && showAccountCreation" class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h3 class="font-semibold">{{ t('member.accountTitle') }}</h3>

      <label class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
        <input v-model="accountCreationEnabled" type="checkbox" class="checkbox" :disabled="disabled">
        {{ t('member.createAccount') }}
      </label>

      <div v-if="accountCreationEnabled" class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.accountUsername') }}</label>
          <input
            v-model="form.new_account!.username"
            class="input"
            :disabled="disabled"
            name="new-account-username"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            data-lpignore="true"
            @input="usernameManuallyEdited = true"
          >
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.accountPassword') }}</label>
          <input
            v-model="form.new_account!.password"
            type="password"
            class="input"
            :disabled="disabled"
            name="new-account-password"
            autocomplete="new-password"
            autocapitalize="off"
            spellcheck="false"
            data-lpignore="true"
          >
        </div>
      </div>

      <div class="flex gap-3">
        <label v-if="accountCreationEnabled" class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
          <input v-model="form.new_account!.is_active" type="checkbox" class="checkbox" :disabled="disabled">
          {{ t('member.accountActive') }}
        </label>

        <label v-if="accountCreationEnabled" class="inline-flex items-center gap-2 text-sm text-base-700 cursor-pointer">
          <input v-model="form.new_account!.must_change_password" type="checkbox" class="checkbox" :disabled="disabled">
          {{ t('member.accountMustChangePassword') }}
        </label>
      </div>
    </section>

    <slot name="beforeActions" />

    <CommonFormActions
      :disabled="Boolean(props.disabled)"
      :save-disabled="saveDisabled"
      :saving="Boolean(props.saving)"
      :saving-label="t('actions.saving')"
      :cancel-label="t('actions.cancel')"
      :submit-label="t('actions.save')"
      :close-label="t('actions.close')"
      @cancel="emit('cancel')"
      @submit="emit('submit')"
    />

    <CommonValidationSummary :errors="validationErrors" :title="t('common.validationBlocked')" />
  </div>
</template>

<script setup lang="ts">
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { SelectionListItem } from '~/components/Common/SelectionListField.vue'
import { useI18n } from '~/composables/useI18n'
import type { PositionRow } from '~/types/position'
import type { SubdivisionOption } from '~/types/subdivision'
import { MemberStatus, type MemberPositionAssignment, type SaveMemberBody } from '~/types/member'
import type { SubjectRow } from '~/types/subject'

const props = defineProps<{
  modelValue: SaveMemberBody
  disabled?: boolean
  saving?: boolean
  canEditSubjects?: boolean
  canManageUsers?: boolean
  canManageSubdivisions?: boolean
  showAccountCreation?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: SaveMemberBody): void
  (e: 'submit'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()

const form = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})
const leftAtInput = computed({
  get: () => form.value.left_at ?? null,
  set: (value: string | null) => {
    form.value.left_at = value
  },
})
const disabled = computed(() => Boolean(props.disabled))
const canEditSubjects = computed(() => props.canEditSubjects !== false)
const canManageUsers = computed(() => props.canManageUsers === true)
const canManageSubdivisions = computed(() => props.canManageSubdivisions === true)
const showAccountCreation = computed(() => props.showAccountCreation === true)
const usernameManuallyEdited = ref(false)

const accountCreationEnabled = computed({
  get: () => Boolean(form.value.new_account),
  set: (enabled: boolean) => {
    usernameManuallyEdited.value = false
    form.value.new_account = enabled
      ? {
          username: buildDefaultAccountUsername(form.value.first_name, form.value.last_name),
          password: '',
          is_active: true,
          must_change_password: true,
        }
      : null
  },
})

const subjects = ref<SubjectRow[]>([])
const subjectQuery = ref('')
const subjectOptions = computed<SearchSelectOption<string>[]>(() => subjects.value.map(subject => ({
  key: subject.id,
  label: subject.name,
  value: subject.name,
})))
const selectedSubject = computed(() => subjects.value.find(subject => subject.name === form.value.subject_name) || null)
const renamingSubject = ref(false)
const renamingSubjectSaving = ref(false)
const renameSubjectValue = ref('')
const positions = ref<PositionRow[]>([])
const subdivisions = ref<SubdivisionOption[]>([])
const positionQueries = ref<Record<string, string>>({})
const subdivisionQuery = ref('')
let nextPositionRowKey = 0
const positionsById = computed(() => new Map(
  positions.value.map(position => [Number(position.id), position]),
))
const selectedPositionIds = computed(() => new Set(
  form.value.positions
    .map(position => Number(position.position_id))
    .filter(positionId => Number.isInteger(positionId) && positionId > 0),
))
const positionOptions = computed<SearchSelectOption<PositionRow>[]>(() => positions.value
  .filter(position => position.is_active || selectedPositionIds.value.has(position.id))
  .map(position => ({
    key: position.id,
    label: formatPositionLabel(position),
    value: position,
    searchText: `${position.code} ${position.name} ${position.is_active ? '' : t('common.inactive')}`.trim(),
  })))
const subdivisionsById = computed(() => {
  return new Map(subdivisions.value.map(subdivision => [subdivision.id, subdivision]))
})
const selectedSubdivisionItems = computed<SelectionListItem[]>(() => {
  return (form.value.subdivision_ids ?? [])
    .map(subdivisionId => subdivisionsById.value.get(subdivisionId))
    .filter((subdivision): subdivision is SubdivisionOption => Boolean(subdivision))
    .map(subdivision => ({
      id: subdivision.id,
      label: subdivision.name,
      meta: subdivision.is_active ? subdivision.code : `${subdivision.code} (${t('common.inactive')})`,
    }))
})
const hasInactiveSelectedSubdivisions = computed(() => {
  return (form.value.subdivision_ids ?? []).some((subdivisionId) => {
    const subdivision = subdivisionsById.value.get(subdivisionId)
    return subdivision ? !Boolean(subdivision.is_active) : false
  })
})
const subdivisionOptions = computed<SearchSelectOption<number>[]>(() => {
  const selectedIds = new Set(form.value.subdivision_ids ?? [])

  return subdivisions.value
    .filter(subdivision => (subdivision.is_active || selectedIds.has(subdivision.id)) && !selectedIds.has(subdivision.id))
    .map(subdivision => ({
      key: subdivision.id,
      label: formatSubdivisionLabel(subdivision),
      value: subdivision.id,
      searchText: `${subdivision.code} ${subdivision.name} ${subdivision.is_active ? '' : t('common.inactive')}`.trim(),
    }))
})
const openStatus = ref<number | null>(null)

const validationErrors = computed(() => {
  const errors: string[] = []

  if (!form.value.first_name?.trim()) errors.push(t('member.required.firstName'))
  if (!form.value.last_name?.trim()) errors.push(t('member.required.lastName'))
  if (!form.value.birthdate) errors.push(t('member.required.birthdate'))
  if (!form.value.subject_name?.trim()) errors.push(t('member.required.subject'))
  if (!form.value.street?.trim()) errors.push(t('member.required.street'))
  if (!form.value.street_number?.trim()) errors.push(t('member.required.streetNumber'))
  if (!form.value.postal_code?.trim()) errors.push(t('member.required.postalCode'))
  if (!form.value.city?.trim()) errors.push(t('member.required.city'))
  if (!form.value.phone?.trim()) errors.push(t('member.required.phone'))
  if (!form.value.email?.trim()) errors.push(t('member.required.email'))
  if (!form.value.status?.trim()) errors.push(t('member.required.status'))
  if (!form.value.applied_at) errors.push(t('member.required.appliedAt'))
  if (!form.value.joined_at) errors.push(t('member.required.joinedAt'))
  if (form.value.new_account && !form.value.new_account.username.trim()) errors.push(t('member.required.accountUsername'))
  if (form.value.new_account && !form.value.new_account.password.trim()) errors.push(t('member.required.accountPassword'))
  if (form.value.status === MemberStatus.Left && !form.value.left_at) {
    errors.push(t('member.required.leftDateNeeded'))
  }
  if (form.value.status !== MemberStatus.Left && form.value.left_at) {
    errors.push(t('member.required.leftDateOnlyWhenLeft'))
  }

  form.value.positions.forEach((position, index) => {
    if (!position.position_id || !position.since) {
      errors.push(t('member.required.positionRow', { index: index + 1 }))
    }

    if (position.since && position.until && position.until < position.since) {
      errors.push(t('member.required.positionInvalidRange', { index: index + 1 }))
    }
  })

  const groupedPositions = new Map<number, Array<{ since: string, until: string | null }>>()
  for (const position of form.value.positions) {
    if (!position.position_id || !position.since) continue
    const bucket = groupedPositions.get(position.position_id) ?? []
    bucket.push({ since: position.since, until: position.until || null })
    groupedPositions.set(position.position_id, bucket)
  }

  for (const [positionId, assignments] of groupedPositions.entries()) {
    const sortedAssignments = assignments
      .slice()
      .sort((left, right) => {
        if (left.since !== right.since) return left.since.localeCompare(right.since)
        return (left.until || '9999-12-31').localeCompare(right.until || '9999-12-31')
      })

    for (let index = 1; index < sortedAssignments.length; index += 1) {
      const previous = sortedAssignments[index - 1]!
      const current = sortedAssignments[index]!
      const previousUntil = previous.until || '9999-12-31'
      const currentUntil = current.until || '9999-12-31'
      if (!(previous.since <= currentUntil && current.since <= previousUntil)) continue

      const label = positions.value.find(position => position.id === positionId)
      errors.push(t('member.required.positionOverlap', {
        position: label ? `${label.code} - ${label.name}` : `#${positionId}`,
      }))
      break
    }
  }

  return errors
})

const saveDisabled = computed(() => Boolean(props.disabled) || Boolean(props.saving) || validationErrors.value.length > 0)

onMounted(() => {
  loadSupportData()
})

useAppRefresh().onRefresh(loadSupportData)

async function loadSupportData() {
  await Promise.all([
    loadSubjects(),
    loadPositions(),
    canManageSubdivisions.value ? loadSubdivisions() : Promise.resolve(),
  ])
}

watch(
  () => form.value.subject_name,
  (newValue) => {
    subjectQuery.value = newValue || ''
  },
  { immediate: true },
)

async function loadSubjects() {
  const res = await $fetch<{ ok: boolean, subjects?: SubjectRow[] }>('/api/subjects')
  if (res.ok && res.subjects) subjects.value = res.subjects
}

async function loadPositions() {
  const res = await $fetch<{ ok: boolean, positions?: PositionRow[] }>('/api/positions')
  if (res.ok && res.positions) {
    positions.value = res.positions
  }
}

async function loadSubdivisions() {
  const res = await $fetch('/api/subdivisions/options')
  if (res.ok) {
    subdivisions.value = res.subdivisions
  }
}

async function createSubjectFromQuery() {
  if (!canEditSubjects.value) return
  const name = subjectQuery.value.trim()
  if (!name) return

  const res = await $fetch<{ ok: boolean, id?: number }>('/api/subjects/create', {
    method: 'POST',
    body: { name },
  })

  if (!res.ok) return

  form.value.subject_name = name
  subjectQuery.value = name
  await loadSubjects()
}

function onSubjectSelect(value: unknown) {
  const name = value as string
  form.value.subject_name = name
  subjectQuery.value = name
}

function startRenameSubject() {
  if (!selectedSubject.value) return
  renameSubjectValue.value = selectedSubject.value.name
  renamingSubject.value = true
}

function cancelRenameSubject() {
  renamingSubject.value = false
  renameSubjectValue.value = ''
}

async function confirmRenameSubject() {
  const subject = selectedSubject.value
  if (!subject || renamingSubjectSaving.value) return

  const name = renameSubjectValue.value.trim()
  if (!name) return

  if (name === subject.name) {
    cancelRenameSubject()
    return
  }

  renamingSubjectSaving.value = true
  try {
    const res = await $fetch<{ ok: boolean, error?: string }>(`/api/subjects/${subject.id}`, {
      method: 'PUT',
      body: { name },
    })

    if (!res.ok) return

    subject.name = name
    form.value.subject_name = name
    subjectQuery.value = name
    renamingSubject.value = false
  } finally {
    renamingSubjectSaving.value = false
  }
}

function selectSubdivision(value: unknown) {
  const subdivisionId = Number(value)
  if (!Number.isInteger(subdivisionId) || subdivisionId <= 0) return

  const currentIds = form.value.subdivision_ids ?? []
  if (currentIds.includes(subdivisionId)) return

  form.value.subdivision_ids = [...currentIds, subdivisionId]
  subdivisionQuery.value = ''
}

function removeSubdivision(value: string | number) {
  const subdivisionId = Number(value)
  form.value.subdivision_ids = (form.value.subdivision_ids ?? []).filter(id => id !== subdivisionId)
}

function addPosition() {
  form.value.positions.push({
    position_id: 0,
    since: '',
    until: null,
    _rowKey: createPositionRowKey(),
  } as MemberPositionAssignment & { _rowKey: string })
}

function removePosition(index: number) {
  const assignment = form.value.positions[index]
  if (!assignment) return
  const rowKey = positionRowKey(assignment)
  form.value.positions.splice(index, 1)
  delete positionQueries.value[rowKey]
}

function selectedPositionLabel(index: number) {
  const positionId = Number(form.value.positions[index]?.position_id)
  if (!positionId) return ''
  const selected = positionsById.value.get(positionId)
  return selected ? formatPositionLabel(selected) : ''
}

function selectPosition(index: number, position: PositionRow) {
  const assignment = form.value.positions[index]
  if (!assignment) return
  assignment.position_id = position.id
  positionQueries.value[positionRowKey(assignment)] = formatPositionLabel(position)
}

function selectPositionFromOption(index: number, value: unknown) {
  selectPosition(index, value as PositionRow)
}

function clearPosition(index: number) {
  const assignment = form.value.positions[index]
  if (!assignment) return
  assignment.position_id = 0
  positionQueries.value[positionRowKey(assignment)] = ''
}

function formatPositionLabel(position: PositionRow) {
  const baseLabel = `${position.code} - ${position.name}`
  return position.is_active ? baseLabel : `${baseLabel} (${t('common.inactive')})`
}

function formatSubdivisionLabel(subdivision: SubdivisionOption) {
  const baseLabel = `${subdivision.code} - ${subdivision.name}`
  return subdivision.is_active ? baseLabel : `${baseLabel} (${t('common.inactive')})`
}

function isAssignedPositionInactive(index: number) {
  const positionId = Number(form.value.positions[index]?.position_id)
  if (!positionId) return false
  const selected = positionsById.value.get(positionId)
  return selected ? !Boolean(selected.is_active) : false
}

function createPositionRowKey() {
  nextPositionRowKey += 1
  return `position-row-${nextPositionRowKey}`
}

function positionRowKey(assignment: MemberPositionAssignment) {
  const row = assignment as MemberPositionAssignment & { _rowKey?: string }
  if (!row._rowKey) row._rowKey = row.id ? `position-row-saved-${row.id}` : createPositionRowKey()
  return row._rowKey
}

function positionQueryFor(assignment: MemberPositionAssignment) {
  return positionQueries.value[positionRowKey(assignment)] || ''
}

function setPositionQuery(assignment: MemberPositionAssignment, value: string) {
  positionQueries.value[positionRowKey(assignment)] = value
}

function statusLabel(status: MemberStatus) {
  if (status === MemberStatus.Active) return t('member.states.active')
  if (status === MemberStatus.Passive) return t('member.states.passive')
  if (status === MemberStatus.Hold) return t('member.states.hold')
  return t('member.states.left')
}

function selectStatus(status: MemberStatus) {
  form.value.status = status
  openStatus.value = null
}

function normalizeUsernamePart(value: string | null | undefined) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replaceAll('\u00E4', 'ae')
    .replaceAll('\u00F6', 'oe')
    .replaceAll('\u00FC', 'ue')
    .replaceAll('\u00DF', 'ss')
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9.-]/g, '')
}

function buildDefaultAccountUsername(firstName: string | null | undefined, lastName: string | null | undefined) {
  const first = normalizeUsernamePart(firstName)
  const last = normalizeUsernamePart(lastName)

  if (first && last) return `${first}.${last}`
  return first || last || ''
}

watch(
  [positions, () => form.value.positions],
  () => {
    form.value.positions.forEach((assignment) => {
      if (!assignment.position_id) return

      const selected = positions.value.find(position => Number(position.id) === Number(assignment.position_id))
      if (!selected) return

      positionQueries.value[positionRowKey(assignment)] = formatPositionLabel(selected)
    })
  },
  { immediate: true, deep: true },
)

watch(
  () => [form.value.first_name, form.value.last_name, form.value.new_account] as const,
  ([firstName, lastName, newAccount]) => {
    if (!newAccount || usernameManuallyEdited.value) return
    newAccount.username = buildDefaultAccountUsername(firstName, lastName)
  },
  { immediate: true },
)
</script>
