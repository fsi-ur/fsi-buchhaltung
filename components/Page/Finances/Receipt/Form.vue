<template>
  <div class="space-y-6">
    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-1">
      <h2 class="text-lg font-semibold">{{ t('receipt.issue') }}</h2>

      <label class="section-title">{{ t('receipt.company') }}</label>

      <CommonSearchSelect
        v-model="companyQuery"
        :options="companyOptions"
        :selected-label="selectedCompany?.name || ''"
        :placeholder="t('receipt.companyPlaceholder')"
        :empty-text="t('receipt.noCompanies')"
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
            :title="t('receipt.editCompany')"
            @click.stop.prevent="openCompanyDrawer"
          >
            <Icon name="material-symbols:edit-square-outline-rounded" class="text-xl" />
          </button>
        </template>
      </CommonSearchSelect>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 grid grid-cols-2 gap-4">
      <div>
        <label class="text-sm font-medium text-base-600">{{ t('receipt.receiptNumber') }}</label>
        <input v-model="form.receipt_number" class="input" :disabled="disabled">
      </div>

      <div>
        <label class="text-sm font-medium text-base-600">{{ t('receipt.receiptDate') }}</label>
        <CommonDateInput v-model="form.receipt_date" :disabled="disabled" />
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 space-y-3">
      <h3 class="font-semibold">{{ t('receipt.positions') }}</h3>

      <div
        v-for="(p, i) in form.positions"
        :key="i"
        class="grid gap-2 items-center"
        :class="form.positions.length > 1 ? 'grid-cols-[3fr_2fr_2fr_2fr_auto]' : 'grid-cols-[3fr_2fr_2fr_3fr]'"
      >
        <MenuDropdown v-model="openSphereIndex" :id="i" :disabled="disabled" class="min-w-0">
          <template #trigger="{ styling }">
            <button :class="[styling, !disabled ? 'cursor-pointer' : '']" :disabled="disabled">
              <span class="flex-1 overflow-hidden whitespace-nowrap text-ellipsis">{{ sphereLabel(i) }}</span>
              <Icon v-if="!disabled" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
            </button>
          </template>

          <template #default="{ styling }">
            <button
              v-for="s in availableSpheres(i)"
              :key="s.id"
              :class="styling"
              @click="selectSphere(i, s)"
            >
              {{ sphereOptionLabel(s) }}
            </button>
            <div v-if="availableSpheres(i).length === 0" class="px-3 py-2 text-sm text-base-500">
              {{ t('receipt.noSpheres') }}
            </div>
          </template>
        </MenuDropdown>

        <CommonSearchSelect
          v-model="costCentreQueries[i]"
          :options="costCentreOptionsFor(i)"
          :selected-label="selectedCostCentreLabel(i)"
          :placeholder="t('receipt.costCentrePlaceholder')"
          :empty-text="t('receipt.noCostCentres')"
          :disabled="disabled"
          menu-width="wide"
          option-class="overflow-hidden text-ellipsis"
          @select="selectCostCentreFromOption(i, $event)"
          @clear-selection="clearCostCentre(i)"
        />

        <MenuDropdown v-model="openTaxIndex" :id="i" :disabled="disabled">
          <template #trigger="{ styling }">
            <button :class="[styling, !disabled ? 'cursor-pointer' : '']" :disabled="disabled">
              <span>{{ taxLabel(i) }}</span>
              <Icon v-if="!disabled" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
            </button>
          </template>

          <template #default="{ styling }">
            <button :class="styling" @click="selectTax(i, 0)">0%</button>
            <button :class="styling" @click="selectTax(i, 7)">7%</button>
            <button :class="styling" @click="selectTax(i, 19)">19%</button>
          </template>
        </MenuDropdown>

        <input
          type="text"
          class="input text-right"
          :value="displayAmount(i)"
          inputmode="decimal"
          :disabled="disabled"
          @focus="onFocus($event, i)"
          @blur="onBlur(i)"
          @input="onInput($event, i)"
        >

        <button
          v-if="!disabled && form.positions.length > 1"
          class="text-danger-500 cursor-pointer p-2 w-10 rounded-md hover:bg-base-100"
          @click="removePosition(i)"
        >
          ✕
        </button>
      </div>

      <div class="flex pt-2 items-start gap-6" :class="disabled ? 'justify-end' : 'justify-between'">
        <button
          v-if="!disabled"
          type="button"
          class="flex items-center gap-2 text-accent-500 font-medium cursor-pointer"
          @click="addPosition"
        >
          <span class="text-xl">＋</span> {{ t('actions.addPosition') }}
        </button>

        <div class="text-sm text-right space-y-1 pt-2 min-w-55 w-48">
          <div class="flex justify-between text-base-500">
            <span>{{ t('receipt.net') }}</span>
            <span>{{ formatCurrency(netTotal) }}</span>
          </div>

          <div
            v-for="(v, tax) in taxBreakdown"
            :key="tax"
            class="flex justify-between text-base-500 space-y-0.5"
          >
            <span>{{ t('receipt.vat', { tax }) }}</span>
            <span>{{ formatCurrency(v.tax) }}</span>
          </div>

          <div class="flex justify-between font-semibold text-lg border-t pt-1">
            <span>{{ t('receipt.total') }}</span>
            <span>{{ formatCurrency(grossTotal) }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="-mx-6 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg p-4 flex items-center gap-4">
      <span class="font-medium">{{ t('receipt.paymentStatus') }}</span>
      <PageFinancesPaymentStatus v-model="form.status" :disabled="disabled || statusDisabled" />
    </section>

    <CommonFormActions
      :disabled="Boolean(disabled)"
      :save-disabled="saveDisabled"
      :saving="Boolean(props.saving)"
      :saving-label="t('actions.saving')"
      :cancel-label="t('actions.cancel')"
      :submit-label="t('actions.save')"
      :close-label="t('actions.close')"
      @cancel="emit('cancel')"
      @submit="submit"
    />

    <CommonValidationSummary :errors="validationErrors" :title="t('common.validationBlocked')" />
  </div>

  <teleport to="body">
    <transition name="fade">
      <div
        v-if="showCompanyDrawer"
        class="fixed inset-0 z-40 bg-black/40"
        @click="closeCompanyDrawer"
      />
    </transition>

    <transition name="slide-over">
      <aside
        v-if="showCompanyDrawer"
        class="fixed right-0 top-0 z-50 h-full w-105 bg-white shadow-xl overflow-y-auto"
        @click.stop
      >
        <div class="flex items-center justify-between px-6 py-4 border-b">
          <h2 class="text-lg font-semibold">{{ t('receipt.companyDrawer') }}</h2>
          <button @click="closeCompanyDrawer" class="text-base-400 hover:text-base-600 cursor-pointer">
            ✕
          </button>
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
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import { useI18n } from '~/composables/useI18n'
import { focusAndSelectInput, sanitizeCurrencyInput } from '~/composables/useCurrencyInput'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { CompanyRow, Company } from '~/types/company'
import { ReceiptStatus, type CreateReceiptBody } from '~/types/receipt'
import type { SphereRow } from '~/types/sphere'
import type { CostCentreRow } from '~/types/costCentre'
import CompanyForm from '../CompanyForm.vue'

const props = defineProps<{
  modelValue: CreateReceiptBody
  disabled?: boolean
  saving?: boolean
  statusDisabled?: boolean
  hasFile?: boolean
  canEditCompany?: boolean
  externalValidationErrors?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: CreateReceiptBody): void
  (e: 'submit'): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const { formatCurrency } = useLocaleFormatters()

const form = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})
const canEditCompany = computed(() => props.canEditCompany === true)
const disabled = computed(() => Boolean(props.disabled))
const statusDisabled = computed(() => Boolean(props.statusDisabled))

const validationErrors = computed(() => {
  const errors: string[] = []
  if (companyQuery.value.trim().length < 1) errors.push(t('receipt.required.company'))
  if (!form.value.receipt_date) errors.push(t('receipt.required.receiptDate'))
  if (!form.value.status) errors.push(t('receipt.required.status'))
  if (!Array.isArray(form.value.positions) || form.value.positions.length === 0) errors.push(t('receipt.required.positions'))
  if (form.value.positions.some(p => !p.sphere || !p.cost_centre || p.amount === null || p.amount === undefined)) {
    errors.push(t('receipt.required.completePosition'))
  }
  const requiresFile = form.value.status === ReceiptStatus.Open || form.value.status === ReceiptStatus.Paid
  if (requiresFile && !props.hasFile) errors.push(t('receipt.required.fileForStatus'))
  if (Array.isArray(props.externalValidationErrors)) {
    errors.push(...props.externalValidationErrors.filter(error => typeof error === 'string' && error.trim().length > 0))
  }
  return errors
})

const saveDisabled = computed(() => Boolean(props.disabled) || Boolean(props.saving) || validationErrors.value.length > 0)
const companies = ref<CompanyRow[]>([])
const companyQuery = ref('')
const selectedCompany = ref<Company | null>(null)
const companyOptions = computed<SearchSelectOption<CompanyRow>[]>(() => companies.value.map(company => ({
  key: company.id,
  label: company.name,
  value: company,
})))
const spheres = ref<SphereRow[]>([])
const openSphereIndex = ref<number | null>(null)
const costCentres = ref<CostCentreRow[]>([])
const costCentreQueries = ref<Record<number, string>>({})
const focusedIndex = ref<number | null>(null)
const openTaxIndex = ref<number | null>(null)
const showCompanyDrawer = ref(false)

async function loadSpheres() {
  const res = await apiFetch<ApiResponse<'/api/spheres'>>('/api/spheres', { method: 'GET' })
  if (res.ok) spheres.value = res.spheres
}

async function loadCostCentres() {
  const res = await apiFetch<ApiResponse<'/api/cost_centres'>>('/api/cost_centres', { method: 'GET' })
  if (res.ok) costCentres.value = res.costCentres
}

async function loadCompanies() {
  const res = await apiFetch<ApiResponse<'/api/companies'>>('/api/companies', { method: 'GET' })
  if (res.ok) companies.value = res.companies
}

async function loadSupportData() {
  await Promise.all([loadCompanies(), loadSpheres(), loadCostCentres()])
}

async function submit() {
  const newCompanyName = companyQuery.value.trim()
  if (!selectedCompany.value && newCompanyName.length > 0) await createCompanyFromQuery()
  emit('submit')
}

async function createCompanyFromQuery() {
  if (!canEditCompany.value) return
  const newCompanyName = companyQuery.value.trim()
  if (newCompanyName.length > 0) {
    const res = await apiFetch<ApiResponse<'/api/companies/create', 'post'>>('/api/companies/create', {
      method: 'POST',
      body: { name: newCompanyName },
    })
    if (res.ok) {
      selectedCompany.value = { id: res.id, name: newCompanyName }
      form.value.company_id = res.id
    }
  }
  await loadCompanies()
}

onMounted(loadSupportData)

useAppRefresh().onRefresh(loadSupportData)

watch([companies, () => form.value.company_id], () => {
  if (!form.value.company_id) return
  const company = companies.value.find(c => c.id === form.value.company_id)
  if (company) {
    selectedCompany.value = company
    companyQuery.value = company.name
  }
}, { immediate: true })

watch([costCentres, () => form.value.positions], () => {
  form.value.positions.forEach((p, index) => {
    if (!p.cost_centre) return
    const cc = costCentres.value.find(c => c.id === p.cost_centre)
    if (cc) costCentreQueries.value[index] = costCentreOptionLabel(cc)
  })
}, { immediate: true, deep: true })

function onCompanySelect(value: unknown) {
  selectCompany(value as Company)
}

function selectCompany(company: Company) {
  selectedCompany.value = company
  form.value.company_id = company.id
  companyQuery.value = company.name
}

function selectSphere(index: number, sphere: SphereRow) {
  form.value.positions[index]!.sphere = sphere.id
  openSphereIndex.value = null
}

function selectCostCentre(index: number, costCentre: CostCentreRow) {
  form.value.positions[index]!.cost_centre = costCentre.id
  costCentreQueries.value[index] = costCentreOptionLabel(costCentre)
}

function selectCostCentreFromOption(index: number, value: unknown) {
  selectCostCentre(index, value as CostCentreRow)
}

function clearCostCentre(index: number) {
  if (!form.value.positions[index]) return
  form.value.positions[index]!.cost_centre = 0
  costCentreQueries.value[index] = ''
}

function selectedCostCentreLabel(index: number) {
  const costCentreId = form.value.positions[index]?.cost_centre
  if (!costCentreId) return ''
  const costCentre = costCentres.value.find(c => c.id === costCentreId)
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

function costCentreOptionsFor(index: number): SearchSelectOption<CostCentreRow>[] {
  return availableCostCentres(index).map(costCentre => ({
    key: costCentre.id,
    label: costCentreOptionLabel(costCentre),
    value: costCentre,
    searchText: `${costCentre.code} ${costCentre.name}`,
  }))
}

function selectTax(index: number, tax: number) {
  form.value.positions[index]!.tax = tax
  openTaxIndex.value = null
}

function openCompanyDrawer() {
  if (!canEditCompany.value) return
  openSphereIndex.value = null
  openTaxIndex.value = null
  showCompanyDrawer.value = true
}

function closeCompanyDrawer() {
  showCompanyDrawer.value = false
}

async function savedCompanyDrawer() {
  await loadCompanies()
  if (selectedCompany.value) companyQuery.value = selectedCompany.value.name
  showCompanyDrawer.value = false
}

function clearSelectedCompany() {
  selectedCompany.value = null
  form.value.company_id = null
}

function addPosition() {
  form.value.positions.push({ sphere: 0, cost_centre: 0, amount: 0.0, tax: 19 })
}

function removePosition(i: number) {
  form.value.positions.splice(i, 1)
  delete costCentreQueries.value[i]
}

function availableSpheres(index: number) {
  const selectedSphereId = Number(form.value.positions[index]?.sphere || 0)
  return spheres.value.filter((sphere) => Boolean(sphere.is_active) || Number(sphere.id) === selectedSphereId)
}

function sphereOptionLabel(sphere: SphereRow) {
  return Boolean(sphere.is_active) ? sphere.name : `${sphere.name} (${t('common.inactive')})`
}

function sphereLabel(index: number) {
  const sphereId = form.value.positions[index]?.sphere
  if (!sphereId) return t('receipt.chooseSphere')
  const sphere = spheres.value?.find(s => s.id === sphereId)
  return sphere ? sphereOptionLabel(sphere) : t('receipt.chooseSphere')
}

function taxLabel(index: number) {
  const tax = form.value.positions[index]?.tax
  return `${tax}%`
}

function displayAmount(i: number) {
  const value = form.value.positions[i]?.amount ?? null
  if (focusedIndex.value === i) return value !== null ? String(value) : ''
  if (value === null) return ''
  return formatCurrency(value)
}

function onFocus(e: FocusEvent, i: number) {
  focusedIndex.value = i
  focusAndSelectInput(e)
}

function onInput(e: Event, i: number) {
  const value = sanitizeCurrencyInput((e.target as HTMLInputElement).value, { allowNegative: true })
  const parsed = parseFloat(value)
  if (!form.value.positions[i]) return
  form.value.positions[i].amount = Number.isNaN(parsed) ? 0 : parsed
  ;(e.target as HTMLInputElement).value = value
}

function onBlur(i: number) {
  focusedIndex.value = null
  if (!form.value.positions[i]) return
  const value = form.value.positions[i].amount
  if (value !== null && value !== undefined) {
    form.value.positions[i].amount = Number(value.toFixed(2))
  }
}

function nettoOf(p: { amount: number; tax: number }) {
  return p.amount / (1 + p.tax / 100)
}

const taxBreakdown = computed(() => {
  const map: Record<number, { tax: number }> = {}
  for (const p of form.value.positions) {
    if (!map[p.tax]) map[p.tax] = { tax: 0 }
    const entry = map[p.tax]
    const netto = nettoOf(p)
    if (!entry) return
    entry.tax += Number(p.amount - netto)
  }
  return map
})

const netTotal = computed(() => form.value.positions.reduce((s, p) => s + Number(p.amount) / (1 + (Number(p.tax) / 100)), 0))
const grossTotal = computed(() => form.value.positions.reduce((s, p) => s + Number(p.amount), 0))
</script>
<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-over-enter-active,
.slide-over-leave-active {
  transition: transform 0.25s ease;
}
.slide-over-enter-from,
.slide-over-leave-to {
  transform: translateX(100%);
}
</style>
