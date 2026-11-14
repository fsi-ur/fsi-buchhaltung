<template>
  <CommonModal
    :model-value="modelValue"
    :title="t('subdivisionLeadership.members.addTitle', { subdivision: subdivision.name })"
    width-class="max-w-xl"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <p class="text-sm text-base-600">{{ t('subdivisionLeadership.members.addHelp') }}</p>

    <CommonSearchSelect
      v-model="query"
      :options="options"
      :placeholder="t('subdivisionLeadership.members.searchCandidate')"
      :empty-text="loading ? t('subdivisionLeadership.loading') : t('subdivisionLeadership.members.noCandidates')"
      @select="selected = $event as LeadershipCandidate"
      @clear-selection="selected = null"
    />

    <dl v-if="selected" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-base-200 bg-base-50 p-3 text-sm">
      <dt class="text-base-500">{{ t('common.name') }}</dt>
      <dd class="font-medium text-base-900">{{ selected.full_name }}</dd>
      <dt class="text-base-500">{{ t('subdivisionLeadership.members.subject') }}</dt>
      <dd>{{ selected.subject_name || t('common.notAvailable') }}</dd>
      <dt class="text-base-500">{{ t('subdivisionLeadership.members.email') }}</dt>
      <dd class="break-all">{{ selected.email || t('common.notAvailable') }}</dd>
      <dt class="text-base-500">{{ t('subdivisionLeadership.members.phone') }}</dt>
      <dd>{{ selected.phone || t('common.notAvailable') }}</dd>
    </dl>

    <template #footer>
      <button type="button" class="btn-secondary" @click="$emit('update:modelValue', false)">{{ t('actions.cancel') }}</button>
      <button type="button" class="btn-primary" :disabled="!selected || saving" @click="save">
        {{ t('subdivisionLeadership.members.add') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { GetLeadershipCandidatesResponse } from '~/server/api/subdivision-leadership/candidates.get'
import type { LeadershipCandidate, LeadershipSubdivision } from '~/types/subdivisionLeadership'

const props = defineProps<{
  modelValue: boolean
  subdivision: LeadershipSubdivision
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'saved'): void
}>()

const { t } = useI18n()
const toast = useToast()

const candidates = ref<LeadershipCandidate[]>([])
const loading = ref(true)
const saving = ref(false)
const query = ref('')
const selected = ref<LeadershipCandidate | null>(null)

const options = computed<SearchSelectOption<LeadershipCandidate>[]>(() => candidates.value.map(candidate => ({
  key: candidate.id,
  label: candidate.subject_name ? `${candidate.full_name} · ${candidate.subject_name}` : candidate.full_name,
  value: candidate,
  searchText: [candidate.full_name, candidate.subject_name, candidate.email, candidate.phone].filter(Boolean).join(' '),
})))

async function loadCandidates() {
  loading.value = true
  try {
    const res = await apiFetch<GetLeadershipCandidatesResponse>('/api/subdivision-leadership/candidates', {
      query: { subdivisionId: props.subdivision.id },
    })
    if (res.ok) candidates.value = res.members
    else toast.error(t('subdivisionLeadership.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!selected.value || saving.value) return
  saving.value = true
  try {
    const res = await apiFetch<{ ok: boolean, error?: string }>('/api/subdivision-leadership/add-member', {
      method: 'POST',
      body: { subdivision_id: props.subdivision.id, member_id: selected.value.id },
    })
    if (!res.ok) {
      toast.error(res.error || t('subdivisionLeadership.saveFailed'))
      return
    }
    toast.success(t('subdivisionLeadership.members.added', { member: selected.value.full_name }))
    emit('saved')
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}

onMounted(loadCandidates)
</script>
