<template>
  <div>
    <PageAuditTimeline
      :groups="groups"
      :loading="loading"
      :has-more="false"
      hide-open-page
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useToast } from '~/composables/useToast'
import type { AuditGroup } from '~/types/audit'
import type { GetScopedAuditResponse } from '~/server/api/audit/scoped.get'

const props = defineProps<{
  tables: string[]
  parentId: number | string
}>()

const toast = useToast()
const groups = ref<AuditGroup[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch<GetScopedAuditResponse>('/api/audit/scoped', {
      query: { tables: props.tables.join(','), parentId: props.parentId },
    })
    if (res.ok) groups.value = res.groups
    else toast.error(res.error)
  } finally {
    loading.value = false
  }
}

watch(() => [props.tables.join(','), props.parentId], load)
onMounted(load)
</script>
