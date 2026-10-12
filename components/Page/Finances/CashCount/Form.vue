<template>
  <div class="space-y-6">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-4">
      <h2 class="text-lg font-semibold">{{ t('cashCount.countData') }}</h2>

      <label class="flex items-center gap-2 text-sm font-medium text-base-700 cursor-pointer">
        <input v-model="isRegisterCheck" type="checkbox" class="checkbox" :disabled="disabled">
        {{ t('cashCount.registerCheck') }}
      </label>

      <div v-if="!isRegisterCheck">
        <label class="text-sm font-medium text-base-600">{{ t('cashCount.event') }}</label>
        <CommonSearchSelect
          v-model="eventQuery"
          :options="eventOptions"
          :selected-label="selectedEventLabel(form.event_id || 0)"
          :placeholder="t('cashCount.eventPlaceholder')"
          :empty-text="t('cashCount.noMatchingEvents')"
          :disabled="disabled"
          @select="onEventSelect"
          @clear-selection="form.event_id = 0"
        />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="text-sm font-medium text-base-600">{{ t('cashCount.countedByFirst') }}</label>
          <CommonSearchSelect
            v-model="countedByFirstQuery"
            :options="memberOptions"
            :selected-label="selectedMemberLabel(form.counted_by_first)"
            :placeholder="t('cashCount.memberSearch')"
            :empty-text="t('reimbursement.noMatchingMembers')"
            :disabled="disabled"
            @select="onCountedByFirstSelect"
            @clear-selection="form.counted_by_first = 0"
          />
        </div>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('cashCount.countedBySecond') }}</label>
          <CommonSearchSelect
            v-model="countedBySecondQuery"
            :options="memberOptions"
            :selected-label="selectedMemberLabel(form.counted_by_second)"
            :placeholder="t('cashCount.memberSearch')"
            :empty-text="t('reimbursement.noMatchingMembers')"
            :disabled="disabled"
            @select="onCountedBySecondSelect"
            @clear-selection="form.counted_by_second = 0"
          />
        </div>

        <div class="md:col-span-2">
          <label class="text-sm font-medium text-base-600">{{ t('cashCount.checkedBy') }}</label>
          <CommonSearchSelect
            v-model="checkedByQuery"
            :options="memberOptions"
            :selected-label="selectedMemberLabel(form.checked_by)"
            :placeholder="t('cashCount.memberSearch')"
            :empty-text="t('reimbursement.noMatchingMembers')"
            :disabled="disabled"
            @select="onCheckedBySelect"
            @clear-selection="form.checked_by = 0"
          />
        </div>

        <div v-if="!isRegisterCheck">
          <label class="text-sm font-medium text-base-600">{{ t('cashCount.countedBeforeAt') }}</label>
          <CommonDateInput
            v-model="countedBeforeAtInput"
            mode="datetime"
            :disabled="disabled"
          />
        </div>

        <div :class="isRegisterCheck ? 'md:col-span-2' : ''">
          <label class="text-sm font-medium text-base-600">{{ isRegisterCheck ? t('cashCount.countedAt') : t('cashCount.countedAfterAt') }}</label>
          <CommonDateInput
            v-model="countedAfterAtInput"
            mode="datetime"
            :disabled="disabled"
          />
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <div class="flex items-center justify-between gap-4">
        <h3 class="font-semibold">{{ t('cashCount.positions') }}</h3>
        <button
          v-if="!disabled"
          type="button"
          class="flex items-center gap-2 text-accent-500 font-medium cursor-pointer"
          @click="addPosition"
        >
          <span class="text-xl">+</span> {{ t('actions.addPosition') }}
        </button>
      </div>

      <div
        class="hidden 2xl:grid gap-3 text-sm font-medium text-base-500"
        :class="!disabled && form.positions.length > 1
          ? positionGridWithActionsClass
          : positionGridClass"
      >
        <div>{{ t('cashCount.register') }}</div>
        <div v-if="!isRegisterCheck">{{ t('cashCount.amountBefore') }}</div>
        <div>{{ isRegisterCheck ? t('cashCount.amount') : t('cashCount.amountAfter') }}</div>
        <div v-if="!isRegisterCheck">{{ t('cashCount.difference') }}</div>
        <div>{{ t('cashCount.notes') }}</div>
        <div v-if="!disabled && form.positions.length > 1" />
      </div>

      <div
        v-for="(position, index) in form.positions"
        :key="position.id || index"
        class="rounded-xl border border-base-200 bg-base-50 p-3"
      >
        <div
          class="grid grid-cols-1 gap-3 items-start md:grid-cols-8"
          :class="!disabled && form.positions.length > 1
            ? positionGridWithActionsClass
            : positionGridClass"
        >
          <div class="field md:col-span-2 2xl:col-span-1">
            <label class="2xl:hidden">{{ t('cashCount.register') }}</label>
            <input
              :value="displayRegisterNumber(position.register_number)"
              type="text"
              class="input text-center font-semibold"
              inputmode="numeric"
              :disabled="disabled"
              @input="onRegisterNumberInput($event, index)"
              @blur="onRegisterNumberBlur(index)"
            >
          </div>

          <div v-if="!isRegisterCheck" class="field md:col-span-2 2xl:col-span-1">
            <label class="2xl:hidden">{{ t('cashCount.amountBefore') }}</label>
            <input
              type="text"
              class="input text-right"
              :value="displayAmount(index, 'amount_before')"
              inputmode="decimal"
              :disabled="disabled"
              @focus="onAmountFocus($event, index, 'amount_before')"
              @blur="onAmountBlur(index, 'amount_before')"
              @input="onAmountInput($event, index, 'amount_before')"
            >
          </div>

          <div class="field md:col-span-2 2xl:col-span-1">
            <label class="2xl:hidden">{{ isRegisterCheck ? t('cashCount.amount') : t('cashCount.amountAfter') }}</label>
            <input
              type="text"
              class="input text-right"
              :value="displayAmount(index, 'amount_after')"
              inputmode="decimal"
              :disabled="disabled"
              @focus="onAmountFocus($event, index, 'amount_after')"
              @blur="onAmountBlur(index, 'amount_after')"
              @input="onAmountInput($event, index, 'amount_after')"
            >
          </div>

          <div v-if="!isRegisterCheck" class="field md:col-span-2 2xl:col-span-1">
            <label class="2xl:hidden">{{ t('cashCount.difference') }}</label>
            <div class="input bg-base-50 text-right font-medium">
              {{ formatCurrency(positionDifference(position)) }}
            </div>
          </div>

          <div
            class="field min-w-0"
            :class="!disabled && form.positions.length > 1
              ? notesWithActionsClass
              : notesClass"
          >
            <label class="2xl:hidden">{{ t('cashCount.notes') }}</label>
            <input
              v-model="position.notes"
              class="input"
              :disabled="disabled"
            >
          </div>

          <button
            v-if="!disabled && form.positions.length > 1"
            type="button"
            class="text-danger-500 cursor-pointer p-2 w-10 rounded-md hover:bg-white md:col-span-1 2xl:col-span-1 md:self-end"
            @click="removePosition(index)"
          >
            ✕
          </button>
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <h3 class="font-semibold">{{ t('cashCount.overview') }}</h3>

        <div
          class="grid gap-3 text-sm min-w-full"
          :class="isRegisterCheck ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3 lg:min-w-0 lg:w-auto'"
        >
          <div v-if="!isRegisterCheck" class="rounded-xl bg-base-100 px-4 py-3">
            <div class="text-base-500">{{ t('cashCount.totalBefore') }}</div>
            <div class="text-lg font-semibold">{{ formatCurrency(totalBefore) }}</div>
          </div>
          <div class="rounded-xl bg-base-100 px-4 py-3" :class="isRegisterCheck ? 'w-full' : ''">
            <div class="text-base-500">{{ isRegisterCheck ? t('cashCount.totalAmount') : t('cashCount.totalAfter') }}</div>
            <div class="text-lg font-semibold">{{ formatCurrency(totalAfter) }}</div>
          </div>
          <div v-if="!isRegisterCheck" class="rounded-xl bg-success-100 px-4 py-3">
            <div class="text-success-700">{{ t('cashCount.totalDifference') }}</div>
            <div class="text-lg font-semibold text-success-800">{{ formatCurrency(totalDifference) }}</div>
          </div>
        </div>
      </div>
    </section>

    <CommonFormActions
      :disabled="disabled"
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
import { useI18n } from '~/composables/useI18n'
import { focusAndSelectInput, sanitizeCurrencyInput } from '~/composables/useCurrencyInput'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { MemberListItem } from '~/types/member'
import type { CreateCashCountBody, CreateCashCountPositionBody } from '~/types/cashCount'
import type { EventRow } from '~/types/event'
import { normalizeLocalDateTime } from '~/shared/time'

type MemberField = 'counted_by_first' | 'counted_by_second' | 'checked_by'
type AmountField = 'amount_before' | 'amount_after'

const props = defineProps<{
  modelValue: CreateCashCountBody
  disabled?: boolean
  saving?: boolean
  hasFile?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: CreateCashCountBody): void
  (e: 'submit'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const { formatCurrency, formatDateTime } = useLocaleFormatters()

const form = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const disabled = computed(() => Boolean(props.disabled))
const isRegisterCheck = computed({
  get: () => form.value.event_id === null,
  set: (value: boolean) => {
    if (value) {
      form.value.event_id = null
      form.value.counted_before_at = null
      form.value.positions.forEach(position => {
        position.amount_before = position.amount_after
      })
      return
    }

    form.value.event_id = 0
    form.value.counted_before_at = ''
  },
})
const members = ref<MemberListItem[]>([])
const events = ref<EventRow[]>([])
const eventQuery = ref('')
const countedByFirstQuery = ref('')
const countedBySecondQuery = ref('')
const checkedByQuery = ref('')
const focusedAmountField = ref<{ index: number, field: AmountField } | null>(null)

const positionGridClass = computed(() => isRegisterCheck.value
  ? '2xl:grid-cols-[7rem_1fr_2fr]'
  : '2xl:grid-cols-[7rem_1fr_1fr_1fr_2fr]'
)
const positionGridWithActionsClass = computed(() => isRegisterCheck.value
  ? '2xl:grid-cols-[7rem_1fr_2fr_auto]'
  : '2xl:grid-cols-[7rem_1fr_1fr_1fr_2fr_auto]'
)
const notesClass = computed(() => isRegisterCheck.value ? 'md:col-span-8 2xl:col-span-1' : 'md:col-span-8 2xl:col-span-1')
const notesWithActionsClass = computed(() => isRegisterCheck.value ? 'md:col-span-7 2xl:col-span-1' : 'md:col-span-7 2xl:col-span-1')

const eventOptions = computed<SearchSelectOption<EventRow>[]>(() => events.value.map(event => ({
  key: event.id,
  label: eventLabel(event),
  searchText: [event.name, event.location].filter(Boolean).join(' '),
  value: event,
})))

const memberOptions = computed<SearchSelectOption<MemberListItem>[]>(() => members.value.map(member => ({
  key: member.id,
  label: memberLabel(member),
  value: member,
})))

const validationErrors = computed(() => {
  const errors: string[] = []

  if (!isRegisterCheck.value && !form.value.event_id) errors.push(t('cashCount.required.event'))
  if (!form.value.counted_by_first) errors.push(t('cashCount.required.countedByFirst'))
  if (!form.value.counted_by_second) errors.push(t('cashCount.required.countedBySecond'))
  if (!form.value.checked_by) errors.push(t('cashCount.required.checkedBy'))
  if (!isRegisterCheck.value && !form.value.counted_before_at) errors.push(t('cashCount.required.countedBeforeAt'))
  if (!form.value.counted_after_at) {
    errors.push(isRegisterCheck.value ? t('cashCount.required.countedAt') : t('cashCount.required.countedAfterAt'))
  }
  if (!isRegisterCheck.value && form.value.counted_before_at && form.value.counted_after_at && !hasValidDateOrder()) {
    errors.push(t('cashCount.required.order'))
  }
  if (!Array.isArray(form.value.positions) || form.value.positions.length === 0) errors.push(t('cashCount.required.positions'))
  if (form.value.positions.some(position => !hasValidRegisterNumber(position.register_number))) {
    errors.push(t('cashCount.required.registerNumber'))
  }
  if (hasDuplicateRegisterNumbers()) {
    errors.push(t('cashCount.required.uniqueRegister'))
  }
  if (form.value.positions.some(position => (!isRegisterCheck.value && !hasValidAmount(position.amount_before)) || !hasValidAmount(position.amount_after))) {
    errors.push(isRegisterCheck.value ? t('cashCount.required.completeRegisterCheckPosition') : t('cashCount.required.completePosition'))
  }
  if (!props.hasFile) {
    errors.push(isRegisterCheck.value ? t('cashCount.required.registerCheckFile') : t('cashCount.required.file'))
  }

  return errors
})

const saveDisabled = computed(() => disabled.value || Boolean(props.saving) || validationErrors.value.length > 0)
const countedBeforeAtInput = computed({
  get: () => form.value.counted_before_at || '',
  set: (value: string | null) => {
    form.value.counted_before_at = value || ''
  },
})
const countedAfterAtInput = computed({
  get: () => form.value.counted_after_at,
  set: (value: string | null) => {
    form.value.counted_after_at = value || ''
  },
})

const totalBefore = computed(() => form.value.positions.reduce((sum, position) => sum + Number(position.amount_before || 0), 0))
const totalAfter = computed(() => form.value.positions.reduce((sum, position) => sum + Number(position.amount_after || 0), 0))
const totalDifference = computed(() => totalAfter.value - totalBefore.value)

function hasValidAmount(value: unknown) {
  return Number.isFinite(Number(value))
}

function hasValidRegisterNumber(value: unknown) {
  const registerNumber = Number(value)
  return Number.isInteger(registerNumber) && registerNumber > 0
}

function hasDuplicateRegisterNumbers() {
  const registerNumbers = form.value.positions.map(position => Number(position.register_number))
  return new Set(registerNumbers).size !== registerNumbers.length
}

function hasValidDateOrder() {
  if (!form.value.counted_before_at) return true
  const before = normalizeLocalDateTime(form.value.counted_before_at)
  const after = normalizeLocalDateTime(form.value.counted_after_at)
  return Boolean(before && after && after > before)
}

function memberLabel(member: MemberListItem) {
  return `${member.first_name} ${member.last_name}`
}

function eventLabel(event: EventRow) {
  const startsAt = formatDateTime(event.starts_at)
  return [event.name, startsAt, event.location].filter(Boolean).join(' | ')
}

function selectedEventLabel(eventId: number) {
  const event = events.value.find(entry => entry.id === eventId)
  return event ? eventLabel(event) : ''
}

function selectedMemberLabel(memberId: number) {
  const member = members.value.find(entry => entry.id === memberId)
  return member ? memberLabel(member) : ''
}

function onEventSelect(value: unknown) {
  const event = value as EventRow
  form.value.event_id = event.id
  eventQuery.value = eventLabel(event)
}

function selectMember(field: MemberField, member: MemberListItem) {
  if (field === 'counted_by_first') {
    form.value.counted_by_first = member.id
    countedByFirstQuery.value = memberLabel(member)
    return
  }

  if (field === 'counted_by_second') {
    form.value.counted_by_second = member.id
    countedBySecondQuery.value = memberLabel(member)
    return
  }

  form.value.checked_by = member.id
  checkedByQuery.value = memberLabel(member)
}

function onCountedByFirstSelect(value: unknown) {
  selectMember('counted_by_first', value as MemberListItem)
}

function onCountedBySecondSelect(value: unknown) {
  selectMember('counted_by_second', value as MemberListItem)
}

function onCheckedBySelect(value: unknown) {
  selectMember('checked_by', value as MemberListItem)
}

async function loadMembers() {
  const res = await $fetch('/api/members', { method: 'GET' })
  if (res.ok) members.value = res.members
}

async function loadEvents() {
  const res = await $fetch('/api/cash_counts/event-options', { method: 'GET' })
  if (res.ok) events.value = res.events
}

async function loadSupportData() {
  await Promise.all([loadEvents(), loadMembers()])
}

function addPosition() {
  form.value.positions.push({
    register_number: nextRegisterNumber(),
    amount_before: 0,
    amount_after: 0,
    notes: null,
  })
}

function removePosition(index: number) {
  form.value.positions.splice(index, 1)
  if (focusedAmountField.value?.index === index) focusedAmountField.value = null
  if (focusedAmountField.value && focusedAmountField.value.index > index) {
    focusedAmountField.value = {
      ...focusedAmountField.value,
      index: focusedAmountField.value.index - 1,
    }
  }
}

function positionDifference(position: CreateCashCountPositionBody) {
  return Number(position.amount_after || 0) - Number(position.amount_before || 0)
}

function nextRegisterNumber() {
  const usedNumbers = new Set(
    form.value.positions
      .map(position => Number(position.register_number))
      .filter(registerNumber => Number.isInteger(registerNumber) && registerNumber > 0)
  )

  let candidate = 1
  while (usedNumbers.has(candidate)) candidate += 1
  return candidate
}

function displayRegisterNumber(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function onRegisterNumberInput(event: Event, index: number) {
  const position = form.value.positions[index]
  if (!position) return

  const value = (event.target as HTMLInputElement).value.replace(/[^\d]/g, '')
  position.register_number = value ? Number(value) : 0
  ;(event.target as HTMLInputElement).value = value
}

function onRegisterNumberBlur(index: number) {
  const position = form.value.positions[index]
  if (!position) return

  position.register_number = hasValidRegisterNumber(position.register_number)
    ? Number(position.register_number)
    : nextRegisterNumber()
}

function isAmountFocused(index: number, field: AmountField) {
  return focusedAmountField.value?.index === index && focusedAmountField.value?.field === field
}

function displayAmount(index: number, field: AmountField) {
  const position = form.value.positions[index]
  if (!position) return ''

  const value = position[field]
  if (isAmountFocused(index, field)) return value !== null && value !== undefined ? String(value) : ''
  if (value === null || value === undefined) return ''

  return formatCurrency(Number(value))
}

function onAmountFocus(event: FocusEvent, index: number, field: AmountField) {
  focusedAmountField.value = { index, field }
  focusAndSelectInput(event)
}

function onAmountInput(event: Event, index: number, field: AmountField) {
  const value = sanitizeCurrencyInput((event.target as HTMLInputElement).value)
  const parsed = parseFloat(value)
  const position = form.value.positions[index]
  if (!position) return

  position[field] = Number.isNaN(parsed) ? 0 : parsed
  if (isRegisterCheck.value) position.amount_before = position.amount_after
  ;(event.target as HTMLInputElement).value = value
}

function onAmountBlur(index: number, field: AmountField) {
  if (isAmountFocused(index, field)) focusedAmountField.value = null

  const position = form.value.positions[index]
  if (!position) return

  const value = position[field]
  if (value !== null && value !== undefined) {
    position[field] = Number(Number(value).toFixed(2))
  }
  if (isRegisterCheck.value) position.amount_before = position.amount_after
}

watch([members, () => form.value.counted_by_first, () => form.value.counted_by_second, () => form.value.checked_by], () => {
  countedByFirstQuery.value = selectedMemberLabel(Number(form.value.counted_by_first || 0))
  countedBySecondQuery.value = selectedMemberLabel(Number(form.value.counted_by_second || 0))
  checkedByQuery.value = selectedMemberLabel(Number(form.value.checked_by || 0))
}, { immediate: true })

watch([events, () => form.value.event_id], () => {
  eventQuery.value = selectedEventLabel(Number(form.value.event_id || 0))
}, { immediate: true })

onMounted(() => {
  if (!form.value.positions.length) addPosition()
  loadSupportData()
})

useAppRefresh().onRefresh(loadSupportData)
</script>
