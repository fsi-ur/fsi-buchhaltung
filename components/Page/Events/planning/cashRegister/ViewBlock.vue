<template>
  <div>
    <h3 v-if="'title' in block && block.title" class="mb-2 text-sm font-semibold text-base-700">{{ block.title }}</h3>

    <template v-if="block.type === 'table'">
      <div v-if="block.rows.length === 0 && block.empty" class="rounded-lg border border-base-200 bg-base-50 p-6 text-center text-sm text-base-400">
        {{ block.empty }}
      </div>

      <div v-else-if="block.rows.length > 0" class="text-sm" :style="gridStyle">
        <div
          :class="[gridClass, responsive ? 'hidden md:grid' : '']"
          class="gap-x-4 border-b border-base-200 pb-2 text-xs font-semibold uppercase tracking-wide text-base-400"
        >
          <span
            v-for="(column, index) in block.columns"
            :key="index"
            :class="index > 0 && column.align !== 'left' ? 'text-right' : ''"
          >{{ column.label }}</span>
        </div>

        <ul>
          <li v-for="row in block.rows" :key="row.key">
            <component
              :is="row.filter ? 'button' : 'div'"
              :type="row.filter ? 'button' : undefined"
              class="block w-full border-b border-base-100 py-2 text-left"
              :class="[
                row.filter ? 'cursor-pointer px-1 transition-colors hover:bg-base-50' : '',
                row.selected ? 'bg-accent-50' : '',
              ]"
              @click="row.filter && emit('filter', row.filter)"
            >
              <div :class="gridClass" class="gap-x-4 gap-y-1">
                <span :class="responsive ? 'col-span-2 md:col-span-1' : ''" class="flex min-w-0 items-center gap-2 font-medium text-base-800">
                  <PageEventsPlanningCashRegisterViewCell :cell="cellAt(row.cells, 0)" class="truncate" />
                  <CommonStatusBadge v-if="row.badge" :label="row.badge.label" :tone="VIEW_TONE_BADGE[row.badge.tone ?? 'muted']" />
                </span>
                <span
                  v-for="index in restIndexes"
                  :key="index"
                  :class="cellClass(index)"
                >
                  <span v-if="responsive" class="text-base-500 md:hidden">{{ block.columns[index]?.label }}: </span>
                  <PageEventsPlanningCashRegisterViewCell :cell="cellAt(row.cells, index)" />
                </span>
              </div>
              <p v-if="row.note" class="mt-1 text-xs text-base-400">{{ row.note }}</p>
              <div v-if="row.bar !== undefined" class="mt-1 h-2 rounded-full bg-base-100">
                <div class="h-2 rounded-full bg-accent-400" :style="{ width: `${row.bar}%` }"></div>
              </div>
            </component>
          </li>
        </ul>

        <div v-if="block.footer" :class="gridClass" class="gap-x-4 gap-y-1 pt-2 font-semibold text-base-700">
          <span :class="responsive ? 'col-span-2 md:col-span-1' : ''">
            <PageEventsPlanningCashRegisterViewCell :cell="cellAt(block.footer, 0)" />
          </span>
          <span v-for="index in restIndexes" :key="index" :class="cellClass(index)">
            <span v-if="responsive && cellAt(block.footer, index) !== null" class="font-normal text-base-500 md:hidden">{{ block.columns[index]?.label }}: </span>
            <PageEventsPlanningCashRegisterViewCell :cell="cellAt(block.footer, index)" />
          </span>
        </div>
      </div>
    </template>

    <dl v-else-if="block.type === 'list'" class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      <template v-for="(item, index) in block.items" :key="index">
        <dt :class="listLabelClass(item)">{{ item.label }}</dt>
        <dd class="text-right" :class="listValueClass(item)">
          <PageEventsPlanningCashRegisterViewCell :cell="item.value" />
        </dd>
      </template>
    </dl>

    <div v-else-if="block.type === 'metric'" class="border-t border-base-200 pt-3">
      <p v-if="block.label" class="text-sm font-semibold text-base-700">{{ block.label }}</p>
      <p class="mt-1 text-2xl font-semibold" :class="VIEW_TONE_TEXT[block.tone ?? 'default']">
        <PageEventsPlanningCashRegisterViewCell :cell="block.value" />
      </p>
      <p v-if="block.caption" class="mt-1 text-xs text-base-400">{{ block.caption }}</p>
    </div>

    <PageEventsPlanningCashRegisterHourlyChart
      v-else-if="block.type === 'hourlyChart'"
      :points="block.points"
      :value-format="block.valueFormat"
      :empty="block.empty"
    />

    <p
      v-else-if="block.type === 'text'"
      :class="[
        block.style === 'note' ? 'text-xs' : 'text-sm',
        block.tone ? VIEW_TONE_TEXT[block.tone] : block.style === 'note' ? 'text-base-400' : 'text-base-600',
      ]"
    >
      {{ block.text }}
    </p>

    <p v-for="(note, index) in blockNotes" :key="index" class="mt-3 text-xs text-base-400">{{ note }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ViewBlock, ViewCell, ViewFilterAction, ViewListItem } from '~/shared/cashRegisterView'

const props = defineProps<{
  block: ViewBlock
}>()

const emit = defineEmits<{
  (e: 'filter', action: ViewFilterAction): void
}>()

const columnCount = computed(() => props.block.type === 'table' ? props.block.columns.length : 0)
// Up to three columns fit a phone as a plain table; wider tables stack each
// row below the md breakpoint with the column label in front of every value.
const responsive = computed(() => columnCount.value > 3)
const restIndexes = computed(() => Array.from({ length: Math.max(0, columnCount.value - 1) }, (_, index) => index + 1))

const gridStyle = computed(() => {
  const rest = columnCount.value - 1
  return { '--view-cols': rest > 0 ? `minmax(0,1fr) repeat(${rest}, ${responsive.value ? '7rem' : '5.5rem'})` : 'minmax(0,1fr)' }
})
const gridClass = computed(() => responsive.value
  ? 'grid grid-cols-2 md:[grid-template-columns:var(--view-cols)]'
  : 'grid [grid-template-columns:var(--view-cols)]')

const blockNotes = computed(() => 'notes' in props.block ? props.block.notes ?? [] : [])

function cellAt(cells: ViewCell[], index: number): ViewCell {
  return cells[index] ?? null
}

function cellClass(index: number) {
  const column = props.block.type === 'table' ? props.block.columns[index] : undefined
  if (column?.align === 'left') return 'text-base-600'
  // Stacked rows alternate left/right so the label–value pairs read as two columns.
  if (responsive.value) return index % 2 === 1 ? 'text-base-600 md:text-right' : 'text-right text-base-600'
  return 'text-right text-base-600'
}

function listLabelClass(item: ViewListItem) {
  const tone = item.tone ? VIEW_TONE_TEXT[item.tone] : ''
  if (item.style === 'strong') return ['font-semibold', tone || 'text-base-700']
  if (item.style === 'indent') return ['pl-4', tone || 'text-base-400']
  if (item.style === 'muted') return [tone || 'text-base-400']
  return [tone || 'text-base-500']
}

function listValueClass(item: ViewListItem) {
  const tone = item.tone ? VIEW_TONE_TEXT[item.tone] : ''
  if (item.style === 'strong') return ['font-semibold', tone || 'text-base-900']
  if (item.style === 'indent' || item.style === 'muted') return [tone || 'text-base-500']
  return [tone || 'text-base-700']
}
</script>
