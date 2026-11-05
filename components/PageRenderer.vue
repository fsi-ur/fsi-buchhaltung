<template>
  <div class="w-full">
    <component
      v-if="loaded"
      :is="currentComponent"
      :key="componentKey"
      @open-menu="$emit('openMenu')"
    />
  </div>
</template>

<script setup lang="ts">
import { usePage } from '~/composables/usePage'
import { useAuth } from '~/composables/useAuth'
import { useViewAsSimulation } from '~/composables/useViewAsSimulation'
import { PAGES } from '~/config/pages'

import LoginPage from '~/components/Page/Login.vue'
import ChangePasswordRequiredPage from '~/components/Page/ChangePasswordRequired.vue'

const emit = defineEmits<{
  (e: 'openMenu'): void
}>()

const { currentPage } = usePage()
const { user, fetchSession, hasPermission, hasAllPermissions } = useAuth()
const { restore: restoreViewAsSimulation } = useViewAsSimulation()
const { refreshKey } = useAppRefresh()

const loaded = ref(false)

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && user.value) fetchSession()
}

onMounted(async () => {
  await fetchSession()
  restoreViewAsSimulation()
  loaded.value = true

  watch(currentPage, async () => {
    if (user.value) await fetchSession()
  })

  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

const currentComponent = computed(() => {
  const page = Object.hasOwn(PAGES, currentPage.value) ? PAGES[currentPage.value] : undefined
  if (!page) return LoginPage
  if (page.allowGuest) return page.component
  if (!user.value) return LoginPage
  if (user.value.must_change_password) return ChangePasswordRequiredPage
  if (!page.permissions.length) return page.component
  if (page.requireAllPermissions ? hasAllPermissions(page.permissions) : hasPermission(page.permissions)) {
    return page.component
  }
  
  return LoginPage
})

const componentKey = computed(() => {
  const page = Object.hasOwn(PAGES, currentPage.value) ? PAGES[currentPage.value] : undefined
  if (page?.preserveOnRefresh) return currentPage.value

  return `${currentPage.value}:${refreshKey.value}`
})
</script>
