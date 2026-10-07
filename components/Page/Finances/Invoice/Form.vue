<template>
  <div class="space-y-6">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-4">
      <div class="field">
        <label>{{ t('invoice.sourceType') }}</label>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="rounded-lg border px-3 py-2 text-sm transition"
            :class="[
              form.source_type === InvoiceSourceType.Upload ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-base-200',
              disabled ? 'opacity-70' : '',
            ]"
            :disabled="disabled"
            @click="setSourceType(InvoiceSourceType.Upload)"
          >
            {{ t('invoice.sources.upload') }}
          </button>
          <button
            type="button"
            class="rounded-lg border px-3 py-2 text-sm transition"
            :class="[
              form.source_type === InvoiceSourceType.Generated ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-base-200',
              disabled ? 'opacity-70' : '',
            ]"
            :disabled="disabled"
            @click="setSourceType(InvoiceSourceType.Generated)"
          >
            {{ t('invoice.sources.generated') }}
          </button>
        </div>
      </div>

      <div class="grid gap-4" :class="form.status === InvoiceStatus.Paid ? 'md:grid-cols-2' : ''">
        <div class="field">
          <label>{{ t('invoice.paymentStatus') }}</label>
          <PageFinancesPaymentStatus
            v-model="form.status"
            i18n-key-prefix="invoice"
            :disabled="statusDisabled"
            :allowed-targets="statusTargets"
            class="h-10"
          />
        </div>
        <div v-if="form.status === InvoiceStatus.Paid" class="field">
          <label>{{ t('invoice.paidAt') }}</label>
          <CommonDateInput
            v-model="form.paid_at"
            :disabled="paidAtDisabled"
            :empty-value="null"
          />
        </div>
      </div>

      <div class="field">
        <label>{{ t('invoice.company') }}</label>
        <CommonSearchSelect
          v-model="companyQuery"
          :options="companyOptions"
          :selected-label="selectedCompany?.name || ''"
          :placeholder="t('invoice.companyPlaceholder')"
          :empty-text="t('invoice.noCompanies')"
          :disabled="disabled"
          :allow-create="canEditCompany"
          :create-action-label="t('actions.createNew')"
          @select="onCompanySelect"
          @create="createCompanyFromQuery"
          @clear-selection="clearSelectedCompany"
        >
          <template #after-trigger>
            <button
              v-if="selectedCompany && canEditCompany"
              type="button"
              class="p-2 h-10 w-10 rounded-md hover:bg-base-100 text-accent-500 cursor-pointer"
              :title="t('invoice.editCompany')"
              @click.stop.prevent="openCompanyDrawer"
            >
              <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
            </button>
          </template>
        </CommonSearchSelect>
      </div>
      <div v-if="!isUpload" class="field">
        <label>{{ t('invoice.recipientAttention') }}</label>
        <input v-model="form.recipient_attention" class="input" :placeholder="t('invoice.recipientAttentionPlaceholder')" :disabled="disabled">
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="field">
        <label>{{ t('invoice.invoiceNumber') }}</label>
        <input v-model="form.invoice_number" class="input" :placeholder="invoiceNumberPlaceholder" :disabled="invoiceNumberDisabled">
      </div>
      <div v-if="!isUpload" class="field">
        <label>{{ t('invoice.subject') }}</label>
        <input v-model="form.subject" class="input" :placeholder="subjectPlaceholder" :disabled="disabled">
      </div>
      <div class="field">
        <label>{{ t('invoice.invoiceDate') }}</label>
        <CommonDateInput v-model="form.invoice_date" :disabled="disabled" />
      </div>
      <div class="field">
        <label>{{ t('invoice.serviceDate') }}</label>
        <CommonDateInput v-model="form.service_date" :disabled="disabled" :empty-value="null" />
      </div>
      <div class="field">
        <label>{{ t('invoice.dueDate') }}</label>
        <CommonDateInput v-model="form.due_date" :disabled="disabled" />
      </div>
      <div v-if="!isUpload" class="field">
        <label>{{ t('invoice.contactPerson') }}</label>
        <input v-model="form.contact_person" class="input" :disabled="disabled">
      </div>
    </section>

    <section v-if="!isUpload" class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <div class="field">
        <label>{{ t('invoice.introText') }}</label>
        <textarea
          v-model="form.intro_text"
          rows="3"
          class="input resize-y"
          :placeholder="introTextPlaceholder"
          :disabled="disabled"
        />
      </div>

      <div class="field">
        <label>{{ t('invoice.notes') }}</label>
        <textarea
          v-model="form.notes"
          rows="4"
          class="input resize-y"
          :placeholder="notesPlaceholder"
          :disabled="disabled"
        />
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">{{ t('invoice.positions') }}</h3>
        <button v-if="!disabled" type="button" class="text-accent-500 font-medium cursor-pointer" @click="addPosition">
          + {{ t('actions.addPosition') }}
        </button>
      </div>

      <div
        v-for="(position, index) in form.positions"
        :key="position.id ?? index"
        class="rounded-xl border border-base-200 bg-base-50 p-3 space-y-3"
      >
        <div class="grid grid-cols-1 md:grid-cols-[1.1fr_2fr] gap-3">
          <div class="field">
            <label>{{ t('invoice.positionName') }}</label>
            <input v-model="position.name" class="input" :disabled="disabled">
          </div>
          <div class="field">
            <label>{{ t('invoice.positionDescription') }}</label>
            <textarea
              v-model="position.description"
              :ref="element => setDescriptionRef(element, index)"
              rows="1"
              class="input min-h-9.5 overflow-hidden resize-none"
              maxlength="255"
              :disabled="disabled"
              @input="autoResizeDescription($event)"
            />
          </div>
        </div>

        <div
          class="grid grid-cols-1 gap-3 items-end"
          :class="!disabled && form.positions.length > 1
            ? 'md:grid-cols-[repeat(8,minmax(0,1fr))_auto] 2xl:grid-cols-[1.2fr_1.4fr_0.8fr_0.8fr_0.9fr_0.8fr_auto]'
            : 'md:grid-cols-12 2xl:grid-cols-[1.2fr_1.4fr_0.8fr_0.8fr_0.9fr_0.8fr]'"
        >
          <div
            class="field min-w-0 2xl:col-span-1"
            :class="!disabled && form.positions.length > 1 ? 'md:col-span-4' : 'md:col-span-6'"
          >
            <label>{{ t('invoice.sphere') }}</label>
            <MenuDropdown v-model="openSphereIndex" :id="index" :disabled="disabled" class="min-w-0">
              <template #trigger="{ styling }">
                <button :class="[styling, !disabled ? 'cursor-pointer' : '']" :disabled="disabled">
                  <span class="flex-1 overflow-hidden whitespace-nowrap text-ellipsis">{{ selectedSphereLabel(index) || t('invoice.spherePlaceholder') }}</span>
                  <Icon v-if="!disabled" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
                </button>
              </template>

              <template #default="{ styling }">
                <button
                  v-for="sphere in availableSpheres(index)"
                  :key="sphere.id"
                  :class="styling"
                  @click="selectSphere(index, sphere)"
                >
                  {{ sphereOptionLabel(sphere) }}
                </button>
                <div v-if="availableSpheres(index).length === 0" class="px-3 py-2 text-sm text-base-500">
                  {{ t('invoice.noSpheres') }}
                </div>
              </template>
            </MenuDropdown>
          </div>
          <div
            class="field min-w-0 2xl:col-span-1"
            :class="!disabled && form.positions.length > 1 ? 'md:col-span-5' : 'md:col-span-6'"
          >
            <label>{{ t('invoice.costCentre') }}</label>
            <CommonSearchSelect
              v-model="costCentreQueries[index]"
              :options="costCentreOptionsFor(index)"
              :selected-label="selectedCostCentreLabel(index)"
              :placeholder="t('invoice.costCentrePlaceholder')"
              :empty-text="t('invoice.noCostCentres')"
              :disabled="disabled"
              menu-width="wide"
              option-class="overflow-hidden text-ellipsis"
              @select="selectCostCentre(index, $event)"
              @clear-selection="clearCostCentre(index)"
            />
          </div>
          <div
            class="field 2xl:col-span-1"
            :class="!disabled && form.positions.length > 1 ? 'md:col-span-2' : 'md:col-span-3'"
          >
            <label>{{ t('invoice.quantity') }}</label>
            <input
              type="text"
              class="input text-right"
              :value="displayDecimal(index, 'quantity')"
              inputmode="decimal"
              :disabled="disabled"
              @focus="onDecimalFocus($event, index, 'quantity')"
              @blur="onDecimalBlur(index, 'quantity')"
              @input="onDecimalInput($event, index, 'quantity')"
            >
          </div>
          <div
            class="field 2xl:col-span-1"
            :class="!disabled && form.positions.length > 1 ? 'md:col-span-2' : 'md:col-span-3'"
          >
            <label>{{ t('invoice.unit') }}</label>
            <input v-model="position.unit" class="input" :disabled="disabled">
          </div>
          <div
            class="field 2xl:col-span-1"
            :class="!disabled && form.positions.length > 1 ? 'md:col-span-2' : 'md:col-span-3'"
          >
            <label>{{ t('invoice.unitPrice') }}</label>
            <input
              type="text"
              class="input text-right"
              :value="displayDecimal(index, 'unit_price', true)"
              inputmode="decimal"
              :disabled="disabled"
              @focus="onDecimalFocus($event, index, 'unit_price')"
              @blur="onDecimalBlur(index, 'unit_price')"
              @input="onDecimalInput($event, index, 'unit_price')"
            >
          </div>
          <div
            class="field 2xl:col-span-1"
            :class="!disabled && form.positions.length > 1 ? 'md:col-span-2' : 'md:col-span-3'"
          >
            <label>{{ t('invoice.taxRate') }}</label>
            <input
              type="text"
              class="input text-right"
              :value="displayTax(index)"
              inputmode="decimal"
              :disabled="disabled"
              @focus="onDecimalFocus($event, index, 'tax')"
              @blur="onDecimalBlur(index, 'tax')"
              @input="onDecimalInput($event, index, 'tax')"
            >
          </div>
          <button
            v-if="!disabled && form.positions.length > 1"
            type="button"
            class="text-danger-500 cursor-pointer p-2 w-10 rounded-md hover:bg-base-100 md:col-span-1 2xl:col-span-1 md:self-end"
            @click="removePosition(index)"
          >
            ✕
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <label v-if="!isUpload" class="inline-flex items-center gap-3 text-sm text-base-700 select-none cursor-pointer">
          <input
            v-model="form.is_kleinunternehmer"
            type="checkbox"
            class="checkbox"
            :disabled="disabled"
          >
          <span>{{ t('invoice.kleinunternehmerregelung') }}</span>
        </label>
        <div v-else />

        <div class="md:ml-auto md:max-w-xs w-full space-y-1 text-sm">
          <div class="flex justify-between text-base-500">
            <span>{{ t('invoice.net') }}</span>
            <span>{{ formatCurrency(netTotal) }}</span>
          </div>
          <div v-for="(taxAmount, tax) in taxBreakdown" :key="tax" class="flex justify-between text-base-500">
            <span>{{ t('invoice.vat', { tax }) }}</span>
            <span>{{ formatCurrency(taxAmount) }}</span>
          </div>
          <div class="flex justify-between border-t pt-1 text-base font-semibold">
            <span>{{ t('invoice.total') }}</span>
            <span>{{ formatCurrency(grossTotal) }}</span>
          </div>
        </div>
      </div>
    </section>

    <CommonFormActions
      :disabled="Boolean(disabled) && statusDisabled"
      :save-disabled="Boolean(props.saving) || validationErrors.length > 0"
      :saving="Boolean(props.saving)"
      :saving-label="t('actions.saving')"
      :cancel-label="t('actions.cancel')"
      :submit-label="t('actions.save')"
      :close-label="t('actions.close')"
      :save-and-exit-label="t('actions.saveAndExit')"
      @cancel="emit('cancel')"
      @submit="emit('submit')"
      @submit-and-exit="emit('submitAndExit')"
    />

    <CommonValidationSummary :errors="validationErrors" :title="t('common.validationBlocked')" />
  </div>

  <teleport to="body">
    <transition name="fade">
      <div v-if="showCompanyDrawer" class="fixed inset-0 z-40 bg-black/40" @click="closeCompanyDrawer" />
    </transition>

    <transition name="slide-over">
      <aside
        v-if="showCompanyDrawer"
        class="fixed right-0 top-0 z-50 h-full w-105 bg-white shadow-xl overflow-y-auto"
        @click.stop
      >
        <div class="flex items-center justify-between px-6 py-4 border-b">
          <h2 class="text-lg font-semibold">{{ t('invoice.companyDrawer') }}</h2>
          <button class="text-base-400 hover:text-base-600 cursor-pointer" @click="closeCompanyDrawer">✕</button>
        </div>

        <div class="p-6">
          <CompanyForm
            v-if="selectedCompany"
            v-model="selectedCompany"
            @save="savedCompanyDrawer"
            @cancel="closeCompanyDrawer"
          />
        </div>
      </aside>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { focusAndSelectInput, sanitizeCurrencyInput } from '~/composables/useCurrencyInput'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { InvoiceTextSettings } from '~/types/appSettings'
import type { Company, CompanyRow } from '~/types/company'
import type { CostCentreRow } from '~/types/costCentre'
import { InvoiceSourceType, InvoiceStatus, type CreateInvoiceBody } from '~/types/invoice'
import type { SphereRow } from '~/types/sphere'
import { renderInvoiceNumberTemplate, renderInvoiceTextSettings } from '~/utils/invoiceTextTemplates'
import CompanyForm from '../CompanyForm.vue'

const props = defineProps<{
  modelValue: CreateInvoiceBody
  disabled?: boolean
  statusDisabled?: boolean
  statusTargets?: InvoiceStatus[]
  invoiceNumberOptional?: boolean
  hasFile?: boolean
  canEditCompany?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: CreateInvoiceBody): void
  (e: 'submit'): void
  (e: 'submitAndExit'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const { formatCurrency } = useLocaleFormatters()

const form = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const disabled = computed(() => Boolean(props.disabled))
const isUpload = computed(() => form.value.source_type === InvoiceSourceType.Upload)
const statusDisabled = computed(() => Boolean(props.statusDisabled))
const statusTargets = computed(() => props.statusTargets)
const canEditCompany = computed(() => props.canEditCompany === true)
const invoiceNumberDisabled = computed(() => disabled.value || invoiceTextSettings.value.invoice_number_manual_edit_disabled)
const paidAtDisabled = computed(() => {
  return (disabled.value && statusDisabled.value) || form.value.status !== InvoiceStatus.Paid
})
const companyQuery = ref('')
const companies = ref<CompanyRow[]>([])
const selectedCompany = ref<Company | null>(null)
const showCompanyDrawer = ref(false)
const spheres = ref<SphereRow[]>([])
const costCentres = ref<CostCentreRow[]>([])
const costCentreQueries = ref<Record<number, string>>({})
const openSphereIndex = ref<number | null>(null)
const descriptionRefs = ref<Record<number, HTMLTextAreaElement | null>>({})
const focusedField = ref<string | null>(null)
const invoiceTextSettings = ref<InvoiceTextSettings>({
  invoice_number_template: 'RE-{year}-{increment}',
  invoice_number_next_increment: 1,
  invoice_number_increment_digits: 1,
  invoice_number_manual_edit_disabled: false,
  subject: 'Rechnung {invoice_number}',
  intro_text: 'Für die vereinbarten Leistungen stellen wir Ihnen wie vereinbart den folgenden Betrag in Rechnung:',
  notes: 'Mit freundlichen Grüßen\n{contact_person}',
  is_kleinunternehmer_default: false,
})

const companyOptions = computed<SearchSelectOption<number>[]>(() => {
  const query = companyQuery.value.trim().toLowerCase()
  return companies.value
    .filter(company => !query || company.name.toLowerCase().includes(query))
    .map(company => ({
      key: company.id,
      value: company.id,
      label: company.name,
      searchText: [company.city, company.email].filter(Boolean).join(' '),
    }))
})

const validationErrors = computed(() => {
  const errors: string[] = []
  if (!form.value.company_id) errors.push(t('invoice.required.company'))
  if (!props.invoiceNumberOptional && !form.value.invoice_number.trim()) errors.push(t('invoice.required.invoiceNumber'))
  if (!form.value.invoice_date) errors.push(t('invoice.required.invoiceDate'))
  if (!form.value.due_date) errors.push(t('invoice.required.dueDate'))
  if (form.value.status === InvoiceStatus.Paid && !form.value.paid_at) errors.push(t('invoice.required.paidAt'))
  if (form.value.status !== InvoiceStatus.Paid && form.value.paid_at) errors.push(t('invoice.required.paidAtOnlyPaid'))
  if (form.value.source_type === InvoiceSourceType.Upload && !props.hasFile) errors.push(t('invoice.required.file'))
  if (!form.value.positions.length) errors.push(t('invoice.required.positions'))
  if (form.value.positions.some(position =>
    !position.name.trim()
    || !position.sphere
    || !position.cost_centre
    || position.quantity <= 0
    || position.unit_price < 0
    || position.tax < 0
  )) {
    errors.push(t('invoice.required.completePosition'))
  }
  return errors
})

watch(() => form.value.status, (status) => {
  if (status !== InvoiceStatus.Paid && form.value.paid_at) {
    form.value.paid_at = null
  }
})

const netTotal = computed(() => form.value.positions.reduce((sum, position) => sum + (position.quantity * position.unit_price), 0))
const taxBreakdown = computed<Record<string, number>>(() => {
  return form.value.positions.reduce<Record<string, number>>((acc, position) => {
    const key = position.tax.toFixed(2)
    acc[key] = (acc[key] || 0) + (position.quantity * position.unit_price * (position.tax / 100))
    return acc
  }, {})
})
const grossTotal = computed(() => netTotal.value + Object.values(taxBreakdown.value).reduce((sum, value) => sum + value, 0))
const invoiceNumberPlaceholder = computed(() => {
  const rendered = renderInvoiceNumberTemplate(
    invoiceTextSettings.value.invoice_number_template,
    form.value.invoice_date,
    invoiceTextSettings.value.invoice_number_next_increment,
    invoiceTextSettings.value.invoice_number_increment_digits,
  )
  if (!rendered) return ''
  return invoiceTextSettings.value.invoice_number_manual_edit_disabled ? rendered : `Standard: ${rendered}`
})
const renderedInvoiceTextDefaults = computed(() => {
  return renderInvoiceTextSettings(invoiceTextSettings.value, {
    invoice_number: form.value.invoice_number,
    contact_person: form.value.contact_person,
    recipient_attention: form.value.recipient_attention,
    invoice_date: form.value.invoice_date,
    service_date: form.value.service_date,
    due_date: form.value.due_date,
  })
})
const subjectPlaceholder = computed(() => `Standard: ${renderedInvoiceTextDefaults.value.subject}`)
const introTextPlaceholder = computed(() => `Standard:\n${renderedInvoiceTextDefaults.value.intro_text}`)
const notesPlaceholder = computed(() => `Standard:\n${renderedInvoiceTextDefaults.value.notes}`)

watch(
  () => form.value.company_id,
  (companyId) => {
    selectedCompany.value = companies.value.find(company => company.id === companyId) ?? null
    companyQuery.value = selectedCompany.value?.name ?? ''
  },
  { immediate: true },
)

watch([costCentres, () => form.value.positions], () => {
  form.value.positions.forEach((position, index) => {
    if (!position.cost_centre) return
    const costCentre = costCentres.value.find(entry => entry.id === position.cost_centre)
    if (costCentre) costCentreQueries.value[index] = costCentreOptionLabel(costCentre)
  })
}, { immediate: true, deep: true })

watch(
  () => form.value.positions.map(position => `${position.id ?? 'new'}:${position.description}`),
  async () => {
    await nextTick()
    resizeAllDescriptions()
  },
  { immediate: true },
)

onMounted(loadSupportData)

useAppRefresh().onRefresh(loadSupportData)

async function loadSupportData() {
  await Promise.all([loadCompanies(), loadSpheres(), loadCostCentres(), loadInvoiceTextSettings()])
}

async function loadCompanies() {
  const res = await $fetch<{ ok: boolean, companies?: CompanyRow[] }>('/api/companies')
  if (res.ok && res.companies) companies.value = res.companies
}

async function loadSpheres() {
  const res = await $fetch<{ ok: boolean, spheres?: SphereRow[] }>('/api/spheres')
  if (res.ok && res.spheres) spheres.value = res.spheres
}

async function loadCostCentres() {
  const res = await $fetch<{ ok: boolean, costCentres?: CostCentreRow[] }>('/api/cost_centres')
  if (res.ok && res.costCentres) costCentres.value = res.costCentres
}

async function loadInvoiceTextSettings() {
  const res = await $fetch<{ ok: boolean, settings?: InvoiceTextSettings }>('/api/settings/app/invoice-texts')
  if (res.ok && res.settings) invoiceTextSettings.value = res.settings
}

function addPosition() {
  form.value = {
    ...form.value,
    positions: [
      ...form.value.positions,
      { name: '', description: null, sphere: 0, cost_centre: 0, quantity: 1, unit: null, unit_price: 0, tax: form.value.is_kleinunternehmer ? 0 : 19 },
    ],
  }
}

function removePosition(index: number) {
  delete costCentreQueries.value[index]
  form.value = {
    ...form.value,
    positions: form.value.positions.filter((_, currentIndex) => currentIndex !== index),
  }
}

function setSourceType(sourceType: InvoiceSourceType) {
  if (disabled.value) return
  if (sourceType === InvoiceSourceType.Upload) {
    form.value = {
      ...form.value,
      source_type: sourceType,
      is_kleinunternehmer: false,
      contact_person: null,
      recipient_attention: null,
      subject: null,
      intro_text: null,
      notes: null,
    }
    return
  }
  form.value = { ...form.value, source_type: sourceType }
}

function onCompanySelect(companyId: unknown) {
  const normalizedCompanyId = typeof companyId === 'number' ? companyId : Number(companyId)
  if (!Number.isFinite(normalizedCompanyId)) {
    clearSelectedCompany()
    return
  }

  const company = companies.value.find(entry => entry.id === normalizedCompanyId) ?? null
  selectedCompany.value = company
  companyQuery.value = company?.name ?? ''
  form.value = { ...form.value, company_id: company?.id ?? null }
}

async function createCompanyFromQuery() {
  if (!canEditCompany.value || !companyQuery.value.trim()) return
  const res = await $fetch<{ ok: boolean, id?: number }>('/api/companies/create', {
    method: 'POST',
    body: {
      name: companyQuery.value.trim(),
      street: null,
      street_number: null,
      postal_code: null,
      city: null,
      country: null,
      iban: null,
      bic: null,
      bankname: null,
      vat_id: null,
      email: null,
      phone: null,
      notes: null,
    },
  })

  if (res.ok && res.id) {
    await loadCompanies()
    const company = companies.value.find(entry => entry.id === res.id)
    if (company) onCompanySelect(company.id)
  }
}

function clearSelectedCompany() {
  selectedCompany.value = null
  companyQuery.value = ''
  form.value = { ...form.value, company_id: null }
}

function selectSphere(index: number, sphere: SphereRow) {
  if (!form.value.positions[index]) return
  form.value.positions[index]!.sphere = sphere?.id ?? 0
  openSphereIndex.value = null
}

function availableSpheres(index: number) {
  const selectedSphereId = Number(form.value.positions[index]?.sphere || 0)
  return spheres.value.filter((sphere) => Boolean(sphere.is_active) || Number(sphere.id) === selectedSphereId)
}

function sphereOptionLabel(sphere: SphereRow) {
  return Boolean(sphere.is_active) ? sphere.name : `${sphere.name} (${t('common.inactive')})`
}

function selectedSphereLabel(index: number) {
  const sphereId = form.value.positions[index]?.sphere
  if (!sphereId) return ''
  const sphere = spheres.value.find(entry => entry.id === sphereId)
  return sphere ? sphereOptionLabel(sphere) : ''
}

function selectCostCentre(index: number, costCentreId: unknown) {
  const normalizedCostCentreId = typeof costCentreId === 'number' ? costCentreId : Number(costCentreId)
  if (!Number.isFinite(normalizedCostCentreId) || !form.value.positions[index]) return

  const costCentre = costCentres.value.find(entry => entry.id === normalizedCostCentreId)
  form.value.positions[index]!.cost_centre = costCentre?.id ?? 0
  costCentreQueries.value[index] = costCentre ? costCentreOptionLabel(costCentre) : ''
}

function clearCostCentre(index: number) {
  if (!form.value.positions[index]) return
  form.value.positions[index]!.cost_centre = 0
  costCentreQueries.value[index] = ''
}

function selectedCostCentreLabel(index: number) {
  const costCentreId = form.value.positions[index]?.cost_centre
  if (!costCentreId) return ''
  const costCentre = costCentres.value.find(entry => entry.id === costCentreId)
  return costCentre ? costCentreOptionLabel(costCentre) : ''
}

function availableCostCentres(index: number) {
  const selectedCostCentreId = Number(form.value.positions[index]?.cost_centre || 0)
  return costCentres.value.filter((costCentre) => Boolean(costCentre.is_active) || Number(costCentre.id) === selectedCostCentreId)
}

function costCentreOptionLabel(costCentre: CostCentreRow) {
  const baseLabel = `${costCentre.code} - ${costCentre.name}`
  return Boolean(costCentre.is_active) ? baseLabel : `${baseLabel} (${t('common.inactive')})`
}

function costCentreOptionsFor(index: number): SearchSelectOption<number>[] {
  return availableCostCentres(index).map(costCentre => ({
    key: costCentre.id,
    value: costCentre.id,
    label: costCentreOptionLabel(costCentre),
    searchText: `${costCentre.code} ${costCentre.name} ${costCentre.description || ''}`.trim(),
  }))
}

function autoResizeDescription(event: Event) {
  const target = event.target as HTMLTextAreaElement | null
  if (!target) return
  target.style.height = 'auto'
  target.style.height = `${target.scrollHeight}px`
}

function fieldFocusKey(index: number, field: 'quantity' | 'unit_price' | 'tax') {
  return `${index}:${field}`
}

function displayDecimal(index: number, field: 'quantity' | 'unit_price', asCurrency = false) {
  const value = form.value.positions[index]?.[field]
  if (value === null || value === undefined) return ''
  if (focusedField.value === fieldFocusKey(index, field)) return String(value)
  return asCurrency ? formatCurrency(value) : Number(value).toFixed(2).replace('.', ',')
}

function displayTax(index: number) {
  const value = form.value.positions[index]?.tax
  if (value === null || value === undefined) return ''
  if (focusedField.value === fieldFocusKey(index, 'tax')) return String(value)
  return `${Number(value).toFixed(2).replace('.', ',')} %`
}

function onDecimalFocus(event: FocusEvent, index: number, field: 'quantity' | 'unit_price' | 'tax') {
  focusedField.value = fieldFocusKey(index, field)
  focusAndSelectInput(event)
}

function onDecimalInput(event: Event, index: number, field: 'quantity' | 'unit_price' | 'tax') {
  const value = sanitizeCurrencyInput((event.target as HTMLInputElement).value)
  const parsed = parseFloat(value)
  if (!form.value.positions[index]) return
  form.value.positions[index]![field] = Number.isNaN(parsed) ? 0 : parsed
  ;(event.target as HTMLInputElement).value = value
}

function onDecimalBlur(index: number, field: 'quantity' | 'unit_price' | 'tax') {
  focusedField.value = null
  if (!form.value.positions[index]) return
  const value = form.value.positions[index]![field]
  if (value !== null && value !== undefined) {
    form.value.positions[index]![field] = Number(Number(value).toFixed(2))
  }
}

function setDescriptionRef(element: Element | ComponentPublicInstance | null, index: number) {
  descriptionRefs.value[index] = element instanceof HTMLTextAreaElement ? element : null
}

function resizeAllDescriptions() {
  Object.values(descriptionRefs.value).forEach((textarea) => {
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  })
}

function openCompanyDrawer() {
  if (!selectedCompany.value || !canEditCompany.value) return
  showCompanyDrawer.value = true
}

function closeCompanyDrawer() {
  showCompanyDrawer.value = false
}

async function savedCompanyDrawer() {
  await loadCompanies()
  if (form.value.company_id) {
    selectedCompany.value = companies.value.find(company => company.id === form.value.company_id) ?? selectedCompany.value
    companyQuery.value = selectedCompany.value?.name ?? ''
  }
  closeCompanyDrawer()
}
</script>
