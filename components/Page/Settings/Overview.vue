<template>
  <Page :headline1="t('settings.title')" :flush-header-with-cards="tabs.length > 1" :help-section="currentTab" @open-menu="$emit('openMenu')">
    <template v-if="tabs.length > 1" #header="{ headerContainerRef, headlineGroupRef }">
      <CommonTabOverview
        v-model="currentTab"
        :tabs="tabs"
        :header-container-ref="headerContainerRef"
        :headline-group-ref="headlineGroupRef"
      />
    </template>

    <template #cards>
      <component :is="activeComponent" />
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import SettingsGeneral from './General.vue'
import SettingsAssociation from './Association.vue'
import SettingsSpheres from './Spheres.vue'
import SettingsCostCentres from './CostCentres.vue'
import SettingsSubdivisions from './Subdivisions.vue'
import SettingsPositions from './Positions.vue'
import SettingsPermissions from './Permissions.vue'
import SettingsUsers from './Users.vue'
import SettingsApp from './App.vue'
import SettingsNotifications from './Notifications.vue'
import SettingsAppointmentTypes from './AppointmentTypes.vue'
import SettingsDocuments from './Documents.vue'
import SettingsAuditLog from './AuditLog.vue'
import { useAuth } from '~/composables/useAuth'
import { usePage } from '~/composables/usePage'
import { SETTINGS_TABS } from '~/config/settingsTabs'

defineEmits<{
  (e: 'openMenu'): void
}>()

type SettingsTab = 'general' | 'association' | 'spheres' | 'costCentres' | 'subdivisions' | 'positions' | 'appointmentTypes' | 'users' | 'permissions' | 'app' | 'notifications' | 'documents' | 'audit'

const currentTab = useState<SettingsTab>('settings-overview-current-tab', () => 'general')
const { t } = useI18n()
const { hasPermission } = useAuth()
const { pageMeta, setPage } = usePage()

const tabs = computed(() => SETTINGS_TABS
  .filter(tab => !tab.permission || hasPermission(tab.permission))
  .map(tab => ({ key: tab.key, label: t(tab.labelKey) })))

const activeComponent = computed(() => {
  switch (currentTab.value) {
    case 'general':
      return SettingsGeneral
    case 'spheres':
      return SettingsSpheres
    case 'association':
      return SettingsAssociation
    case 'costCentres':
      return SettingsCostCentres
    case 'subdivisions':
      return SettingsSubdivisions
    case 'positions':
      return SettingsPositions
    case 'appointmentTypes':
      return SettingsAppointmentTypes
    case 'users':
      return SettingsUsers
    case 'permissions':
      return SettingsPermissions
    case 'app':
      return SettingsApp
    case 'notifications':
      return SettingsNotifications
    case 'documents':
      return SettingsDocuments
    case 'audit':
      return SettingsAuditLog
    default:
      return SettingsGeneral
  }
})

watch([tabs, () => pageMeta.value?.tab, () => pageMeta.value?.resetTabKey], ([available, requestedTab, resetTabKey]) => {
  const requested = requestedTab as SettingsTab | undefined
  if (requested && available.find(tab => tab.key === requested)) {
    currentTab.value = requested
    return
  }

  if (resetTabKey && available[0]?.key) {
    currentTab.value = available[0].key as SettingsTab
    return
  }

  if (!available.find(tab => tab.key === currentTab.value)) {
    currentTab.value = 'general'
  }
}, { immediate: true })

watch(currentTab, (tab) => {
  if (pageMeta.value?.tab === tab) return
  setPage('Settings', { tab })
}, { immediate: true })
</script>
