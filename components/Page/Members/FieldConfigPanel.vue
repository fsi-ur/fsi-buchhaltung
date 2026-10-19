<template>
  <div class="space-y-6">
    <CommonCard
      v-if="canConfigure"
      :title="t('member.fieldConfig.title')"
      :description="t('member.fieldConfig.intro')"
    >
      <template #actions>
        <PageAuditTableHistoryButton :tables="['member_self_edit_field_config']" />
      </template>

      <div v-if="loadingConfig" class="flex items-center justify-center p-6 text-base-400">
        <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" />
      </div>

      <div v-else class="divide-y divide-base-100">
        <div
          v-for="field in SELF_EDIT_ELIGIBLE_FIELDS"
          :key="field"
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <span class="text-sm font-medium text-base-700">{{ fieldLabel(field) }}</span>

          <div class="flex gap-2">
            <button
              v-for="mode in SELF_EDIT_FIELD_MODES"
              :key="mode"
              type="button"
              class="rounded-md border px-3 py-1.5 text-xs font-medium cursor-pointer transition"
              :class="config[field] === mode
                ? 'border-accent-500 bg-accent-50 text-accent-600'
                : 'border-base-200 text-base-600 hover:bg-base-50'"
              @click="setMode(field, mode)"
            >
              {{ modeLabel(mode) }}
            </button>
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          class="btn-primary"
          :class="{ 'opacity-50 cursor-not-allowed': savingConfig }"
          :disabled="savingConfig"
          @click="saveConfig"
        >
          {{ t('member.fieldConfig.save') }}
        </button>
      </div>
    </CommonCard>

    <CommonCard v-if="canApprove" :title="t('member.fieldConfig.pendingChangesTitle')">
      <template #actions>
        <PageAuditTableHistoryButton :tables="['member_pending_field_changes']" />
      </template>

      <div v-if="loadingPending" class="flex items-center justify-center p-6 text-base-400">
        <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" />
      </div>

      <p v-else-if="!pendingChanges.length" class="text-sm text-base-500">
        {{ t('member.fieldConfig.pendingChangesNone') }}
      </p>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs font-medium uppercase text-base-400">
              <th class="pb-2 pr-3">{{ t('member.fieldConfig.pendingChangesMember') }}</th>
              <th class="pb-2 pr-3">{{ t('member.fieldConfig.pendingChangesField') }}</th>
              <th class="pb-2 pr-3">{{ t('member.fieldConfig.pendingChangesOld') }}</th>
              <th class="pb-2 pr-3">{{ t('member.fieldConfig.pendingChangesNew') }}</th>
              <th class="pb-2 pr-3">{{ t('member.fieldConfig.pendingChangesRequestedAt') }}</th>
              <th class="pb-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-base-100">
            <tr v-for="change in pendingChanges" :key="change.id">
              <td class="py-2 pr-3">{{ change.member_name }}</td>
              <td class="py-2 pr-3">{{ fieldLabel(change.field_name) }}</td>
              <td class="py-2 pr-3 text-base-500">{{ resolveDisplayValue(change.field_name, change.old_value) }}</td>
              <td class="py-2 pr-3 font-medium text-base-900">{{ resolveDisplayValue(change.field_name, change.new_value) }}</td>
              <td class="py-2 pr-3 text-base-500">{{ formatDateTime(change.requested_at) }}</td>
              <td class="py-2">
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="rounded-md border border-success-200 px-2.5 py-1 text-xs font-medium text-success-600 hover:bg-success-50 cursor-pointer"
                    @click="resolveChange(change.id, 'approve')"
                  >
                    {{ t('member.fieldConfig.approve') }}
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-danger-200 px-2.5 py-1 text-xs font-medium text-danger-500 hover:bg-danger-50 cursor-pointer"
                    @click="resolveChange(change.id, 'reject')"
                  >
                    {{ t('member.fieldConfig.reject') }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </CommonCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useAuth } from '~/composables/useAuth'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { SELF_EDIT_ELIGIBLE_FIELDS, SELF_EDIT_FIELD_MODES, type SelfEditFieldMode, type SelfEditFieldName } from '~/config/memberSelfEdit'
import type { GetMemberFieldConfigResponse } from '~/server/api/members/field-config/index.get'
import type { GetPendingChangesResponse, PendingFieldChangeDto } from '~/server/api/members/pending-changes/index.get'
import type { SubjectRow } from '~/types/subject'

const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()
const { formatDate, formatDateTime } = useLocaleFormatters()

const canConfigure = computed(() => hasPermission('members.configureSelfEditFields'))
const canApprove = computed(() => hasPermission('members.approveChanges'))

const loadingConfig = ref(true)
const savingConfig = ref(false)
const loadingPending = ref(true)
const config = ref<Record<SelfEditFieldName, SelfEditFieldMode>>(
  Object.fromEntries(SELF_EDIT_ELIGIBLE_FIELDS.map(field => [field, 'locked'])) as Record<SelfEditFieldName, SelfEditFieldMode>,
)
const pendingChanges = ref<PendingFieldChangeDto[]>([])
const subjects = ref<SubjectRow[]>([])

const fieldLabelKeys: Record<SelfEditFieldName, string> = {
  first_name: 'member.firstName',
  last_name: 'member.lastName',
  birthdate: 'member.birthdate',
  phone: 'member.phone',
  email: 'member.email',
  street: 'member.street',
  street_number: 'member.streetNumber',
  postal_code: 'member.postalCode',
  city: 'member.city',
  subject: 'member.subject',
}

const modeLabelKeys: Record<SelfEditFieldMode, string> = {
  locked: 'member.fieldConfig.modeLocked',
  direct: 'member.fieldConfig.modeDirect',
  approval: 'member.fieldConfig.modeApproval',
}

function fieldLabel(field: SelfEditFieldName) {
  return t(fieldLabelKeys[field])
}

function modeLabel(mode: SelfEditFieldMode) {
  return t(modeLabelKeys[mode])
}

const subjectsById = computed(() => new Map(subjects.value.map(subject => [subject.id, subject])))

function resolveDisplayValue(field: SelfEditFieldName, value: string | null) {
  if (value === null) return ''
  if (field === 'subject') return subjectsById.value.get(Number(value))?.name || `#${value}`
  if (field === 'birthdate') return formatDate(value)
  return value
}

function setMode(field: SelfEditFieldName, mode: SelfEditFieldMode) {
  config.value = { ...config.value, [field]: mode }
}

onMounted(async () => {
  await Promise.all([
    canConfigure.value ? loadConfig() : Promise.resolve(),
    canApprove.value ? loadPendingChanges() : Promise.resolve(),
  ])
})

async function loadConfig() {
  loadingConfig.value = true
  try {
    const res = await apiFetch<GetMemberFieldConfigResponse>('/api/members/field-config')
    if (res.ok) config.value = res.config
  } finally {
    loadingConfig.value = false
  }
}

async function loadPendingChanges() {
  loadingPending.value = true
  try {
    const [res, subjectsRes] = await Promise.all([
      apiFetch<GetPendingChangesResponse>('/api/members/pending-changes'),
      apiFetch<{ ok: boolean, subjects?: SubjectRow[] }>('/api/members/self/subjects'),
    ])
    if (res.ok) pendingChanges.value = res.changes
    if (subjectsRes.ok && subjectsRes.subjects) subjects.value = subjectsRes.subjects
  } finally {
    loadingPending.value = false
  }
}

async function saveConfig() {
  if (savingConfig.value) return
  savingConfig.value = true
  try {
    const body = SELF_EDIT_ELIGIBLE_FIELDS.map(field => ({ field_name: field, mode: config.value[field] }))
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/members/field-config/update', {
      method: 'POST',
      body,
    })

    if (!res.ok) {
      toast.error(res.error || t('member.fieldConfig.saveError'))
      return
    }

    toast.success(t('member.fieldConfig.saveSuccess'))
  } catch {
    toast.error(t('member.fieldConfig.saveError'))
  } finally {
    savingConfig.value = false
  }
}

async function resolveChange(id: number, action: 'approve' | 'reject') {
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>(`/api/members/pending-changes/${id}`, {
      method: 'POST',
      body: { action },
    })

    if (!res.ok) {
      toast.error(res.error || t('member.fieldConfig.actionError'))
      return
    }

    toast.success(t(action === 'approve' ? 'member.fieldConfig.approveSuccess' : 'member.fieldConfig.rejectSuccess'))
    await loadPendingChanges()
  } catch {
    toast.error(t('member.fieldConfig.actionError'))
  }
}
</script>
