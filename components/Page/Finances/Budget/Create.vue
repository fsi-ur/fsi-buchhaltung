<template>
  <Page @open-menu="$emit('openMenu')">
    <template #cards>
      <section class="-mx-6 -mb-6 col-span-12 isolate bg-white shadow-sm sm:m-0 sm:rounded-xl sm:shadow-lg">
        <div ref="headerSentinelRef" class="h-px" />
        <div
          class="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 bg-base-900 px-4 py-3 text-white transition-[border-radius] sm:px-6"
          :class="isHeaderStuck ? '' : 'sm:rounded-t-xl'"
        >
          <div class="min-w-0">
            <h2 class="text-base font-semibold sm:text-lg">{{ t('budget.title') }}</h2>
            <p v-if="periodShortLabel" class="text-xs text-base-300">{{ periodShortLabel }}</p>
          </div>

          <div class="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <div class="hidden items-baseline gap-1.5 text-sm xl:flex">
              <span class="text-base-400">{{ t('budget.totalExpenses') }}</span>
              <span class="font-medium tabular-nums text-white">{{ formatCurrency(totalSummary.totalExpense) }}</span>
            </div>
            <div class="hidden items-baseline gap-1.5 text-sm xl:flex">
              <span class="text-base-400">{{ t('budget.totalIncome') }}</span>
              <span class="font-medium tabular-nums text-white">{{ formatCurrency(totalSummary.totalIncome) }}</span>
            </div>
            <div class="flex items-baseline gap-1.5 text-sm">
              <span class="text-base-400">{{ t('budget.totalSaldo') }}</span>
              <span class="font-semibold tabular-nums" :class="saldoTextClassOnDark(totalSummary.totalSaldo)">
                {{ formatCurrency(totalSummary.totalSaldo) }}
              </span>
            </div>

            <div class="flex flex-wrap justify-end gap-2">
              <button
                v-if="form.id"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-4 py-2 text-sm text-white transition cursor-pointer hover:bg-white/20"
                :class="isDownloadingPdf ? 'cursor-not-allowed opacity-70 hover:bg-white/10' : ''"
                :disabled="isSaving || isDownloadingPdf"
                @click="downloadPdf"
              >
                <Icon :name="isDownloadingPdf ? 'material-symbols:hourglass-top-rounded' : 'material-symbols:download-rounded'" class="h-4 w-4" aria-hidden="true" />
                {{ isDownloadingPdf ? t('budget.downloading') : t('budget.downloadPdf') }}
              </button>
              <button
                type="button"
                class="rounded-md px-3 py-2 text-sm text-base-300 transition cursor-pointer hover:text-white hover:underline"
                :disabled="isSaving"
                @click="cancel"
              >
                {{ t('actions.cancel') }}
              </button>
              <button
                v-if="canEdit"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-4 py-2 text-sm text-white transition cursor-pointer hover:bg-white/20"
                :class="isSaving ? 'cursor-not-allowed opacity-70 hover:bg-white/10' : ''"
                :disabled="isSaving || !hasValidPeriod"
                @click="saveBudget(false)"
              >
                {{ isSaving ? t('budget.saving') : t('actions.save') }}
              </button>
              <button
                v-if="canEdit"
                type="button"
                class="btn-primary"
                :class="isSaving ? 'cursor-not-allowed opacity-70' : ''"
                :disabled="isSaving || !hasValidPeriod"
                @click="saveBudget(true)"
              >
                {{ isSaving ? t('budget.saving') : t('actions.saveAndExit') }}
              </button>
            </div>
          </div>
        </div>

        <div class="space-y-6 p-4 sm:p-6">
          <div v-if="isLoadingBudget" class="rounded-xl border border-base-200 px-4 py-6 text-sm text-base-500">
            {{ t('budget.loading') }}
          </div>

          <template v-else>
            <p class="text-sm text-base-500">{{ t('budget.editorHint') }}</p>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div class="field">
                <label>{{ t('budget.year') }}</label>
                <select v-model="form.year" class="input" :disabled="!canEdit">
                  <option v-for="year in yearOptions" :key="year" :value="String(year)">
                    {{ year }}
                  </option>
                </select>
              </div>

              <div class="field">
                <label>{{ t('budget.semester') }}</label>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    :class="semesterButtonClass('summer')"
                    :disabled="!canEdit"
                    @click="form.semester = 'summer'"
                  >
                    {{ t('budget.semesters.summer') }}
                  </button>
                  <button
                    type="button"
                    :class="semesterButtonClass('winter')"
                    :disabled="!canEdit"
                    @click="form.semester = 'winter'"
                  >
                    {{ t('budget.semesters.winter') }}
                  </button>
                </div>
              </div>

              <div class="field">
                <label>{{ t('budget.startDate') }}</label>
                <input :value="periodBounds.startDate" type="date" class="input bg-base-50" disabled>
              </div>

              <div class="field">
                <label>{{ t('budget.endDate') }}</label>
                <input :value="periodBounds.endDate" type="date" class="input bg-base-50" disabled>
              </div>
            </div>

            <div class="field">
              <label>{{ t('budget.notes') }}</label>
              <textarea
                v-model="form.notes"
                :ref="setGeneralNotesRef"
                rows="1"
                class="input min-h-9 overflow-hidden resize-none"
                :disabled="!canEdit"
                :placeholder="t('budget.notesPlaceholder')"
                @input="autoResizeTextarea($event)"
              />
            </div>

            <div class="overflow-hidden rounded-xl border border-base-200">
              <div class="border-b border-base-200 px-4 py-3">
                <h3 class="font-semibold text-base-900">{{ t('budget.costCentreBudgets') }}</h3>
                <p class="text-sm text-base-500">{{ t('budget.structureHint') }}</p>
              </div>

              <div class="hidden gap-x-3 border-b border-base-200 bg-base-50 px-4 py-2 text-xs font-semibold text-base-600 md:grid md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_7.5rem]">
                <div>{{ t('budget.costCentre') }}</div>
                <div class="pr-2 text-right">{{ t('budget.expenses') }}</div>
                <div class="pr-2 text-right">{{ t('budget.income') }}</div>
                <div class="pr-2 text-right">{{ t('budget.saldo') }}</div>
              </div>

              <div>
                <div
                  v-for="costCentre in orderedCostCentres"
                  :key="costCentre.id"
                  class="border-b border-base-200 last:border-b-0"
                  :class="!costCentre.is_active ? 'bg-warning-50/60' : costCentre.hasChildren ? 'bg-base-50/50' : 'bg-white'"
                >
                  <div class="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_7.5rem] md:items-center md:py-2">
                    <div class="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1" :style="{ paddingLeft: `${costCentre.depth * 1.25}rem` }">
                      <span v-if="costCentre.depth > 0" class="shrink-0 text-base-300" aria-hidden="true">└</span>
                      <span
                        class="min-w-0 truncate text-sm text-base-900"
                        :class="costCentre.hasChildren ? 'font-semibold' : 'font-medium'"
                        :title="`${costCentre.code} - ${costCentre.name}`"
                      >
                        {{ costCentre.code }} - {{ costCentre.name }}
                      </span>
                      <span
                        v-if="!costCentre.is_active"
                        class="shrink-0 rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-800"
                        :title="t('budget.inactiveCostCentreNotice')"
                      >
                        {{ t('budget.inactiveShort') }}
                      </span>
                      <button
                        type="button"
                        class="ml-auto flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition"
                        :class="hasLineNote(costCentre.id) ? 'text-accent-600 hover:bg-accent-100' : 'text-base-400 hover:bg-base-200 hover:text-base-600'"
                        :title="t('budget.toggleNote')"
                        @click="toggleLineNotes(costCentre.id)"
                      >
                        <Icon name="material-symbols:edit-note-rounded" class="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>

                    <div class="space-y-1">
                      <label class="text-xs text-base-600 md:hidden">{{ t('budget.expenses') }}</label>
                      <input
                        :value="displayCurrencyField(costCentre.id, 'expense_amount')"
                        type="text"
                        class="input text-right"
                        inputmode="decimal"
                        :disabled="!canEdit"
                        @focus="onCurrencyFocus($event, costCentre.id, 'expense_amount')"
                        @blur="onCurrencyBlur(costCentre.id, 'expense_amount')"
                        @input="onCurrencyInput($event, costCentre.id, 'expense_amount')"
                      >
                    </div>

                    <div class="space-y-1">
                      <label class="text-xs text-base-600 md:hidden">{{ t('budget.income') }}</label>
                      <input
                        :value="displayCurrencyField(costCentre.id, 'income_amount')"
                        type="text"
                        class="input text-right"
                        inputmode="decimal"
                        :disabled="!canEdit"
                        @focus="onCurrencyFocus($event, costCentre.id, 'income_amount')"
                        @blur="onCurrencyBlur(costCentre.id, 'income_amount')"
                        @input="onCurrencyInput($event, costCentre.id, 'income_amount')"
                      >
                    </div>

                    <div class="col-span-2 flex items-center justify-between md:col-span-1 md:block md:pr-2 md:text-right">
                      <span class="text-xs text-base-600 md:hidden">{{ t('budget.saldo') }}</span>
                      <span class="text-sm font-medium tabular-nums" :class="saldoTextClass(summaryByCostCentre[costCentre.id]?.ownSaldo ?? 0)">
                        {{ formatCurrency(summaryByCostCentre[costCentre.id]?.ownSaldo ?? 0) }}
                      </span>
                    </div>
                  </div>

                  <div v-if="isLineNotesOpen(costCentre.id)" class="px-4 pb-3">
                    <textarea
                      v-model="ownLine(costCentre.id).notes"
                      :ref="element => setLineNotesRef(element, costCentre.id)"
                      rows="1"
                      class="input min-h-9 overflow-hidden resize-none"
                      :disabled="!canEdit"
                      :placeholder="t('budget.lineNotesPlaceholder')"
                      @input="autoResizeTextarea($event)"
                    />
                  </div>

                  <div
                    v-if="costCentre.hasChildren"
                    class="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-base-100 bg-base-100/70 px-4 py-2 text-xs text-base-600 md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_7.5rem] md:items-center"
                  >
                    <div class="col-span-2 md:col-span-1" :style="{ paddingLeft: `${costCentre.depth * 1.25}rem` }">
                      {{ t('budget.sumWithChildren') }}
                    </div>
                    <div class="flex items-baseline justify-between md:block md:pr-2 md:text-right">
                      <span class="md:hidden">{{ t('budget.expenses') }}</span>
                      <span class="tabular-nums">{{ formatCurrency(summaryByCostCentre[costCentre.id]?.totalExpense ?? 0) }}</span>
                    </div>
                    <div class="flex items-baseline justify-between md:block md:pr-2 md:text-right">
                      <span class="md:hidden">{{ t('budget.income') }}</span>
                      <span class="tabular-nums">{{ formatCurrency(summaryByCostCentre[costCentre.id]?.totalIncome ?? 0) }}</span>
                    </div>
                    <div class="col-span-2 flex items-baseline justify-between md:col-span-1 md:block md:pr-2 md:text-right">
                      <span class="md:hidden">{{ t('budget.saldo') }}</span>
                      <span class="font-medium tabular-nums" :class="saldoTextClass(summaryByCostCentre[costCentre.id]?.totalSaldo ?? 0)">
                        {{ formatCurrency(summaryByCostCentre[costCentre.id]?.totalSaldo ?? 0) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-x-3 gap-y-1 border-t-2 border-base-200 bg-base-50 px-4 py-3 text-sm font-semibold text-base-900 md:grid-cols-[minmax(0,1fr)_8.5rem_8.5rem_7.5rem] md:items-center">
                <div class="col-span-2 md:col-span-1">{{ t('budget.grandTotal') }}</div>
                <div class="flex items-baseline justify-between md:block md:pr-2 md:text-right">
                  <span class="font-normal text-base-500 md:hidden">{{ t('budget.expenses') }}</span>
                  <span class="tabular-nums">{{ formatCurrency(totalSummary.totalExpense) }}</span>
                </div>
                <div class="flex items-baseline justify-between md:block md:pr-2 md:text-right">
                  <span class="font-normal text-base-500 md:hidden">{{ t('budget.income') }}</span>
                  <span class="tabular-nums">{{ formatCurrency(totalSummary.totalIncome) }}</span>
                </div>
                <div class="col-span-2 flex items-baseline justify-between md:col-span-1 md:block md:pr-2 md:text-right">
                  <span class="font-normal text-base-500 md:hidden">{{ t('budget.saldo') }}</span>
                  <span class="tabular-nums" :class="saldoTextClass(totalSummary.totalSaldo)">{{ formatCurrency(totalSummary.totalSaldo) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </section>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { focusAndSelectInput, sanitizeCurrencyInput } from '~/composables/useCurrencyInput'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { useReturnTarget } from '~/composables/useReturnTarget'
import { useToast } from '~/composables/useToast'
import type { GetBudgetResponse } from '~/server/api/finances/budgets/[id].get'
import type { BudgetCostCentreLine, BudgetDetail, BudgetSemester, SaveBudgetBody } from '~/types/budget'
import type { CostCentreRow } from '~/types/costCentre'
import { downloadBudgetPlanPdf } from '~/utils/budgetPdfDownload'
const { today: appToday } = useAppTimeZone()

defineEmits<{
  (e: 'openMenu'): void
}>()

interface BudgetEditorLine extends BudgetCostCentreLine {
  notes: string
}

interface BudgetEditorForm {
  id?: number
  year: string
  semester: BudgetSemester
  notes: string
  lines: BudgetEditorLine[]
}

interface DisplayCostCentre extends CostCentreRow {
  depth: number
  hasChildren: boolean
}

interface CostCentreSummary {
  ownExpense: number
  ownIncome: number
  ownSaldo: number
  childExpense: number
  childIncome: number
  childSaldo: number
  totalExpense: number
  totalIncome: number
  totalSaldo: number
}

type BudgetAmountField = 'expense_amount' | 'income_amount'

const { hasPermission } = useAuth()
const { t } = useI18n()
const { formatCurrency } = useLocaleFormatters()
const { pageMeta } = usePage()
const { goToReturnTarget } = useReturnTarget('BudgetList')
const toast = useToast()

const canEdit = computed(() => !pageMeta.value?.forceReadonly && hasPermission('budgets.edit'))
const costCentres = ref<CostCentreRow[]>([])
const isLoadingBudget = ref(false)
const isSaving = ref(false)
const isDownloadingPdf = ref(false)
const form = ref<BudgetEditorForm>(createEmptyBudgetForm())
const focusedField = ref<string | null>(null)
const generalNotesRef = ref<HTMLTextAreaElement | null>(null)
const lineNotesRefs = ref<Record<number, HTMLTextAreaElement | null>>({})
const headerSentinelRef = ref<HTMLElement | null>(null)
const isHeaderStuck = ref(false)
let headerStickyObserver: IntersectionObserver | null = null

const currentYear = Number(appToday().slice(0, 4))
const yearOptions = computed(() => Array.from({ length: 11 }, (_, index) => currentYear + 1 - index))
const openLineNotes = ref<Record<number, boolean>>({})

const orderedCostCentres = computed<DisplayCostCentre[]>(() => {
  const itemMap = new Map(costCentres.value.map(item => [item.id, item]))
  const buckets = new Map<number | null, CostCentreRow[]>()
  const sorted = [...costCentres.value].sort((left, right) => {
    return left.code.localeCompare(right.code, undefined, { numeric: true, sensitivity: 'base' })
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })

  for (const item of sorted) {
    const parentId = item.parent_id !== null && item.parent_id !== item.id && itemMap.has(item.parent_id)
      ? item.parent_id
      : null
    const bucket = buckets.get(parentId) ?? []
    bucket.push(item)
    buckets.set(parentId, bucket)
  }

  const ordered: DisplayCostCentre[] = []
  const visited = new Set<number>()

  const visit = (parentId: number | null, depth: number) => {
    const children = buckets.get(parentId) ?? []

    for (const child of children) {
      if (visited.has(child.id)) continue

      visited.add(child.id)
      ordered.push({
        ...child,
        depth,
        hasChildren: (buckets.get(child.id)?.length ?? 0) > 0,
      })
      visit(child.id, depth + 1)
    }
  }

  visit(null, 0)

  for (const item of sorted) {
    if (visited.has(item.id)) continue
    ordered.push({
      ...item,
      depth: 0,
      hasChildren: (buckets.get(item.id)?.length ?? 0) > 0,
    })
    visit(item.id, 1)
  }

  return ordered.filter(costCentre => shouldDisplayBudgetCostCentre(costCentre.id))
})

const childrenByParent = computed(() => {
  const map = new Map<number | null, number[]>()

  for (const costCentre of costCentres.value) {
    const parentId = costCentre.parent_id ?? null
    const bucket = map.get(parentId) ?? []
    bucket.push(costCentre.id)
    map.set(parentId, bucket)
  }

  return map
})

const lineMap = computed(() => new Map(form.value.lines.map(line => [line.cost_centre_id, line])))

function costCentreLineHasContent(costCentreId: number) {
  const line = lineMap.value.get(costCentreId)
  if (!line) return false

  return Number(line.expense_amount || 0) !== 0
    || Number(line.income_amount || 0) !== 0
    || Boolean(String(line.notes || '').trim())
}

function shouldDisplayBudgetCostCentre(costCentreId: number): boolean {
  const costCentre = costCentres.value.find(entry => entry.id === costCentreId)
  if (!costCentre) return false
  if (Boolean(costCentre.is_active)) return true
  if (costCentreLineHasContent(costCentreId)) return true

  const childIds = childrenByParent.value.get(costCentreId) ?? []
  return childIds.some(childId => shouldDisplayBudgetCostCentre(childId))
}

const summaryByCostCentre = computed<Record<number, CostCentreSummary>>(() => {
  const cache = new Map<number, CostCentreSummary>()

  const computeFor = (costCentreId: number): CostCentreSummary => {
    if (cache.has(costCentreId)) return cache.get(costCentreId)!

    const line = lineMap.value.get(costCentreId)
    const ownExpense = Number((line?.expense_amount ?? 0).toFixed(2))
    const ownIncome = Number((line?.income_amount ?? 0).toFixed(2))
    const ownSaldo = Number((ownIncome - ownExpense).toFixed(2))
    const childIds = childrenByParent.value.get(costCentreId) ?? []

    let childExpense = 0
    let childIncome = 0

    for (const childId of childIds) {
      const childSummary = computeFor(childId)
      childExpense += childSummary.totalExpense
      childIncome += childSummary.totalIncome
    }

    childExpense = Number(childExpense.toFixed(2))
    childIncome = Number(childIncome.toFixed(2))

    const summary = {
      ownExpense,
      ownIncome,
      ownSaldo,
      childExpense,
      childIncome,
      childSaldo: Number((childIncome - childExpense).toFixed(2)),
      totalExpense: Number((ownExpense + childExpense).toFixed(2)),
      totalIncome: Number((ownIncome + childIncome).toFixed(2)),
      totalSaldo: Number(((ownIncome + childIncome) - (ownExpense + childExpense)).toFixed(2)),
    }

    cache.set(costCentreId, summary)
    return summary
  }

  const result: Record<number, CostCentreSummary> = {}
  for (const costCentre of costCentres.value) result[costCentre.id] = computeFor(costCentre.id)
  return result
})

const totalSummary = computed(() => {
  const rootIds = childrenByParent.value.get(null) ?? []
  let totalExpense = 0
  let totalIncome = 0

  for (const rootId of rootIds) {
    const summary = summaryByCostCentre.value[rootId]
    if (!summary) continue
    totalExpense += summary.totalExpense
    totalIncome += summary.totalIncome
  }

  return {
    totalExpense: Number(totalExpense.toFixed(2)),
    totalIncome: Number(totalIncome.toFixed(2)),
    totalSaldo: Number((totalIncome - totalExpense).toFixed(2)),
  }
})

const periodBounds = computed(() => getPeriodBounds(Number(form.value.year), form.value.semester))
const hasValidPeriod = computed(() => Number.isInteger(Number(form.value.year)) && Number(form.value.year) >= 2000)

const periodShortLabel = computed(() => {
  if (!hasValidPeriod.value) return ''

  const year = Number(form.value.year)
  if (form.value.semester === 'summer') return `${t('budget.semesters.summerShort')} ${year}`
  return `${t('budget.semesters.winterShort')} ${year}/${String(year + 1).slice(-2)}`
})

onMounted(async () => {
  if (headerSentinelRef.value) {
    headerStickyObserver = new IntersectionObserver((entries) => {
      isHeaderStuck.value = !entries[0]?.isIntersecting
    })
    headerStickyObserver.observe(headerSentinelRef.value)
  }

  await loadCostCentres()

  const budgetId = Number(pageMeta.value?.budgetId)
  if (Number.isInteger(budgetId) && budgetId > 0) {
    await loadBudget(budgetId)
    return
  }

  resetCurrentBudget()
  await nextTick()
  resizeAllNotes()
})

onBeforeUnmount(() => {
  headerStickyObserver?.disconnect()
})

useAppRefresh().onRefresh(loadCostCentres)

function resolveDefaultPeriod() {
  const today = appToday()
  const month = Number(today.slice(5, 7))
  const year = Number(today.slice(0, 4))

  if (month >= 4 && month <= 9) return { year, semester: 'summer' as BudgetSemester }
  if (month >= 10) return { year, semester: 'winter' as BudgetSemester }
  return { year: year - 1, semester: 'winter' as BudgetSemester }
}

function createEmptyBudgetForm(): BudgetEditorForm {
  const period = resolveDefaultPeriod()
  return {
    year: String(period.year),
    semester: period.semester,
    notes: '',
    lines: [],
  }
}

function createEditorLines(detailLines?: BudgetCostCentreLine[]) {
  const lineByCostCentre = new Map((detailLines ?? []).map(line => [line.cost_centre_id, line]))

  return costCentres.value.map(costCentre => {
    const existing = lineByCostCentre.get(costCentre.id)
    return {
      cost_centre_id: costCentre.id,
      expense_amount: Number(existing?.expense_amount ?? 0),
      income_amount: Number(existing?.income_amount ?? 0),
      notes: existing?.notes ?? '',
    }
  })
}

function applyBudgetDetail(budget: BudgetDetail) {
  form.value = {
    id: budget.id,
    year: String(budget.year),
    semester: budget.semester,
    notes: budget.notes ?? '',
    lines: createEditorLines(budget.lines),
  }

  syncOpenLineNotes(true)
}

function resetCurrentBudget() {
  const empty = createEmptyBudgetForm()
  form.value = {
    ...empty,
    lines: createEditorLines(),
  }

  syncOpenLineNotes(true)

  nextTick().then(() => {
    resizeAllNotes()
  })
}

function hasLineNote(costCentreId: number) {
  return Boolean(String(lineMap.value.get(costCentreId)?.notes || '').trim())
}

function isLineNotesOpen(costCentreId: number) {
  return Boolean(openLineNotes.value[costCentreId])
}

function toggleLineNotes(costCentreId: number) {
  const opened = !openLineNotes.value[costCentreId]
  openLineNotes.value[costCentreId] = opened
  if (!opened) return

  nextTick().then(() => {
    const textarea = lineNotesRefs.value[costCentreId]
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
    if (canEdit.value) textarea.focus()
  })
}

function syncOpenLineNotes(replace = false) {
  const next: Record<number, boolean> = replace ? {} : { ...openLineNotes.value }

  for (const line of form.value.lines) {
    if (String(line.notes || '').trim()) next[line.cost_centre_id] = true
  }

  openLineNotes.value = next
}

function ownLine(costCentreId: number) {
  const existing = form.value.lines.find(line => line.cost_centre_id === costCentreId)
  if (existing) return existing

  const created = { cost_centre_id: costCentreId, expense_amount: 0, income_amount: 0, notes: '' }
  form.value.lines.push(created)
  return created
}

function fieldFocusKey(costCentreId: number, field: BudgetAmountField) {
  return `${costCentreId}:${field}`
}

function displayCurrencyField(costCentreId: number, field: BudgetAmountField) {
  const value = ownLine(costCentreId)[field]
  if (focusedField.value === fieldFocusKey(costCentreId, field)) return String(value)
  return formatCurrency(value)
}

function onCurrencyFocus(event: FocusEvent, costCentreId: number, field: BudgetAmountField) {
  focusedField.value = fieldFocusKey(costCentreId, field)
  focusAndSelectInput(event)
}

function onCurrencyInput(event: Event, costCentreId: number, field: BudgetAmountField) {
  const value = sanitizeCurrencyInput((event.target as HTMLInputElement).value)
  const parsed = parseFloat(value)
  ownLine(costCentreId)[field] = Number.isNaN(parsed) ? 0 : parsed
  ;(event.target as HTMLInputElement).value = value
}

function onCurrencyBlur(costCentreId: number, field: BudgetAmountField) {
  focusedField.value = null
  const line = ownLine(costCentreId)
  line[field] = Number(Number(line[field]).toFixed(2))
}

function getPeriodBounds(year: number, semester: BudgetSemester) {
  if (!Number.isInteger(year) || year < 2000) return { startDate: '', endDate: '' }

  if (semester === 'summer') {
    return { startDate: `${year}-04-01`, endDate: `${year}-09-30` }
  }

  return { startDate: `${year}-10-01`, endDate: `${year + 1}-03-31` }
}

function saldoTextClass(value: number) {
  if (value > 0) return 'text-success-700'
  if (value < 0) return 'text-danger-700'
  return 'text-base-700'
}

function saldoTextClassOnDark(value: number) {
  if (value > 0) return 'text-success-400'
  if (value < 0) return 'text-danger-400'
  return 'text-base-300'
}

function semesterButtonClass(value: BudgetSemester) {
  const selected = form.value.semester === value
  return [
    'rounded-lg border px-3 py-2 text-sm font-medium transition cursor-pointer',
    selected ? 'border-accent-400 bg-accent-50 text-accent-700' : 'border-base-200 bg-white text-base-700 hover:bg-base-50',
    !canEdit.value ? 'cursor-not-allowed opacity-70' : '',
  ]
}

async function loadCostCentres() {
  const response = await apiFetch<{ ok: boolean, costCentres?: CostCentreRow[], error?: string }>('/api/cost_centres')
  if (!response.ok || !response.costCentres) {
    toast.error(response.error || t('budget.loadFailed'))
    return
  }

  costCentres.value = response.costCentres
  form.value.lines = createEditorLines(form.value.lines)
  syncOpenLineNotes()
  await nextTick()
  resizeAllNotes()
}

async function loadBudget(budgetId: number) {
  isLoadingBudget.value = true

  try {
    const response = await apiFetch<GetBudgetResponse>(`/api/finances/budgets/${budgetId}`)
    if (!response.ok) {
      toast.error(response.error || t('budget.loadFailed'))
      return
    }

    applyBudgetDetail(response.budget)
    await nextTick()
    resizeAllNotes()
  } finally {
    isLoadingBudget.value = false
  }
}

async function saveBudget(exit: boolean) {
  if (isSaving.value) return
  if (!canEdit.value) {
    toast.error(t('common.notAuthorized'))
    return
  }

  if (!hasValidPeriod.value) {
    toast.error(t('budget.required.period'))
    return
  }

  isSaving.value = true

  try {
    const isEditMode = Boolean(form.value.id)
    const payload: SaveBudgetBody = {
      id: form.value.id,
      year: Number(form.value.year),
      semester: form.value.semester,
      notes: form.value.notes.trim() || null,
      lines: form.value.lines.map(line => ({
        cost_centre_id: line.cost_centre_id,
        expense_amount: Number(line.expense_amount || 0),
        income_amount: Number(line.income_amount || 0),
        notes: line.notes.trim() || null,
      })),
    }

    const response = await apiFetch<{ ok: boolean, id?: number, error?: string }>('/api/finances/budgets/save', {
      method: 'POST',
      body: payload,
    })

    if (!response.ok || !response.id) throw new Error(response.error || t('budget.saveFailed'))

    toast.success(isEditMode ? t('budget.saved.updated') : t('budget.saved.created'))

    if (exit) {
      goToReturnTarget()
      return
    }

    await loadBudget(response.id)
  } catch (error: any) {
    toast.error(error?.message || t('budget.saveFailed'))
  } finally {
    isSaving.value = false
  }
}

async function downloadPdf() {
  const budgetId = form.value.id
  if (!budgetId || isDownloadingPdf.value) return

  isDownloadingPdf.value = true

  try {
    const result = await downloadBudgetPlanPdf({
      id: budgetId,
      year: Number(form.value.year),
      semester: form.value.semester,
    })
    if (!result.ok) toast.error(result.error || t('budget.downloadFailed'))
  } catch {
    toast.error(t('budget.downloadFailed'))
  } finally {
    isDownloadingPdf.value = false
  }
}

function cancel() {
  goToReturnTarget()
}

function setGeneralNotesRef(element: Element | ComponentPublicInstance | null) {
  generalNotesRef.value = element instanceof HTMLTextAreaElement ? element : null
}

function setLineNotesRef(element: Element | ComponentPublicInstance | null, costCentreId: number) {
  lineNotesRefs.value[costCentreId] = element instanceof HTMLTextAreaElement ? element : null
}

function autoResizeTextarea(event: Event) {
  const textarea = event.target as HTMLTextAreaElement | null
  if (!textarea) return
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

function resizeAllNotes() {
  const textareas = [generalNotesRef.value, ...Object.values(lineNotesRefs.value)]
  textareas.forEach((textarea) => {
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  })
}
</script>
