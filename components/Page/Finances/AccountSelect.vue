<template>
  <MenuDropdown v-model="openId" :id="dropdownId" :disabled="disabled" :wrapper-class="wrapperClass">
    <template #trigger="{ styling }">
      <button
        type="button"
        :class="[styling, 'min-w-0', disabled ? '' : 'cursor-pointer']"
        :disabled="disabled"
        :aria-label="ariaLabel"
      >
        <span class="truncate" :class="selected || allLabel ? '' : 'text-base-400'">
          {{ selected ? optionLabel(selected) : (allLabel || placeholder) }}
        </span>
        <Icon v-if="!disabled" name="material-symbols:keyboard-arrow-down-rounded" class="shrink-0 text-lg text-base-400" />
      </button>
    </template>

    <template #default="{ styling }">
      <button
        v-if="allLabel"
        type="button"
        :class="[styling, !modelValue ? 'font-medium text-link-600' : '']"
        @click="select(null)"
      >
        {{ allLabel }}
      </button>
      <button
        v-for="account in accounts"
        :key="account.id"
        type="button"
        :class="[styling, account.id === modelValue ? 'font-medium text-link-600' : '']"
        @click="select(account.id)"
      >
        <span class="truncate">{{ optionLabel(account) }}</span>
      </button>
      <p v-if="!accounts.length" class="px-3 py-2 text-sm text-base-500">{{ t('settings.financeAccounts.none') }}</p>
    </template>
  </MenuDropdown>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { FinanceAccountOption } from '~/types/financeAccount'

/** Picks one of the association's own accounts; archived ones are marked as such. */
const props = withDefaults(defineProps<{
  modelValue: number | null
  accounts: FinanceAccountOption[]
  placeholder?: string
  /** Adds a first option meaning "no restriction" (emits null) — for filters. */
  allLabel?: string
  disabled?: boolean
  ariaLabel?: string
  wrapperClass?: string
}>(), {
  placeholder: '',
  allLabel: '',
  disabled: false,
  ariaLabel: undefined,
  wrapperClass: 'relative w-full',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
}>()

const { t } = useI18n()
const openId = ref<string | number | null>(null)
const dropdownId = useId() ?? 'account-select'

const selected = computed(() => props.accounts.find(account => account.id === props.modelValue) ?? null)

function optionLabel(account: FinanceAccountOption) {
  return account.archived ? `${account.name} (${t('settings.financeAccounts.archived')})` : account.name
}

function select(id: number | null) {
  openId.value = null
  emit('update:modelValue', id)
}
</script>
