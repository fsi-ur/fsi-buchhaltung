<template>
  <div class="w-full">
    <component
      v-if="loaded"
      :is="currentComponent"
      v-bind="currentProps"
      :key="componentKey"
      @open-menu="$emit('openMenu')"
    />
  </div>
</template>

<script setup lang="ts">
import { usePage } from '~/composables/usePage'
import { useAuth } from '~/composables/useAuth'
import { useViewAsSimulation } from '~/composables/useViewAsSimulation'
import type { Component } from 'vue'

import LoginPage from '~/components/Page/Login.vue'
import ChangePasswordRequiredPage from '~/components/Page/ChangePasswordRequired.vue'
import ErrorPage from '~/components/Page/Error.vue'

const emit = defineEmits<{
  (e: 'openMenu'): void
}>()

const { currentPage } = usePage()
const { user, fetchSession } = useAuth()
const { findPage, canOpenPage } = usePageAccess()
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

const resolved = computed<{ component: Component; props?: Record<string, unknown> }>(() => {
  const page = findPage(currentPage.value)
  if (page?.allowGuest) return { component: page.component }
  if (!user.value) return { component: LoginPage }
  if (user.value.must_change_password) return { component: ChangePasswordRequiredPage }
  if (!page) return { component: ErrorPage, props: { reason: 'notFound' } }
  if (canOpenPage(page)) return { component: page.component }
  return { component: ErrorPage, props: { reason: 'forbidden' } }
})

const currentComponent = computed(() => resolved.value.component)
const currentProps = computed(() => resolved.value.props ?? {})

const componentKey = computed(() => {
  const page = findPage(currentPage.value)
  if (page?.preserveOnRefresh) return currentPage.value

  return `${currentPage.value}:${refreshKey.value}`
})
</script>
