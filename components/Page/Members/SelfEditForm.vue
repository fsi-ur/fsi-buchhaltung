<template>
  <div class="space-y-6">
    <div v-if="loading" class="flex items-center justify-center p-10 text-base-400">
      <Icon name="material-symbols:progress-activity" class="animate-spin text-2xl" />
    </div>

    <div
      v-else-if="!fields"
      class="-mx-6 flex flex-col items-center gap-2 rounded-xl bg-white p-10 text-center text-base-400 shadow-sm sm:mx-0 sm:shadow-lg"
    >
      <Icon name="material-symbols:person-off-outline-rounded" class="text-3xl" />
      <p class="text-sm">{{ t('member.myData.notLinked') }}</p>
    </div>

    <template v-else>
      <p class="text-sm text-base-500">{{ t('member.myData.intro') }}</p>

      <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
        <h2 class="text-lg font-semibold">{{ t('member.masterData') }}</h2>

        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="text-sm font-medium text-base-600">{{ t('member.firstName') }}</label>
            <input v-model="form.first_name" class="input" :disabled="isFieldLocked('first_name')">
            <PageMembersSelfEditFieldHint :field="fields.first_name" />
          </div>

          <div>
            <label class="text-sm font-medium text-base-600">{{ t('member.lastName') }}</label>
            <input v-model="form.last_name" class="input" :disabled="isFieldLocked('last_name')">
            <PageMembersSelfEditFieldHint :field="fields.last_name" />
          </div>

          <div>
            <label class="text-sm font-medium text-base-600">{{ t('member.birthdate') }}</label>
            <CommonDateInput v-model="form.birthdate" :disabled="isFieldLocked('birthdate')" />
            <PageMembersSelfEditFieldHint :field="fields.birthdate" :resolve-value="formatDate" />
          </div>
        </div>
      </section>

      <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
        <h3 class="font-semibold">{{ t('member.contact') }}</h3>

        <div class="grid md:grid-cols-4 gap-4">
          <div class="md:col-span-3">
            <label class="text-sm font-medium text-base-600">{{ t('member.street') }}</label>
            <input v-model="form.street" class="input" :disabled="isFieldLocked('street')">
            <PageMembersSelfEditFieldHint :field="fields.street" />
          </div>

          <div>
            <label class="text-sm font-medium text-base-600">{{ t('member.streetNumber') }}</label>
            <input v-model="form.street_number" class="input" :disabled="isFieldLocked('street_number')">
            <PageMembersSelfEditFieldHint :field="fields.street_number" />
          </div>

          <div>
            <label class="text-sm font-medium text-base-600">{{ t('member.postalCode') }}</label>
            <input v-model="form.postal_code" class="input" :disabled="isFieldLocked('postal_code')">
            <PageMembersSelfEditFieldHint :field="fields.postal_code" />
          </div>

          <div class="md:col-span-3">
            <label class="text-sm font-medium text-base-600">{{ t('member.city') }}</label>
            <input v-model="form.city" class="input" :disabled="isFieldLocked('city')">
            <PageMembersSelfEditFieldHint :field="fields.city" />
          </div>

          <div class="md:col-span-2">
            <label class="text-sm font-medium text-base-600">{{ t('member.phone') }}</label>
            <input v-model="form.phone" class="input" :disabled="isFieldLocked('phone')">
            <PageMembersSelfEditFieldHint :field="fields.phone" />
          </div>

          <div class="md:col-span-2">
            <label class="text-sm font-medium text-base-600">{{ t('member.email') }}</label>
            <input v-model="form.email" type="email" class="input" :disabled="isFieldLocked('email')">
            <PageMembersSelfEditFieldHint :field="fields.email" />
          </div>
        </div>
      </section>

      <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
        <h3 class="font-semibold">{{ t('member.membership') }}</h3>

        <div>
          <label class="text-sm font-medium text-base-600">{{ t('member.subject') }}</label>
          <CommonSearchSelect
            v-model="subjectQuery"
            :options="subjectOptions"
            :selected-label="selectedSubjectName"
            :placeholder="t('member.subjectPlaceholder')"
            :empty-text="t('member.noSubjects')"
            :disabled="isFieldLocked('subject')"
            @select="onSubjectSelect"
            @clear-selection="form.subject = null"
          />
          <PageMembersSelfEditFieldHint :field="fields.subject" :resolve-value="resolveSubjectName" />
        </div>
      </section>

      <div v-if="hasEditableFields" class="flex justify-end">
        <button
          type="button"
          class="btn-primary"
          :class="{ 'opacity-50 cursor-not-allowed': saveDisabled }"
          :disabled="saveDisabled"
          @click="submit"
        >
          {{ t('actions.save') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { SubjectRow } from '~/types/subject'
import { SELF_EDIT_ELIGIBLE_FIELDS, type SelfEditFieldName } from '~/config/memberSelfEdit'
import type { GetMemberSelfResponse, SelfEditFieldState } from '~/server/api/members/self/index.get'
import type { UpdateMemberSelfResponse } from '~/server/api/members/self/update.post'

const { t } = useI18n()
const toast = useToast()
const { formatDate } = useLocaleFormatters()

const loading = ref(true)
const saving = ref(false)
const fields = ref<Record<SelfEditFieldName, SelfEditFieldState> | null>(null)
const subjects = ref<SubjectRow[]>([])
const subjectQuery = ref('')

const form = ref({
  first_name: '',
  last_name: '',
  birthdate: '',
  street: '',
  street_number: '',
  postal_code: '',
  city: '',
  phone: '',
  email: '',
  subject: null as number | null,
})

const subjectsById = computed(() => new Map(subjects.value.map(subject => [subject.id, subject])))
const subjectOptions = computed<SearchSelectOption<number>[]>(() => subjects.value.map(subject => ({
  key: subject.id,
  label: subject.name,
  value: subject.id,
})))
const selectedSubjectName = computed(() => {
  if (!form.value.subject) return ''
  return subjectsById.value.get(form.value.subject)?.name || ''
})

const hasEditableFields = computed(() => {
  if (!fields.value) return false
  return SELF_EDIT_ELIGIBLE_FIELDS.some(field => fields.value![field].mode !== 'locked')
})
const saveDisabled = computed(() => saving.value || !hasEditableFields.value)

function isFieldLocked(field: SelfEditFieldName) {
  return !fields.value || fields.value[field].mode === 'locked' || saving.value
}

function resolveSubjectName(value: string) {
  const subjectId = Number(value)
  return subjectsById.value.get(subjectId)?.name || `#${value}`
}

function onSubjectSelect(value: unknown) {
  form.value.subject = value as number
  subjectQuery.value = subjectsById.value.get(value as number)?.name || ''
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    const [selfRes, subjectsRes] = await Promise.all([
      apiFetch<GetMemberSelfResponse>('/api/members/self'),
      apiFetch<{ ok: boolean, subjects?: SubjectRow[] }>('/api/members/self/subjects'),
    ])

    if (subjectsRes.ok && subjectsRes.subjects) subjects.value = subjectsRes.subjects

    if (!selfRes.ok || !selfRes.member) {
      fields.value = null
      return
    }

    fields.value = selfRes.member.fields
    form.value = {
      first_name: selfRes.member.fields.first_name.value,
      last_name: selfRes.member.fields.last_name.value,
      birthdate: selfRes.member.fields.birthdate.value,
      street: selfRes.member.fields.street.value,
      street_number: selfRes.member.fields.street_number.value,
      postal_code: selfRes.member.fields.postal_code.value,
      city: selfRes.member.fields.city.value,
      phone: selfRes.member.fields.phone.value,
      email: selfRes.member.fields.email.value,
      subject: Number(selfRes.member.fields.subject.value),
    }
    subjectQuery.value = selectedSubjectName.value
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!fields.value || saving.value) return

  const patch: Partial<Record<SelfEditFieldName, unknown>> = {}
  for (const field of SELF_EDIT_ELIGIBLE_FIELDS) {
    if (fields.value[field].mode === 'locked') continue
    const currentValue = field === 'subject' ? String(form.value.subject ?? '') : form.value[field]
    if (currentValue === fields.value[field].value) continue
    patch[field] = field === 'subject' ? form.value.subject : currentValue
  }

  if (!Object.keys(patch).length) {
    toast.error(t('member.myData.noChanges'))
    return
  }

  saving.value = true
  try {
    const res = await apiFetch<UpdateMemberSelfResponse>('/api/members/self/update', {
      method: 'POST',
      body: patch,
    })

    if (!res.ok) {
      toast.error(res.error || t('member.myData.saveError'))
      return
    }

    if (res.pending.length && !res.applied.length) {
      toast.success(t('member.myData.saveSuccessApproval'))
    } else {
      toast.success(t('member.myData.saveSuccessDirect'))
    }

    await load()
  } catch {
    toast.error(t('member.myData.saveError'))
  } finally {
    saving.value = false
  }
}
</script>
