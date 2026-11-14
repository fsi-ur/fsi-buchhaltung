<template>
  <Page no-help @open-menu="$emit('openMenu')">
    <template #cards>
      <div class="col-span-12 flex justify-center">
        <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-lg space-y-4 text-center">
          <Icon :name="icon" class="mx-auto h-12 w-12 text-base-400" aria-hidden="true" />
          <div>
            <h2 class="text-xl font-semibold">{{ t(`pageError.${reason}.title`) }}</h2>
            <p class="mt-1 text-sm text-base-600">{{ t(`pageError.${reason}.text`) }}</p>
          </div>
          <button v-if="fallbackPage" type="button" class="btn-primary" @click="setPage(fallbackPage)">
            {{ t('pageError.goToStart') }}
          </button>
        </div>
      </div>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'

const props = defineProps<{
  reason: 'notFound' | 'forbidden'
}>()

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const { setPage } = usePage()
const { firstAccessiblePage } = usePageAccess()

const icon = computed(() => props.reason === 'notFound' ? 'material-symbols:search-off-rounded' : 'material-symbols:lock-outline')
const fallbackPage = computed(() => firstAccessiblePage())
</script>
