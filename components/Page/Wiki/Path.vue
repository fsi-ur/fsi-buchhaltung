<template>
  <Page :headline1="path?.title ?? t('wiki.path.title')" @open-menu="$emit('openMenu')">
    <template #header>
      <div class="flex flex-1 flex-wrap justify-end gap-2">
        <button type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="goToReturnTarget()">
          <Icon name="material-symbols:arrow-back-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.article.backToWiki') }}
        </button>
        <button
          v-if="path?.nextItem"
          type="button"
          class="btn-primary inline-flex items-center gap-1.5"
          @click="openItem(path.nextItem)"
        >
          <Icon name="material-symbols:play-arrow-rounded" class="text-base" aria-hidden="true" />
          {{ path.doneCount ? t('wiki.path.continue') : t('wiki.path.start') }}
        </button>
      </div>
    </template>

    <template #cards>
      <div class="-mx-6 space-y-5 bg-white p-4 shadow-sm col-span-12 sm:mx-0 sm:rounded-xl sm:p-6 sm:shadow-lg">
        <CommonValidationSummary
          v-if="error"
          :errors="[error]"
          :title="t('common.validationBlocked')"
        />

        <p v-if="loading" class="text-sm text-base-500">{{ t('wiki.loading') }}</p>

        <template v-else-if="path">
          <div class="flex items-start gap-3">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
              <Icon :name="path.icon" class="text-2xl" aria-hidden="true" />
            </span>
            <div class="min-w-0">
              <p v-if="path.description" class="max-w-[70ch] text-base leading-relaxed text-base-600">{{ path.description }}</p>
              <p v-if="!path.isPublished" class="mt-1 inline-flex items-center gap-1 text-xs text-warning-700">
                <Icon name="material-symbols:visibility-off-outline-rounded" class="text-sm" aria-hidden="true" />
                {{ t('wiki.path.unpublished') }}
              </p>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between text-sm">
              <span class="font-medium text-base-700">
                {{ t('wiki.path.progress', { done: path.doneCount, total: path.totalCount }) }}
              </span>
              <span v-if="isComplete" class="inline-flex items-center gap-1 font-medium text-success-700">
                <Icon name="material-symbols:check-circle-rounded" class="text-base" aria-hidden="true" />
                {{ t('wiki.path.completed') }}
              </span>
              <span v-else class="font-semibold text-base-500">{{ progressPercent }} %</span>
            </div>
            <div
              class="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-base-200"
              role="progressbar"
              :aria-valuenow="progressPercent"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="t('wiki.path.progress', { done: path.doneCount, total: path.totalCount })"
            >
              <div
                class="h-full rounded-full transition-all"
                :class="isComplete ? 'bg-success-500' : 'bg-accent-500'"
                :style="{ width: `${progressPercent}%` }"
              ></div>
            </div>
          </div>

          <p v-if="!path.items.length" class="text-sm text-base-500">{{ t('wiki.path.empty') }}</p>

          <ol v-else class="space-y-2">
            <li v-for="(item, position) in path.items" :key="item.id">
              <label
                class="flex cursor-pointer flex-wrap items-start gap-3 rounded-xl border p-3 transition-colors"
                :class="item.done
                  ? 'border-success-200 bg-success-50/50 hover:border-success-300'
                  : 'border-base-200 hover:border-accent-300 hover:bg-accent-50/40'"
              >
                <span
                  class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  :class="item.done ? 'bg-success-100 text-success-700' : 'bg-base-100 text-base-500'"
                  aria-hidden="true"
                >
                  <Icon v-if="item.done" name="material-symbols:check-rounded" class="text-base" />
                  <template v-else>{{ position + 1 }}</template>
                </span>

                <input
                  type="checkbox"
                  class="checkbox mt-0.5"
                  :checked="item.done"
                  :aria-label="t('wiki.path.markDone')"
                  @change="toggle(item, ($event.target as HTMLInputElement).checked)"
                />

                <span class="min-w-0 flex-1">
                  <span class="block text-xs text-base-500">
                    {{ t('wiki.path.step', { number: position + 1 }) }} · {{ item.spaceTitle }}
                  </span>
                  <span class="block font-medium" :class="item.done ? 'text-base-500' : 'text-base-900'">{{ item.title }}</span>
                  <span v-if="item.note" class="mt-0.5 block text-sm leading-relaxed text-base-600">{{ item.note }}</span>
                  <span v-else-if="item.summary" class="mt-0.5 block text-sm leading-relaxed text-base-600">{{ item.summary }}</span>
                  <span v-if="item.done && item.completedAt" class="mt-1 block text-xs text-success-700">
                    {{ t('wiki.path.doneAt', { date: formatDate(item.completedAt) }) }}
                  </span>
                </span>

                <button type="button" class="btn-secondary inline-flex shrink-0 items-center gap-1.5" @click="openItem(item)">
                  {{ t('wiki.checklist.open') }}
                  <Icon name="material-symbols:arrow-forward-rounded" class="text-base" aria-hidden="true" />
                </button>
              </label>
            </li>
          </ol>
        </template>
      </div>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { buildReturnTarget, useReturnTarget } from '~/composables/useReturnTarget'
import { useToast } from '~/composables/useToast'
import type { WikiPathDetailResponse } from '~/server/api/wiki/paths/[id].get'
import type { WikiPathItemView, WikiPathView } from '~/types/wiki'

defineEmits<{
  (e: 'openMenu'): void
}>()

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const { pageMeta, setPage } = usePage()
const { goToReturnTarget } = useReturnTarget('Wiki')
const toast = useToast()

const pathId = computed(() => (pageMeta.value?.pathId ? Number(pageMeta.value.pathId) : null))

const path = ref<WikiPathView | null>(null)
const loading = ref(true)
const error = ref('')

const isComplete = computed(() => !!path.value && path.value.totalCount > 0 && path.value.doneCount === path.value.totalCount)
const progressPercent = computed(() => {
  if (!path.value?.totalCount) return 0
  return Math.round((path.value.doneCount / path.value.totalCount) * 100)
})

function openItem(item: WikiPathItemView) {
  setPage('WikiArticle', {
    articleId: item.articleId,
    pathId: pathId.value,
    returnTarget: buildReturnTarget('WikiPath', { pathId: pathId.value }),
  })
}

async function toggle(item: WikiPathItemView, done: boolean) {
  if (pathId.value === null) return

  const res = await $fetch<{ ok: boolean, error?: string }>(`/api/wiki/paths/${pathId.value}/progress`, {
    method: 'POST',
    body: { itemId: item.id, done },
  })

  if (!res.ok) {
    toast.error(res.error ?? t('wiki.errors.saveFailed'))
    await load()
    return
  }

  await load()
  if (isComplete.value) toast.success(t('wiki.path.completedToast'))
}

async function load() {
  if (pathId.value === null) {
    error.value = t('wiki.path.notFound')
    loading.value = false
    return
  }

  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<WikiPathDetailResponse>(`/api/wiki/paths/${pathId.value}`)
    if (!res.ok) {
      error.value = res.error
      path.value = null
      return
    }
    path.value = res.path
  } catch {
    error.value = t('wiki.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

load()

useAppRefresh().onRefresh(load)
</script>
