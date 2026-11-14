<template>
  <CommonModal
    :model-value="modelValue"
    :title="assignment ? t('subdivisionLeadership.positions.editTitle') : t('subdivisionLeadership.positions.assignTitle')"
    width-class="max-w-xl"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="field">
      <label>{{ t('subdivisionLeadership.positions.member') }}</label>
      <MenuDropdown id="assignment-member" v-model="openDropdown" :disabled="Boolean(assignment)">
        <template #trigger="{ styling }">
          <button type="button" :class="[styling, assignment ? '' : 'cursor-pointer']" :disabled="Boolean(assignment)">
            <span class="truncate" :class="form.member_id ? '' : 'text-base-400'">
              {{ selectedMemberName || t('subdivisionLeadership.positions.memberPlaceholder') }}
            </span>
            <Icon v-if="!assignment" name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0 text-lg text-base-400" />
          </button>
        </template>
        <template #default="{ styling }">
          <button
            v-for="member in memberOptions"
            :key="member.id"
            type="button"
            :class="[styling, member.id === form.member_id ? 'font-medium text-link-600' : '']"
            @click="form.member_id = member.id; openDropdown = null"
          >
            {{ member.full_name }}
          </button>
        </template>
      </MenuDropdown>
    </div>

    <div class="field">
      <label>{{ t('subdivisionLeadership.positions.position') }}</label>
      <MenuDropdown id="assignment-position" v-model="openDropdown">
        <template #trigger="{ styling }">
          <button type="button" :class="[styling, 'cursor-pointer']">
            <span class="truncate" :class="form.position_id ? '' : 'text-base-400'">
              {{ selectedPositionName || t('subdivisionLeadership.positions.positionPlaceholder') }}
            </span>
            <Icon name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0 text-lg text-base-400" />
          </button>
        </template>
        <template #default="{ styling }">
          <button
            v-for="position in positionOptions"
            :key="position.id"
            type="button"
            :class="[styling, position.id === form.position_id ? 'font-medium text-link-600' : '']"
            @click="form.position_id = position.id; openDropdown = null"
          >
            {{ position.name }}
          </button>
        </template>
      </MenuDropdown>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div class="field">
        <label>{{ t('common.from') }}</label>
        <CommonDateInput v-model="form.since" />
      </div>
      <div class="field">
        <label>{{ t('common.to') }}</label>
        <CommonDateInput v-model="form.until" :empty-value="null" />
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn-secondary" @click="$emit('update:modelValue', false)">{{ t('actions.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="save">{{ t('actions.save') }}</button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type {
  LeadershipAssignment,
  LeadershipPositionOption,
  LeadershipSubdivision,
} from '~/types/subdivisionLeadership'

const props = defineProps<{
  modelValue: boolean
  subdivision: LeadershipSubdivision
  assignment: LeadershipAssignment | null
  assignablePositions: LeadershipPositionOption[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { today } = useAppTimeZone()

const saving = ref(false)
const openDropdown = ref<string | number | null>(null)
const form = ref({
  member_id: props.assignment?.member_id ?? 0,
  position_id: props.assignment?.position_id ?? 0,
  since: props.assignment?.since ?? today(),
  until: props.assignment?.until ?? null as string | null,
})

// Leaders cannot change their own positions, so they are not offered as a target.
const memberOptions = computed(() => props.subdivision.members.filter(member => !member.is_self || member.id === props.assignment?.member_id))

// An existing assignment keeps showing its position even if it has since been deactivated.
const positionOptions = computed(() => {
  const options = [...props.assignablePositions]
  if (props.assignment && !options.some(option => option.id === props.assignment!.position_id)) {
    options.push({ id: props.assignment.position_id, code: '', name: props.assignment.position_name })
  }
  return options
})

const selectedMemberName = computed(() => props.subdivision.members.find(member => member.id === form.value.member_id)?.full_name ?? '')
const selectedPositionName = computed(() => positionOptions.value.find(position => position.id === form.value.position_id)?.name ?? '')

async function save() {
  if (saving.value) return
  if (!form.value.member_id || !form.value.position_id || !form.value.since) {
    toast.error(t('subdivisionLeadership.positions.missingFields'))
    return
  }
  if (form.value.until && form.value.until < form.value.since) {
    toast.error(t('subdivisionLeadership.positions.invalidRange'))
    return
  }

  saving.value = true
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/subdivision-leadership/save-assignment', {
      method: 'POST',
      body: {
        subdivision_id: props.subdivision.id,
        id: props.assignment?.id ?? null,
        member_id: form.value.member_id,
        position_id: form.value.position_id,
        since: form.value.since,
        until: form.value.until || null,
      },
    })
    if (!res.ok) {
      toast.error(res.error || t('subdivisionLeadership.saveFailed'))
      return
    }
    toast.success(t('subdivisionLeadership.positions.saved'))
    emit('saved')
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}
</script>
