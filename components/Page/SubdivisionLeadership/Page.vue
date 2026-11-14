<template>
  <Page :headline1="headline" :flush-header-with-cards="tabs.length > 1" @open-menu="$emit('openMenu')">
    <template v-if="tabs.length > 1" #header="{ headerContainerRef, headlineGroupRef }">
      <CommonTabOverview
        v-model="currentTab"
        :tabs="tabs"
        :header-container-ref="headerContainerRef"
        :headline-group-ref="headlineGroupRef"
      />
    </template>

    <template #cards>
      <CommonCard v-if="loading && !subdivisions.length">
        <p class="text-sm text-base-500">{{ t('subdivisionLeadership.loading') }}</p>
      </CommonCard>

      <CommonCard v-else-if="!subdivisions.length">
        <p class="text-sm text-base-500">{{ t('subdivisionLeadership.empty') }}</p>
      </CommonCard>

      <PageSubdivisionLeadershipPanel
        v-else-if="currentSubdivision"
        :key="currentSubdivision.id"
        :subdivision="currentSubdivision"
        :assignable-positions="assignablePositions"
        @changed="load"
      />
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { usePage } from '~/composables/usePage'
import { useAuth } from '~/composables/useAuth'
import type { GetLeadershipResponse } from '~/server/api/subdivision-leadership/index.get'
import type { LeadershipPositionOption, LeadershipSubdivision } from '~/types/subdivisionLeadership'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { pageMeta, setPage } = usePage()
const { hasPermission } = useAuth()

const subdivisions = ref<LeadershipSubdivision[]>([])
const assignablePositions = ref<LeadershipPositionOption[]>([])
const loading = ref(true)
const currentTab = useState<string>('subdivision-leadership-tab', () => '')

const tabs = computed(() => subdivisions.value.map(subdivision => ({
  key: String(subdivision.id),
  label: subdivision.name,
})))

const currentSubdivision = computed(() => subdivisions.value.find(subdivision => String(subdivision.id) === currentTab.value)
  ?? subdivisions.value[0]
  ?? null)

// One subdivision: the page is about that subdivision, so it carries its name.
const headline = computed(() => {
  if (subdivisions.value.length === 1) return subdivisions.value[0]!.name
  return hasPermission('subdivisions.leadership.view')
    ? t('subdivisionLeadership.titleAll')
    : t('subdivisionLeadership.title')
})

async function load() {
  loading.value = true
  try {
    const res = await apiFetch<GetLeadershipResponse>('/api/subdivision-leadership')
    if (!res.ok) {
      toast.error(t('subdivisionLeadership.loadFailed'))
      return
    }
    subdivisions.value = res.subdivisions
    assignablePositions.value = res.assignable_positions
  } catch (error) {
    console.error(error)
    toast.error(t('subdivisionLeadership.loadFailed'))
  } finally {
    loading.value = false
  }
}

watch([tabs, () => pageMeta.value?.subdivisionId], ([available, requested]) => {
  const requestedKey = requested ? String(requested) : ''
  if (requestedKey && available.some(tab => tab.key === requestedKey)) {
    currentTab.value = requestedKey
    return
  }
  if (!available.some(tab => tab.key === currentTab.value)) currentTab.value = available[0]?.key ?? ''
}, { immediate: true })

watch(currentTab, (tab) => {
  if (!tab || String(pageMeta.value?.subdivisionId ?? '') === tab) return
  setPage('SubdivisionLeadership', { subdivisionId: Number(tab) })
})

onMounted(load)
useAppRefresh().onRefresh(load)
</script>
