<template>
  <div class="space-y-4">
    <div class="rounded-lg bg-base-50 p-3 text-sm">
      <p class="font-semibold text-base-800">{{ t('wiki.access.summary') }}</p>
      <p class="text-base-700">{{ readSummary }}</p>
      <p v-if="writeSummary" class="text-base-700">{{ writeSummary }}</p>
    </div>

    <p v-if="!canManage" class="text-sm text-base-500">{{ t('wiki.access.readOnlyHint') }}</p>

    <PageWikiArticleAccessSubjectSelect v-if="canManage" :max-level="maxLevel" @add="addGrant" />

    <p v-if="!grants.length" class="text-sm text-base-500">{{ t('wiki.access.empty') }}</p>

    <ul v-else class="space-y-2">
      <li
        v-for="grant in sortedGrants"
        :key="grant.id"
        :class="[
          'flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm',
          grant.inherited ? 'border-base-200 bg-base-50 text-base-500' : 'border-base-200',
        ]"
      >
        <div class="min-w-0">
          <p class="font-medium">
            {{ t(`wiki.access.subjectTypes.${grant.subject_type}`) }}: {{ subjectLabel(grant) }}
          </p>
          <p class="text-xs">
            {{ t(`wiki.access.levels.${grant.access_level}`) }}
            <template v-if="grant.include_descendants"> · {{ t('wiki.access.includeDescendants') }}</template>
            <template v-if="grant.inherited"> · {{ t('wiki.access.inheritedFrom', { origin: grant.origin_label }) }}</template>
            <template v-if="grant.owner_derived"> · {{ t('wiki.access.ownerDerived') }}</template>
          </p>
        </div>

        <button
          v-if="canManage && !grant.inherited && !grant.owner_derived"
          type="button"
          class="btn-secondary"
          @click="confirmRemoval = grant.id"
        >
          {{ t('wiki.access.remove') }}
        </button>
      </li>
    </ul>

    <CommonModal
      :model-value="confirmRemoval !== null"
      :title="t('wiki.access.removeConfirmTitle')"
      @update:model-value="confirmRemoval = null"
    >
      <p class="text-sm text-base-700">{{ t('wiki.access.removeConfirmText') }}</p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" @click="confirmRemoval = null">{{ t('wiki.editor.cancel') }}</button>
          <button type="button" class="btn-primary" @click="removeGrant">{{ t('wiki.access.remove') }}</button>
        </div>
      </template>
    </CommonModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { PERMISSIONS } from '~/config/permissions'
import type { GrantView } from '~/server/utils/wiki/grants'
import type { WikiScopeAccessResponse } from '~/server/api/wiki/articles/[id]/access.get'
import type { WikiAccessLevel, WikiGrantSubjectType, WikiScopeType } from '~/types/wiki'

const props = defineProps<{
  scopeType: WikiScopeType
  scopeId: number
}>()

const { t } = useI18n()
const toast = useToast()

const grants = ref<GrantView[]>([])
const canManage = ref(false)
const accessLevel = ref<WikiAccessLevel>('read')
const confirmRemoval = ref<number | null>(null)

const permissionLabels = new Map(PERMISSIONS.map(permission => [permission.key as string, permission.labelKey]))

const maxLevel = computed(() => accessLevel.value)

const sortedGrants = computed(() =>
  [...grants.value].sort((a, b) => Number(b.inherited) - Number(a.inherited)),
)

function subjectLabel(grant: GrantView) {
  if (grant.subject_type !== 'permission') return grant.subject_label
  const labelKey = permissionLabels.get(grant.subject_key)
  return labelKey ? `${t(labelKey)} (${grant.subject_key})` : grant.subject_key
}

function summaryFor(levels: WikiAccessLevel[]) {
  const names = grants.value
    .filter(grant => levels.includes(grant.access_level))
    .map(grant => subjectLabel(grant))
  return [...new Set(names)]
}

const readSummary = computed(() => {
  if (!grants.value.length) return t('wiki.access.summaryOpen')
  const names = summaryFor(['read', 'write', 'admin'])
  return names.length
    ? t('wiki.access.summaryRestricted', { subjects: names.join(', ') })
    : t('wiki.access.summaryNone')
})

const writeSummary = computed(() => {
  const names = summaryFor(['write', 'admin'])
  return names.length ? t('wiki.access.summaryWrite', { subjects: names.join(', ') }) : ''
})

const endpoint = computed(() => props.scopeType === 'space'
  ? `/api/wiki/spaces/${props.scopeId}/access`
  : `/api/wiki/articles/${props.scopeId}/access`)

async function load() {
  if (!props.scopeId) return
  const res = await apiFetch<WikiScopeAccessResponse>(endpoint.value)
  if (!res.ok) {
    grants.value = []
    canManage.value = false
    return
  }
  grants.value = res.grants
  canManage.value = res.canManage
  accessLevel.value = res.accessLevel
}

async function addGrant(grant: {
  subjectType: WikiGrantSubjectType
  subjectId: number
  subjectKey: string
  accessLevel: WikiAccessLevel
  includeDescendants: boolean
}) {
  const res = await apiFetch<{ ok: boolean, error?: string }>('/api/wiki/access/grant', {
    method: 'POST',
    body: { scopeType: props.scopeType, scopeId: props.scopeId, ...grant },
  })

  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    return
  }

  toast.success(t('wiki.access.addedToast'))
  await load()
}

async function removeGrant() {
  const grantId = confirmRemoval.value
  confirmRemoval.value = null
  if (!grantId) return

  const res = await apiFetch<{ ok: boolean, error?: string }>(`/api/wiki/access/${grantId}`, { method: 'DELETE' })
  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    return
  }

  toast.success(t('wiki.access.removedToast'))
  await load()
}

watch(() => [props.scopeType, props.scopeId], load, { immediate: true })
</script>
