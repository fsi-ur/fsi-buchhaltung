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
import type { GetRecordAuditResponse } from '~/server/api/audit/record.get'

const props = withDefaults(defineProps<{
  table: string
  recordId: number | string
  /** false to show only this record's own field changes, without auto-including parent-linked child tables. */
  includeChildren?: boolean
}>(), {
  includeChildren: true,
})

const toast = useToast()
const groups = ref<AuditGroup[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const res = await apiFetch<GetRecordAuditResponse>('/api/audit/record', {
      query: { table: props.table, id: props.recordId, includeChildren: String(props.includeChildren) },
    })
    if (res.ok) groups.value = res.groups
    else toast.error(res.error)
  } finally {
    loading.value = false
  }
}

watch(() => [props.table, props.recordId, props.includeChildren], load)
onMounted(load)
</script>
