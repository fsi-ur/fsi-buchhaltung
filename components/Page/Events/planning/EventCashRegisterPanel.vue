<template>
  <section class="space-y-6">
    <div v-if="loading && !view" class="-mx-6 bg-white p-8 text-center text-sm text-base-400 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      {{ t('event.cashRegister.loading') }}
    </div>

    <div v-else-if="error" class="-mx-6 bg-white p-8 text-center shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      <Icon name="material-symbols:error-outline-rounded" class="mb-1 text-2xl text-danger-400" />
      <p class="text-sm text-base-500">{{ error }}</p>
    </div>

    <div v-else-if="!view" class="-mx-6 bg-white p-8 text-center shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg">
      <Icon name="material-symbols:link-off-rounded" class="mb-1 text-2xl text-base-300" />
      <p class="text-sm text-base-500">{{ t('event.cashRegister.notLinked') }}</p>
    </div>

    <template v-else>
      <!-- Everything below is described by the kassensystem (shared/cashRegisterView.ts). -->
      <div
        v-for="filter in view.filters"
        :key="filter.key"
        class="-mx-6 flex flex-wrap items-center gap-3 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg"
      >
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
          <Icon name="material-symbols:filter-alt-outline" class="text-base" />
        </span>
        <span class="text-sm font-semibold text-base-700">{{ filter.label }}</span>
        <div class="w-full sm:w-64">
          <CommonSearchSelect
            v-model="filterQueries[filter.key]"
            :options="filterOptions(filter)"
            :placeholder="filter.options[0]?.label"
            :empty-text="t('event.cashRegister.noMatchingOptions')"
            :selected-label="filter.options.find(option => option.value === filter.value)?.label ?? ''"
            @select="value => setFilter(filter.key, String(value))"
            @clear-selection="setFilter(filter.key, filter.options[0]?.value ?? '')"
          />
        </div>
        <p v-if="filter.activeNote && filter.value !== filter.options[0]?.value" class="text-xs text-base-400">
          {{ filter.activeNote }}
        </p>
      </div>

      <div class="grid items-start gap-6 lg:grid-cols-2">
        <template v-for="section in view.sections" :key="section.id">
          <div
            v-if="section.type === 'stats'"
            class="grid gap-4 sm:grid-cols-2 lg:col-span-2"
            :class="STAT_COLUMNS[Math.min(section.items.length, 6)]"
          >
            <div
              v-for="(tile, index) in section.items"
              :key="index"
              class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg"
            >
              <div class="flex items-center gap-2">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  :class="VIEW_TONE_ICON[tile.tone ?? 'default']"
                >
                  <Icon :name="tile.icon ?? 'material-symbols:analytics-outline-rounded'" class="text-base" />
                </span>
                <p class="text-sm text-base-500">{{ tile.label }}</p>
              </div>
              <p class="mt-3 text-2xl font-semibold text-base-900">
                <PageEventsPlanningCashRegisterViewCell :cell="tile.value" />
              </p>
              <p v-if="tile.meta" class="mt-1 text-xs text-base-400">{{ tile.meta }}</p>
            </div>
          </div>

          <div
            v-else-if="section.type === 'alert'"
            class="-mx-6 flex items-center gap-3 border p-4 text-sm shadow-sm sm:mx-0 sm:rounded-xl lg:col-span-2"
            :class="VIEW_TONE_ALERT[section.tone ?? 'default']"
          >
            <Icon :name="section.icon ?? 'material-symbols:info-outline-rounded'" class="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>{{ section.text }}</span>
          </div>

          <div
            v-else-if="section.type === 'card'"
            class="-mx-6 bg-white p-4 shadow-sm sm:mx-0 sm:rounded-xl sm:shadow-lg"
            :class="section.width === 'half' ? '' : 'lg:col-span-2'"
          >
            <div class="mb-3 flex items-center gap-2">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                :class="VIEW_TONE_ICON[section.tone ?? 'default']"
              >
                <Icon :name="section.icon ?? 'material-symbols:analytics-outline-rounded'" class="text-base" />
              </span>
              <h2 class="text-lg font-semibold">{{ section.title }}</h2>
            </div>

            <div class="grid gap-6" :class="section.columns === 2 ? 'lg:grid-cols-2' : ''">
              <PageEventsPlanningCashRegisterViewBlock
                v-for="(block, index) in section.blocks"
                :key="index"
                :block="block"
                @filter="action => setFilter(action.key, action.value)"
              />
            </div>
          </div>
        </template>
      </div>

      <p v-if="view.generatedAt" class="text-right text-xs text-base-400">
        {{ t('event.cashRegister.generatedAt', { time: formatDateTime(view.generatedAt) }) }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { CashRegisterErrorReason, EventCashRegisterResponse } from '~/server/api/events/[id]/cash-register.get'
import type { CashRegisterView, ViewFilter } from '~/shared/cashRegisterView'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'

const props = defineProps<{
  eventId: number
}>()

const { t, language } = useI18n()
const { formatDateTime } = useLocaleFormatters()

const loading = ref(true)
const error = ref('')
const view = ref<CashRegisterView | null>(null)

// The kassensystem declares the filters; their values travel back as `f.<key>`.
const filterValues = ref<Record<string, string>>({})
const filterQueries = ref<Record<string, string>>({})

const STAT_COLUMNS: Record<number, string> = {
  0: '',
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
}

const ERROR_REASONS: CashRegisterErrorReason[] = ['notConfigured', 'unreachable', 'rejected', 'incompatible', 'invalid']

function filterOptions(filter: ViewFilter): SearchSelectOption[] {
  return filter.options.map(option => ({ key: option.value, label: option.label, value: option.value }))
}

function setFilter(key: string, value: string) {
  filterQueries.value[key] = ''
  if (filterValues.value[key] === value) return
  filterValues.value = { ...filterValues.value, [key]: value }
  loadOverview()
}

async function loadOverview() {
  loading.value = true
  error.value = ''

  const query: Record<string, string> = { locale: language.value }
  for (const [key, value] of Object.entries(filterValues.value)) query[`f.${key}`] = value

  try {
    const res = await apiFetch<EventCashRegisterResponse>(`/api/events/${props.eventId}/cash-register`, { query })

    if (!res.ok) {
      error.value = res.reason && ERROR_REASONS.includes(res.reason)
        ? t(`event.cashRegister.errors.${res.reason}`)
        : res.error || t('event.cashRegister.loadFailed')
      return
    }

    if (!res.connected || !res.linked) {
      view.value = null
      return
    }

    view.value = res.view
    // The kassensystem may normalize a filter (e.g. reset an unknown stand).
    filterValues.value = Object.fromEntries(res.view.filters.map(filter => [filter.key, filter.value]))
  } catch {
    error.value = t('event.cashRegister.loadFailed')
  } finally {
    loading.value = false
  }
}

watch(() => props.eventId, () => {
  view.value = null
  filterValues.value = {}
  loadOverview()
})
watch(language, loadOverview)
onMounted(loadOverview)
useAppRefresh().onRefresh(loadOverview)
</script>
