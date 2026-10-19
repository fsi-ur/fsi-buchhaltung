<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-end gap-2">
      <div class="field min-w-36">
        <label :for="`${id}-type`">{{ t('wiki.access.subjectTypes.user') }} / {{ t('wiki.access.subjectTypes.role') }}</label>
        <MenuDropdown :id="`${id}-type`" v-model="openDropdown">
          <template #trigger="{ styling }">
            <button type="button" :class="[styling, 'cursor-pointer']">
              <span class="truncate">{{ t(`wiki.access.subjectTypes.${subjectType}`) }}</span>
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
            </button>
          </template>
          <template #default="{ styling }">
            <button
              v-for="type in availableTypes"
              :key="type"
              type="button"
              :class="styling"
              @click="selectSubjectType(type)"
            >
              {{ t(`wiki.access.subjectTypes.${type}`) }}
            </button>
          </template>
        </MenuDropdown>
      </div>

      <div class="field min-w-56 flex-1">
        <label>{{ t('wiki.access.add') }}</label>
        <CommonSearchSelect
          :model-value="queryText"
          :options="options"
          :placeholder="t('wiki.access.subjectPlaceholder')"
          :empty-text="t('wiki.search.empty')"
          :selected-label="selectedLabel"
          @update:model-value="onQuery"
          @select="onSelect"
          @clear-selection="clearSelection"
        />
      </div>

      <div class="field min-w-36">
        <label :for="`${id}-level`">{{ t('wiki.access.levels.read') }}</label>
        <MenuDropdown :id="`${id}-level`" v-model="openDropdown">
          <template #trigger="{ styling }">
            <button type="button" :class="[styling, 'cursor-pointer']">
              <span class="truncate">{{ t(`wiki.access.levels.${accessLevel}`) }}</span>
              <Icon name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
            </button>
          </template>
          <template #default="{ styling }">
            <button
              v-for="level in levels"
              :key="level"
              type="button"
              :class="styling"
              @click="selectAccessLevel(level)"
            >
              {{ t(`wiki.access.levels.${level}`) }}
            </button>
          </template>
        </MenuDropdown>
      </div>
    </div>

    <!-- The option belongs to the grant being built, so it sits on its own line together with the
         action instead of floating between two full-height dropdowns. -->
    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-base-100 pt-3">
      <label class="flex cursor-pointer items-center gap-2 text-sm text-base-600">
        <input v-model="includeDescendants" type="checkbox" class="checkbox" />
        {{ t('wiki.access.includeDescendants') }}
      </label>

      <button
        type="button"
        class="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
        :disabled="!canAdd"
        @click="submit"
      >
        <Icon name="material-symbols:add-rounded" class="text-base" aria-hidden="true" />
        {{ t('wiki.access.add') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useAuth } from '~/composables/useAuth'
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { WikiSubjectOption, WikiSubjectOptionsResponse } from '~/server/api/wiki/access/subject-options.get'
import type { WikiAccessLevel, WikiGrantSubjectType } from '~/types/wiki'

const props = defineProps<{
  /** The highest level the current user may hand out â€” nobody may grant beyond their own (Â§4.3.3.5). */
  maxLevel: WikiAccessLevel
}>()

const emit = defineEmits<{
  (e: 'add', grant: {
    subjectType: WikiGrantSubjectType
    subjectId: number
    subjectKey: string
    accessLevel: WikiAccessLevel
    includeDescendants: boolean
  }): void
}>()

const { t } = useI18n()
const { hasPermission } = useAuth()

const id = useId()

const ALL_TYPES: WikiGrantSubjectType[] = ['user', 'role', 'position', 'subdivision', 'permission']
const LEVEL_ORDER: WikiAccessLevel[] = ['read', 'write', 'admin']

const availableTypes = computed(() => ALL_TYPES.filter(type => (type !== 'user' && type !== 'role') || hasPermission('users.view')))
const levels = computed(() => LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(props.maxLevel) + 1))

const subjectType = ref<WikiGrantSubjectType>(availableTypes.value[0] ?? 'position')
const accessLevel = ref<WikiAccessLevel>('read')
const includeDescendants = ref(true)
const openDropdown = ref<string | null>(null)
const queryText = ref('')
const selectedLabel = ref('')
const selected = ref<WikiSubjectOption | null>(null)
const options = ref<SearchSelectOption<WikiSubjectOption>[]>([])

const canAdd = computed(() => Boolean(selected.value))

let timer: ReturnType<typeof setTimeout> | null = null

function label(option: WikiSubjectOption) {
  return option.type === 'permission' ? `${t(option.label)} (${option.key})` : option.label
}

async function load() {
  const res = await apiFetch<WikiSubjectOptionsResponse>('/api/wiki/access/subject-options', {
    query: { type: subjectType.value, q: queryText.value },
  })
  options.value = res.ok
    ? res.options.map(option => ({ key: `${option.type}:${option.id}:${option.key}`, label: label(option), value: option }))
    : []
}

function onQuery(value: string) {
  queryText.value = value
  selected.value = null
  selectedLabel.value = ''
  if (timer) clearTimeout(timer)
  timer = setTimeout(load, 250)
}

function onTypeChange() {
  selected.value = null
  selectedLabel.value = ''
  queryText.value = ''
  load()
}

function selectSubjectType(type: WikiGrantSubjectType) {
  subjectType.value = type
  openDropdown.value = null
  onTypeChange()
}

function selectAccessLevel(level: WikiAccessLevel) {
  accessLevel.value = level
  openDropdown.value = null
}

function onSelect(option: unknown) {
  const value = option as WikiSubjectOption
  selected.value = value
  selectedLabel.value = label(value)
  queryText.value = ''
}

function clearSelection() {
  selected.value = null
  selectedLabel.value = ''
  queryText.value = ''
}

function submit() {
  if (!selected.value) return
  emit('add', {
    subjectType: selected.value.type,
    subjectId: selected.value.id,
    subjectKey: selected.value.key,
    accessLevel: accessLevel.value,
    includeDescendants: includeDescendants.value,
  })
  clearSelection()
}

load()
</script>
