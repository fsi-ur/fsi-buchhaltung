<template>
  <div class="flex flex-col h-full">
    <div class="flex-1 overflow-y-auto space-y-6">
      <div v-if="form.id" class="flex justify-end">
        <PageAuditHistoryButton table="companies" :record-id="form.id" />
      </div>

      <section>
        <h3 class="section-title">{{ t('company.personalData') }}</h3>

        <div class="space-y-2">
          <div class="field">
            <label>{{ t('company.company') }}</label>
            <input v-model="form.name" class="input" required />
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div class="field col-span-2">
              <label>{{ t('company.street') }}</label>
              <input v-model="form.street" class="input" />
            </div>

            <div class="field">
              <label>{{ t('company.streetNumber') }}</label>
              <input v-model="form.street_number" class="input" />
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div class="field">
              <label>{{ t('company.postalCode') }}</label>
              <input v-model="form.postal_code" class="input" />
            </div>

            <div class="field col-span-2">
              <label>{{ t('company.city') }}</label>
              <input v-model="form.city" class="input" />
            </div>
          </div>

          <div class="field">
            <label>{{ t('company.country') }}</label>
            <input v-model="form.country" class="input" />
          </div>
        </div>
      </section>

      <section>
        <h3 class="section-title">{{ t('company.contactData') }}</h3>

        <div class="grid grid-cols-2 gap-3">
          <div class="field">
            <label>{{ t('member.email') }}</label>
            <input v-model="form.email" class="input" />
          </div>

          <div class="field">
            <label>{{ t('member.phone') }}</label>
            <input v-model="form.phone" class="input" />
          </div>
        </div>
      </section>

      <section>
        <h3 class="section-title">{{ t('reimbursement.bankDetails') }}</h3>

        <div class="space-y-2">
          <div class="grid grid-cols-2 gap-3">
            <div class="field">
              <label>{{ t('reimbursement.iban') }}</label>
              <input v-model="form.iban" class="input" />
            </div>

            <div class="field">
              <label>{{ t('reimbursement.bic') }}</label>
              <input v-model="form.bic" class="input" />
            </div>
          </div>

          <div class="field">
            <label>{{ t('reimbursement.bankname') }}</label>
            <input v-model="form.bankname" class="input" />
          </div>
        </div>
      </section>

      <section>
        <h3 class="section-title">{{ t('company.taxData') }}</h3>

        <div class="field">
          <label>{{ t('company.vatId') }}</label>
          <input v-model="form.vat_id" class="input" />
        </div>
      </section>

      <section>
        <h3 class="section-title">{{ t('company.notes') }}</h3>

        <textarea
          v-model="form.notes"
          rows="3"
          class="input resize-none"
        />
      </section>
    </div>

    <div class="pt-4 flex justify-end gap-3 bg-white">
      <button
        type="button"
        @click="$emit('cancel')"
        class="btn-secondary"
      >
        {{ t('actions.cancel') }}
      </button>

      <button
        type="button"
        @click="save"
        class="btn-primary"
        :disabled="isSaving"
        :class="{ 'opacity-50 cursor-not-allowed': isSaving }"
      >
        {{ t('actions.save') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { Company, UpdateCompanyBody } from '~/types/company'

const props = defineProps<{
  modelValue: Company
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Company): void
  (e: 'save'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const isSaving = ref(false)

const form = reactive<UpdateCompanyBody>({
  id: props.modelValue.id,
  name: props.modelValue.name,
  street: props.modelValue.street ?? null,
  street_number: props.modelValue.street_number ?? null,
  postal_code: props.modelValue.postal_code ?? null,
  city: props.modelValue.city ?? null,
  country: props.modelValue.country ?? "Deutschland",
  iban: props.modelValue.iban ?? null,
  bic: props.modelValue.bic ?? null,
  bankname: props.modelValue.bankname ?? null,
  vat_id: props.modelValue.vat_id ?? null,
  email: props.modelValue.email ?? null,
  phone: props.modelValue.phone ?? null,
  notes: props.modelValue.notes ?? null
})

watch(
  () => props.modelValue,
  (v) => Object.assign(form, {
    ...v,
    country: v.country ?? form.country ?? "Deutschland"
  }),
  { immediate: true, deep: true }
)

function updateModelValueFromForm() {
  const updated: Partial<Company> = {}
  const keys = Object.keys(form) as (keyof UpdateCompanyBody)[]

  keys.forEach((key) => {
    const value = form[key]
    if (value !== null && value !== undefined) {
      updated[key as keyof Company] = value as any
    }
  })

  emit('update:modelValue', {
    ...props.modelValue,
    ...updated
  })
}

async function save() {
  if (isSaving.value) return

  isSaving.value = true
  try {
    const res = await apiFetch<ApiResponse<'/api/companies/:id', 'put'>>(`/api/companies/${form.id}`, {
      method: 'PUT',
      body: form
    })
    if (res.ok) updateModelValueFromForm()
    emit('save')
  } finally {
    isSaving.value = false
  }
}
</script>
