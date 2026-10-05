<template>
  <section class="space-y-6">
    <div v-if="loading && !overview" class="-mx-6 bg-white p-8 text-center text-sm text-base-400 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      {{ t('event.cashRegister.loading') }}
    </div>

    <div v-else-if="error" class="-mx-6 bg-white p-8 text-center shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      <Icon name="material-symbols:error-outline-rounded" class="mb-1 text-2xl text-danger-400" />
      <p class="text-sm text-base-500">{{ error }}</p>
    </div>

    <div v-else-if="!linked" class="-mx-6 bg-white p-8 text-center shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      <Icon name="material-symbols:link-off-rounded" class="mb-1 text-2xl text-base-300" />
      <p class="text-sm text-base-500">{{ t('event.cashRegister.notLinked') }}</p>
    </div>

    <template v-else-if="overview">
      <div
        v-if="hasStands"
        class="-mx-6 flex flex-wrap items-center gap-3 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg"
      >
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
          <Icon name="material-symbols:storefront-rounded" class="text-base" />
        </span>
        <span class="text-sm font-semibold text-base-700">{{ t('event.cashRegister.standFilter') }}</span>
        <div class="w-full sm:w-64">
          <CommonSearchSelect
            v-model="standQuery"
            :options="standOptions"
            :placeholder="t('event.cashRegister.allStands')"
            :empty-text="t('event.cashRegister.noMatchingStands')"
            :selected-label="selectedStandLabel"
            @select="onStandSelect"
            @clear-selection="standFilter = 'all'"
          />
        </div>
        <p v-if="standFilterActive" class="text-xs text-base-400">
          {{ t('event.cashRegister.paymentsNotStandBound') }}
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2" :class="standFilterActive ? 'xl:grid-cols-4' : 'xl:grid-cols-5'">
        <div
          v-for="tile in statTiles"
          :key="tile.label"
          class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg"
        >
          <div class="flex items-center gap-2">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
              <Icon :name="tile.icon" class="text-base" />
            </span>
            <p class="text-sm text-base-500">{{ tile.label }}</p>
          </div>
          <p class="mt-3 text-2xl font-semibold text-base-900">{{ tile.value }}</p>
          <p class="mt-1 text-xs text-base-400">{{ tile.meta }}</p>
        </div>
      </div>

      <div v-if="hasStands" class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
        <div class="mb-3 flex items-center gap-2">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
            <Icon name="material-symbols:storefront-rounded" class="text-base" />
          </span>
          <h2 class="text-lg font-semibold">{{ t('event.cashRegister.standComparisonTitle') }}</h2>
        </div>

        <div class="hidden grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_7rem] gap-4 border-b border-base-200 pb-2 text-xs font-semibold uppercase tracking-wide text-base-400 md:grid">
          <span>{{ t('event.cashRegister.stand') }}</span>
          <span class="text-right">{{ t('event.cashRegister.orders') }}</span>
          <span class="text-right">{{ t('event.cashRegister.quantity') }}</span>
          <span class="text-right">{{ t('event.cashRegister.revenue') }}</span>
          <span class="text-right">{{ t('event.cashRegister.donations') }}</span>
        </div>

        <ul>
          <li v-for="row in standRows" :key="row.key">
            <button
              type="button"
              class="w-full cursor-pointer border-b border-base-100 px-1 py-2 text-left transition-colors hover:bg-base-50"
              :class="row.filterValue === standFilter ? 'bg-accent-50' : ''"
              @click="standFilter = row.filterValue"
            >
              <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_7rem]">
                <span class="col-span-2 truncate font-medium text-base-800 md:col-span-1">{{ row.label }}</span>
                <span class="text-base-500 md:text-right">
                  <span class="md:hidden">{{ t('event.cashRegister.orders') }}: </span>{{ row.orders }}
                </span>
                <span class="text-right text-base-500">
                  <span class="md:hidden">{{ t('event.cashRegister.quantity') }}: </span>{{ row.quantity }}
                </span>
                <span class="font-medium text-base-800 md:text-right">
                  <span class="font-normal text-base-500 md:hidden">{{ t('event.cashRegister.revenue') }}: </span>{{ row.revenueLabel }}
                </span>
                <span class="text-right text-base-700">
                  <span class="text-base-500 md:hidden">{{ t('event.cashRegister.donations') }}: </span>{{ row.donationsLabel }}
                </span>
              </div>
              <div class="mt-1 h-2 rounded-full bg-base-100">
                <div class="h-2 rounded-full bg-accent-400" :style="{ width: `${row.barPercent}%` }"></div>
              </div>
            </button>
          </li>
        </ul>
      </div>

      <div class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
        <div class="mb-4 flex items-center gap-2">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
            <Icon name="material-symbols:bar-chart-rounded" class="text-base" />
          </span>
          <h2 class="text-lg font-semibold">{{ t('event.cashRegister.hourlyTitle') }}</h2>
        </div>

        <div v-if="overview.hourly.length === 0" class="rounded-lg border border-base-200 bg-base-50 p-6 text-center text-sm text-base-400">
          {{ t('event.cashRegister.noSales') }}
        </div>

        <div v-else class="overflow-x-auto pb-1">
          <div class="flex items-end gap-2 min-w-fit">
            <div
              v-for="entry in overview.hourly"
              :key="entry.hour"
              class="group flex min-w-14 flex-1 flex-col items-center"
              :title="`${formatCurrency(entry.revenue)} · ${entry.quantity} ${t('event.cashRegister.pcs')}`"
            >
              <span class="mb-1 whitespace-nowrap text-xs text-base-500">{{ formatCurrency(entry.revenue) }}</span>
              <div
                class="w-full rounded-t-md bg-accent-400 transition-colors"
                :style="{ height: `${barHeight(entry.revenue)}px` }"
              ></div>
              <span class="mt-1 w-full whitespace-nowrap border-t border-base-200 pt-1 text-center text-xs font-medium text-base-500">
                {{ hourLabel(entry.hour) }}
              </span>
              <span class="h-4 whitespace-nowrap text-xs text-base-400">
                {{ dayLabel(entry.hour) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="grid items-start gap-6 lg:grid-cols-2">
        <div class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
          <div class="mb-3 flex items-center gap-2">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
              <Icon name="material-symbols:shopping-cart-rounded" class="text-base" />
            </span>
            <h2 class="text-lg font-semibold">{{ t('event.cashRegister.salesTitle') }}</h2>
          </div>

          <div v-if="overview.regular.items.length === 0" class="rounded-lg border border-base-200 bg-base-50 p-6 text-center text-sm text-base-400">
            {{ t('event.cashRegister.noSales') }}
          </div>

          <table v-else class="w-full text-sm">
            <thead>
              <tr class="border-b border-base-200 text-xs uppercase tracking-wide text-base-400">
                <th class="pb-2 text-left font-semibold">{{ t('event.cashRegister.item') }}</th>
                <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.quantity') }}</th>
                <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.revenue') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in overview.regular.items" :key="item.id" class="border-b border-base-100">
                <td class="max-w-0 truncate py-2 pr-3 text-base-700">{{ item.name }}</td>
                <td class="py-2 text-right text-base-500">{{ item.quantity }}</td>
                <td class="py-2 text-right font-medium text-base-800">{{ formatCurrency(item.amount) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="pt-2 font-semibold text-base-700">{{ t('common.total') }}</td>
                <td class="pt-2 text-right font-semibold text-base-700">{{ overview.regular.totalQuantity }}</td>
                <td class="pt-2 text-right font-semibold text-base-900">{{ formatCurrency(overview.regular.itemsRevenue ?? overview.regular.totalRevenue) }}</td>
              </tr>
            </tfoot>
          </table>

          <p class="mt-3 text-xs text-base-400">{{ t('event.cashRegister.historicalPricesNotice') }}</p>
        </div>

        <div class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
          <div class="mb-3 flex items-center gap-2">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
              <Icon name="material-symbols:volunteer-activism-rounded" class="text-base" />
            </span>
            <h2 class="text-lg font-semibold">{{ t('event.cashRegister.givenOutTitle') }}</h2>
          </div>

          <div v-if="overview.fachschaft.items.length === 0" class="rounded-lg border border-base-200 bg-base-50 p-6 text-center text-sm text-base-400">
            {{ t('event.cashRegister.noGivenOut') }}
          </div>

          <table v-else class="w-full text-sm">
            <thead>
              <tr class="border-b border-base-200 text-xs uppercase tracking-wide text-base-400">
                <th class="pb-2 text-left font-semibold">{{ t('event.cashRegister.item') }}</th>
                <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.quantity') }}</th>
                <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.worth') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in overview.fachschaft.items" :key="item.id" class="border-b border-base-100">
                <td class="max-w-0 truncate py-2 pr-3 text-base-700">{{ item.name }}</td>
                <td class="py-2 text-right text-base-500">{{ item.quantity }}</td>
                <td class="py-2 text-right font-medium text-base-800">{{ formatCurrency(item.amount) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="pt-2 font-semibold text-base-700">{{ t('common.total') }}</td>
                <td class="pt-2 text-right font-semibold text-base-700">{{ overview.fachschaft.totalQuantity }}</td>
                <td class="pt-2 text-right font-semibold text-base-900">{{ formatCurrency(overview.fachschaft.totalWorth) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div v-if="vouchers" class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
        <div class="mb-3 flex items-center gap-2">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
            <Icon name="material-symbols:confirmation-number-outline-rounded" class="text-base" />
          </span>
          <h2 class="text-lg font-semibold">{{ t('event.cashRegister.vouchersTitle') }}</h2>
        </div>

        <div class="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 class="mb-2 text-sm font-semibold text-base-700">{{ t('event.cashRegister.vouchersSoldTitle') }}</h3>
            <div v-if="vouchers.sold.byBatch.length === 0" class="rounded-lg border border-base-200 bg-base-50 p-4 text-center text-sm text-base-400">
              {{ t('event.cashRegister.vouchersNoneSold') }}
            </div>
            <table v-else class="w-full text-sm">
              <thead>
                <tr class="border-b border-base-200 text-xs uppercase tracking-wide text-base-400">
                  <th class="pb-2 text-left font-semibold">{{ t('event.cashRegister.vouchersBatch') }}</th>
                  <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.quantity') }}</th>
                  <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.revenue') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="batch in vouchers.sold.byBatch" :key="batch.batchId ?? batch.name" class="border-b border-base-100">
                  <td class="max-w-0 truncate py-2 pr-3 text-base-700">{{ batch.name }}</td>
                  <td class="py-2 text-right text-base-500">{{ batch.count }}</td>
                  <td class="py-2 text-right font-medium text-base-800">{{ formatCurrency(batch.revenue) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="pt-2 font-semibold text-base-700">{{ t('common.total') }}</td>
                  <td class="pt-2 text-right font-semibold text-base-700">{{ vouchers.sold.count }}</td>
                  <td class="pt-2 text-right font-semibold text-base-900">{{ formatCurrency(vouchers.sold.revenue) }}</td>
                </tr>
              </tfoot>
            </table>
            <p class="mt-3 text-xs text-base-400">{{ t('event.cashRegister.vouchersSoldNotice') }}</p>
          </div>

          <div>
            <h3 class="mb-2 text-sm font-semibold text-base-700">{{ t('event.cashRegister.vouchersRedeemedTitle') }}</h3>
            <div v-if="vouchers.redeemed.items.length === 0" class="rounded-lg border border-base-200 bg-base-50 p-4 text-center text-sm text-base-400">
              {{ t('event.cashRegister.vouchersNoneRedeemed') }}
            </div>
            <template v-else>
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-base-200 text-xs uppercase tracking-wide text-base-400">
                    <th class="pb-2 text-left font-semibold">{{ t('event.cashRegister.item') }}</th>
                    <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.quantity') }}</th>
                    <th class="pb-2 text-right font-semibold">{{ t('event.cashRegister.worth') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in vouchers.redeemed.items" :key="item.id ?? item.name" class="border-b border-base-100">
                    <td class="max-w-0 truncate py-2 pr-3 text-base-700">{{ item.name }}</td>
                    <td class="py-2 text-right text-base-500">{{ item.quantity }}</td>
                    <td class="py-2 text-right font-medium text-base-800">{{ formatCurrency(item.worth) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td class="pt-2 font-semibold text-base-700">{{ t('common.total') }}</td>
                    <td class="pt-2 text-right font-semibold text-base-700">{{ vouchers.redeemed.totalQuantity }}</td>
                    <td class="pt-2 text-right font-semibold text-base-900">{{ formatCurrency(vouchers.redeemed.totalWorth) }}</td>
                  </tr>
                </tfoot>
              </table>
              <dl class="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt class="text-base-500">{{ t('event.cashRegister.vouchersPaidWorth') }}</dt>
                <dd class="text-right text-base-700">{{ formatCurrency(vouchers.redeemed.paidWorth) }}</dd>
                <dt class="text-base-500">{{ t('event.cashRegister.vouchersFreeWorth') }}</dt>
                <dd class="text-right text-base-700">{{ formatCurrency(vouchers.redeemed.freeWorth) }}</dd>
                <dt class="text-base-500">{{ t('event.cashRegister.vouchersDeposits') }}</dt>
                <dd class="text-right text-base-700">{{ formatCurrency(vouchers.redeemed.depositsCollected) }}</dd>
              </dl>
            </template>
            <p class="mt-3 text-xs text-base-400">{{ t('event.cashRegister.vouchersRedeemedNotice') }}</p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { CashRegisterOverview, EventCashRegisterResponse } from '~/server/api/events/[id]/cash-register.get'
import type { CashRegisterStandFilterValue, CashRegisterStandStat } from '~/server/utils/cashRegisterStands'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'

const props = defineProps<{
  eventId: number
}>()

const { t } = useI18n()
const { formatCurrency } = useLocaleFormatters()

const loading = ref(true)
const error = ref('')
const linked = ref(false)
const overview = ref<CashRegisterOverview | null>(null)

const MAX_BAR_HEIGHT = 160

const standFilter = ref<CashRegisterStandFilterValue>('all')
const standQuery = ref('')

const standStats = computed<CashRegisterStandStat[]>(() => overview.value?.stands ?? [])
// Only shown once the event has voucher sales or redemptions.
const vouchers = computed(() => {
  const stats = overview.value?.vouchers
  return stats && (stats.sold.count > 0 || stats.redeemed.totalQuantity > 0) ? stats : null
})
const hasStands = computed(() => standStats.value.some(stand => stand.id != null))
const standFilterActive = computed(() => hasStands.value && overview.value?.standFilter !== 'all')

function standFilterValue(stand: CashRegisterStandStat): CashRegisterStandFilterValue {
  return stand.id == null ? 'none' : stand.id
}

function standLabel(stand: CashRegisterStandStat) {
  if (stand.id == null) return t('event.cashRegister.noStand')
  return stand.name ?? `#${stand.id}`
}

const standOptions = computed<SearchSelectOption[]>(() => [
  { key: 'all', label: t('event.cashRegister.allStands'), value: 'all' },
  ...standStats.value.map(stand => ({
    key: String(standFilterValue(stand)),
    label: standLabel(stand),
    value: standFilterValue(stand),
  })),
])

const selectedStandLabel = computed(() =>
  standOptions.value.find(option => option.value === standFilter.value)?.label ?? '')

function onStandSelect(value: unknown) {
  standFilter.value = value as CashRegisterStandFilterValue
  standQuery.value = ''
}

const standRows = computed(() => {
  const max = standStats.value.reduce((highest, stand) => Math.max(highest, stand.revenue), 0)

  return standStats.value.map(stand => ({
    key: String(standFilterValue(stand)),
    filterValue: standFilterValue(stand),
    label: standLabel(stand),
    orders: stand.orders,
    quantity: stand.quantity,
    revenueLabel: formatCurrency(stand.revenue),
    donationsLabel: formatCurrency(stand.donations),
    barPercent: max > 0 ? Math.max(stand.revenue > 0 ? 1 : 0, stand.revenue / max * 100) : 0,
  }))
})

const maxHourlyRevenue = computed(() =>
  (overview.value?.hourly ?? []).reduce((max, entry) => Math.max(max, entry.revenue), 0),
)

// "à {amount}" is only truthful while every payment of the event was booked at
// the same amount — the stored amounts decide, not the current setting.
const fachschaftPaymentsMeta = computed(() => {
  const payments = overview.value?.payments
  if (!payments) return ''

  if (payments.amounts.length > 1) {
    return t('event.cashRegister.fachschaftPaymentsMetaMixed', { count: payments.count })
  }

  return t('event.cashRegister.fachschaftPaymentsMeta', {
    count: payments.count,
    amount: formatCurrency(payments.amounts[0]?.amount ?? payments.amount),
  })
})

const statTiles = computed(() => {
  if (!overview.value) return []

  if (standFilterActive.value) {
    return [
      {
        label: t('event.cashRegister.totalRevenue'),
        value: formatCurrency(overview.value.regular.totalRevenue),
        meta: t('event.cashRegister.itemsSoldMeta', { count: overview.value.regular.totalQuantity }),
        icon: 'material-symbols:euro-rounded',
      },
      {
        label: t('event.cashRegister.donations'),
        value: formatCurrency(overview.value.donations.total),
        meta: t('event.cashRegister.donationsMeta', { count: overview.value.donations.count }),
        icon: 'material-symbols:favorite-rounded',
      },
      {
        label: t('event.cashRegister.givenOutWorth'),
        value: formatCurrency(overview.value.fachschaft.totalWorth),
        meta: t('event.cashRegister.givenOutMeta', { count: overview.value.fachschaft.totalQuantity }),
        icon: 'material-symbols:volunteer-activism-rounded',
      },
      {
        label: t('event.cashRegister.standRevenue'),
        value: formatCurrency(overview.value.regular.totalRevenue + overview.value.donations.total),
        meta: t('event.cashRegister.standRevenueMeta'),
        icon: 'material-symbols:account-balance-wallet',
      },
    ]
  }

  const totalIncome = overview.value.regular.totalRevenue
    + overview.value.payments.revenue
    + overview.value.donations.total

  return [
    {
      label: t('event.cashRegister.totalRevenue'),
      value: formatCurrency(overview.value.regular.totalRevenue),
      meta: t('event.cashRegister.itemsSoldMeta', { count: overview.value.regular.totalQuantity }),
      icon: 'material-symbols:euro-rounded',
    },
    {
      label: t('event.cashRegister.fachschaftPayments'),
      value: formatCurrency(overview.value.payments.revenue),
      meta: fachschaftPaymentsMeta.value,
      icon: 'material-symbols:savings-rounded',
    },
    {
      label: t('event.cashRegister.donations'),
      value: formatCurrency(overview.value.donations.total),
      meta: t('event.cashRegister.donationsMeta', { count: overview.value.donations.count }),
      icon: 'material-symbols:favorite-rounded',
    },
    {
      label: t('event.cashRegister.givenOutWorth'),
      value: formatCurrency(overview.value.fachschaft.totalWorth),
      meta: t('event.cashRegister.givenOutMeta', { count: overview.value.fachschaft.totalQuantity }),
      icon: 'material-symbols:volunteer-activism-rounded',
    },
    {
      label: t('event.cashRegister.combinedRevenue'),
      value: formatCurrency(totalIncome),
      meta: t('event.cashRegister.combinedRevenueMeta'),
      icon: 'material-symbols:account-balance-wallet',
    },
  ]
})

function barHeight(revenue: number) {
  if (maxHourlyRevenue.value <= 0) return 2
  const scaled = Math.round((revenue / maxHourlyRevenue.value) * MAX_BAR_HEIGHT)
  return Math.max(revenue > 0 ? 4 : 2, scaled)
}

function toBerlinIso(hour: string) {
  return new Date(hour.replace(' ', 'T') + 'Z').toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' })
}

function hourLabel(hour: string) {
  return toBerlinIso(hour).slice(11, 16)
}

function dayLabel(hour: string) {
  const entries = overview.value?.hourly ?? []
  const index = entries.findIndex(entry => entry.hour === hour)
  const berlinDate = toBerlinIso(hour).slice(0, 10)
  if (index > 0 && toBerlinIso(entries[index - 1]!.hour).slice(0, 10) === berlinDate) return ''
  return `${berlinDate.slice(8, 10)}.${berlinDate.slice(5, 7)}.`
}

async function loadOverview() {
  loading.value = true
  error.value = ''

  try {
    const res = await $fetch<EventCashRegisterResponse>(`/api/events/${props.eventId}/cash-register`, {
      query: { standId: String(standFilter.value) },
    })

    if (!res.ok) {
      error.value = res.error || t('event.cashRegister.loadFailed')
      return
    }

    if (!res.connected || !res.linked) {
      linked.value = false
      overview.value = null
      return
    }

    linked.value = true
    overview.value = res.overview

    if (standFilter.value !== 'all' && !standOptions.value.some(option => option.value === standFilter.value)) {
      standFilter.value = 'all'
    }
  } catch {
    error.value = t('event.cashRegister.loadFailed')
  } finally {
    loading.value = false
  }
}

watch(() => props.eventId, () => {
  overview.value = null
  if (standFilter.value === 'all') loadOverview()
  else standFilter.value = 'all'
})
watch(standFilter, loadOverview)
onMounted(loadOverview)
useAppRefresh().onRefresh(loadOverview)
</script>
