<template>
  <Page :headline1="headline" :flush-header-with-cards="tabs.length > 1" :help-section="currentTab" @open-menu="$emit('openMenu')">
    <template v-if="tabs.length > 1" #header="{ headerContainerRef, headlineGroupRef }">
      <CommonTabOverview
        v-model="currentTab"
        :tabs="tabs"
        :header-container-ref="headerContainerRef"
        :headline-group-ref="headlineGroupRef"
      />
    </template>

    <template #cards>
      <PageMembersListPanel v-if="currentTab === 'list'" />

      <div v-else-if="currentTab === 'myData'" class="col-span-12 xl:col-span-8 xl:col-start-3">
        <PageMembersSelfEditForm />
      </div>

      <div v-else-if="currentTab === 'fieldConfig'" class="col-span-12">
        <PageMembersFieldConfigPanel />
      </div>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useAuth } from '~/composables/useAuth'
import { usePage } from '~/composables/usePage'
import type { GetMemberSelfResponse } from '~/server/api/members/self/index.get'

defineEmits<{
  (e: 'openMenu'): void
}>()

type MembersTab = 'list' | 'myData' | 'fieldConfig'

const currentTab = useState<MembersTab>('members-overview-current-tab', () => 'list')
const { t } = useI18n()
const { hasPermission } = useAuth()
const { pageMeta, setPage } = usePage()

const hasLinkedMember = ref(false)

const tabs = computed(() => {
  const list = [
    { key: 'list', label: t('member.overviewTabs.list'), show: hasPermission('members.view') },
    { key: 'myData', label: t('member.overviewTabs.myData'), show: hasPermission('members.editOwnData') && hasLinkedMember.value },
    { key: 'fieldConfig', label: t('member.overviewTabs.fieldConfig'), show: hasPermission('members.configureSelfEditFields') || hasPermission('members.approveChanges') },
  ] as const
  return list.filter(tab => tab.show).map(({ show, ...rest }) => rest)
})

const headline = computed(() => {
  const only = tabs.value.length === 1 ? tabs.value[0] : undefined
  if (only?.key === 'myData') return t('member.myData.title')
  if (only?.key === 'fieldConfig') return t('member.overviewTabs.fieldConfig')
  return t('member.title')
})

onMounted(async () => {
  if (!hasPermission('members.editOwnData')) return
  const res = await apiFetch<GetMemberSelfResponse>('/api/members/self')
  hasLinkedMember.value = res.ok && Boolean(res.member)
})

watch([tabs, () => pageMeta.value?.tab], ([available, requestedTab]) => {
  const requested = requestedTab as MembersTab | undefined
  if (requested && available.find(tab => tab.key === requested)) {
    currentTab.value = requested
    return
  }

  if (!available.find(tab => tab.key === currentTab.value)) {
    currentTab.value = available[0]?.key ?? 'list'
  }
}, { immediate: true })

watch(currentTab, (tab) => {
  if (pageMeta.value?.tab === tab) return
  setPage('MemberList', { tab })
}, { immediate: true })
</script>
