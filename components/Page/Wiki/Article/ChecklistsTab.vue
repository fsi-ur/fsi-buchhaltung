<template>
  <div class="space-y-4">
    <p class="text-sm text-base-500">{{ t('wiki.checklist.editorHint') }}</p>
    <p v-if="readOnly" class="text-sm text-base-500">{{ t('wiki.editor.readOnly') }}</p>

    <CommonValidationSummary v-if="error" :errors="[error]" :title="t('common.validationBlocked')" />

    <p v-if="!drafts.length" class="text-sm text-base-500">{{ t('wiki.checklist.editorEmpty') }}</p>

    <div v-for="(draft, listIndex) in drafts" :key="draft.uid" class="space-y-3 rounded-xl border border-base-200 p-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="field">
          <label :for="`checklist-title-${draft.uid}`">{{ t('wiki.checklist.fields.title') }}</label>
          <input
            :id="`checklist-title-${draft.uid}`"
            v-model="draft.title"
            class="input"
            :disabled="readOnly"
            @input="onTitleInput(draft)"
          />
        </div>
        <div class="field">
          <label :for="`checklist-key-${draft.uid}`">{{ t('wiki.checklist.fields.keySlug') }}</label>
          <input
            :id="`checklist-key-${draft.uid}`"
            v-model="draft.keySlug"
            class="input"
            :disabled="readOnly"
            @input="draft.keyTouched = true"
          />
          <span class="text-xs text-base-500">{{ t('wiki.checklist.fields.keySlugHint') }}</span>
        </div>
        <div class="field">
          <label :for="`checklist-mode-${draft.uid}`">{{ t('wiki.checklist.fields.mode') }}</label>
          <MenuDropdown :id="`checklist-mode-${draft.uid}`" v-model="openMenu" :disabled="readOnly">
            <template #trigger="{ styling }">
              <button type="button" :class="[styling, !readOnly ? 'cursor-pointer' : '']" :disabled="readOnly">
                <span class="truncate">{{ t(`wiki.checklist.modes.${draft.mode}`) }}</span>
                <Icon v-if="!readOnly" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
              </button>
            </template>
            <template #default="{ styling }">
              <button type="button" :class="styling" @click="setMode(draft, 'personal')">
                {{ t('wiki.checklist.modes.personal') }}
              </button>
              <button type="button" :class="styling" @click="setMode(draft, 'shared')">
                {{ t('wiki.checklist.modes.shared') }}
              </button>
            </template>
          </MenuDropdown>
          <span class="text-xs text-base-500">{{ t(`wiki.checklist.modeHints.${draft.mode}`) }}</span>
        </div>
      </div>

      <p class="rounded-lg bg-base-50 px-3 py-2 font-mono text-xs text-base-600">
        :::checklist{id="{{ draft.keySlug || '…' }}"}
      </p>

      <div class="space-y-2">
        <div
          v-for="(item, itemIndex) in draft.items"
          :key="item.uid"
          class="space-y-2 rounded-lg border border-base-200 p-3"
        >
          <div class="flex items-start gap-2">
            <span class="mt-2 w-5 text-xs text-base-400">{{ itemIndex + 1 }}.</span>
            <input
              v-model="item.label"
              class="input flex-1"
              :placeholder="t('wiki.checklist.fields.itemLabel')"
              :disabled="readOnly"
            />
            <button
              type="button"
              class="icon-btn"
              :disabled="readOnly || itemIndex === 0"
              :title="t('wiki.tree.moveUp')"
              :aria-label="t('wiki.tree.moveUp')"
              @click="moveItem(draft, itemIndex, -1)"
            >
              <Icon name="material-symbols:arrow-upward-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-btn"
              :disabled="readOnly || itemIndex === draft.items.length - 1"
              :title="t('wiki.tree.moveDown')"
              :aria-label="t('wiki.tree.moveDown')"
              @click="moveItem(draft, itemIndex, 1)"
            >
              <Icon name="material-symbols:arrow-downward-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="icon-btn icon-btn-danger"
              :disabled="readOnly"
              :title="t('wiki.checklist.removeItem')"
              :aria-label="t('wiki.checklist.removeItem')"
              @click="draft.items.splice(itemIndex, 1)"
            >
              <Icon name="material-symbols:delete-outline-rounded" class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <input
            v-model="item.hint"
            class="input"
            :placeholder="t('wiki.checklist.fields.itemHint')"
            :disabled="readOnly"
          />

          <div class="grid gap-2 sm:grid-cols-2">
            <div class="field">
              <label>{{ t('wiki.checklist.fields.targetPage') }}</label>
              <MenuDropdown :id="`checklist-target-${item.uid}`" v-model="openMenu" :disabled="readOnly">
                <template #trigger="{ styling }">
                  <button type="button" :class="[styling, !readOnly ? 'cursor-pointer' : '']" :disabled="readOnly">
                    <span class="truncate">{{ targetLabel(item.targetPage) }}</span>
                    <Icon v-if="!readOnly" name="material-symbols:keyboard-arrow-down-rounded" class="text-lg" />
                  </button>
                </template>
                <template #default="{ styling }">
                  <button type="button" :class="styling" @click="setTarget(item, null)">
                    {{ t('wiki.checklist.fields.noTargetPage') }}
                  </button>
                  <button
                    v-for="page in toolPages"
                    :key="page"
                    type="button"
                    :class="styling"
                    @click="setTarget(item, page)"
                  >
                    {{ pageLabel(page) }}
                  </button>
                </template>
              </MenuDropdown>
            </div>
            <div v-if="item.targetPage" class="field">
              <label :for="`checklist-meta-${item.uid}`">{{ t('wiki.checklist.fields.targetMeta') }}</label>
              <input
                :id="`checklist-meta-${item.uid}`"
                v-model="item.metaText"
                class="input font-mono text-xs"
                :disabled="readOnly"
              />
              <span class="text-xs text-base-500">{{ t('wiki.checklist.fields.targetMetaHint') }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap justify-between gap-2">
        <button
          type="button"
          class="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-60"
          :disabled="readOnly"
          @click="addItem(draft)"
        >
          <Icon name="material-symbols:add-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.checklist.addItem') }}
        </button>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-danger-200 px-4 py-2 text-sm text-danger-700 transition-colors hover:bg-danger-50 disabled:cursor-default disabled:opacity-60"
          :disabled="readOnly"
          @click="drafts.splice(listIndex, 1)"
        >
          <Icon name="material-symbols:delete-outline-rounded" class="text-base" aria-hidden="true" />
          {{ t('wiki.checklist.removeChecklist') }}
        </button>
      </div>
    </div>

    <div v-if="!readOnly" class="flex flex-wrap justify-between gap-2 border-t border-base-200 pt-4">
      <button type="button" class="btn-secondary inline-flex items-center gap-1.5" @click="addChecklist">
        <Icon name="material-symbols:playlist-add-rounded" class="text-base" aria-hidden="true" />
        {{ t('wiki.checklist.addChecklist') }}
      </button>
      <button
        type="button"
        class="btn-primary inline-flex items-center gap-1.5 disabled:opacity-60"
        :disabled="saving"
        @click="save"
      >
        <Icon name="material-symbols:save-outline-rounded" class="text-base" aria-hidden="true" />
        {{ t('wiki.checklist.saveChecklists') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { PAGES } from '~/config/pages'
import type { SaveWikiChecklistsResponse } from '~/server/api/wiki/articles/[id]/checklists.put'
import type { WikiChecklistView } from '~/types/wiki'

const props = defineProps<{
  articleId: number
  modelValue: WikiChecklistView[]
  readOnly?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: WikiChecklistView[]): void
}>()

interface ItemDraft {
  uid: string
  id: number | null
  label: string
  hint: string
  targetPage: string | null
  metaText: string
}

interface ChecklistDraft {
  uid: string
  id: number | null
  keySlug: string
  keyTouched: boolean
  title: string
  mode: 'personal' | 'shared'
  items: ItemDraft[]
}

const { t } = useI18n()
const { hasPermission } = useAuth()
const toast = useToast()

const DEFAULT_META = '{"returnTarget":"self"}'

const drafts = ref<ChecklistDraft[]>([])
const openMenu = ref<string | null>(null)
const saving = ref(false)
const error = ref('')

let uidCounter = 0
function uid() {
  uidCounter += 1
  return `c${uidCounter}`
}

const toolPages = Object.entries(PAGES)
  .filter(([, page]) => !page.permissions.length || hasPermission(page.permissions))
  .map(([name]) => name)
  .sort()

function pageLabel(name: string) {
  const page = PAGES[name]
  return page ? `${t(page.labelKey)} (${name})` : name
}

function targetLabel(name: string | null) {
  return name ? pageLabel(name) : t('wiki.checklist.fields.noTargetPage')
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function toDrafts(lists: WikiChecklistView[]): ChecklistDraft[] {
  return lists.map(list => ({
    uid: uid(),
    id: list.id,
    keySlug: list.keySlug,
    // Existing keys are referenced from the markdown — never rewrite them from the title.
    keyTouched: true,
    title: list.title,
    mode: list.mode,
    items: list.items.map(item => ({
      uid: uid(),
      id: item.id,
      label: item.label,
      hint: item.hint,
      targetPage: item.targetPage,
      metaText: item.targetMeta ? JSON.stringify(item.targetMeta) : DEFAULT_META,
    })),
  }))
}

function onTitleInput(draft: ChecklistDraft) {
  if (!draft.keyTouched) draft.keySlug = slugify(draft.title)
}

function setMode(draft: ChecklistDraft, mode: 'personal' | 'shared') {
  draft.mode = mode
  openMenu.value = null
}

function setTarget(item: ItemDraft, page: string | null) {
  item.targetPage = page
  if (page && !item.metaText.trim()) item.metaText = DEFAULT_META
  openMenu.value = null
}

function addItem(draft: ChecklistDraft) {
  draft.items.push({ uid: uid(), id: null, label: '', hint: '', targetPage: null, metaText: DEFAULT_META })
}

function addChecklist() {
  const draft: ChecklistDraft = {
    uid: uid(),
    id: null,
    keySlug: '',
    keyTouched: false,
    title: '',
    mode: 'personal',
    items: [],
  }
  addItem(draft)
  drafts.value.push(draft)
}

function moveItem(draft: ChecklistDraft, index: number, direction: number) {
  const target = index + direction
  if (target < 0 || target >= draft.items.length) return
  const [item] = draft.items.splice(index, 1)
  if (item) draft.items.splice(target, 0, item)
}

async function save() {
  error.value = ''

  const payload = []
  for (const draft of drafts.value) {
    const items = []
    for (const item of draft.items) {
      let targetMeta: Record<string, any> | null = null
      if (item.targetPage && item.metaText.trim()) {
        try {
          const parsed = JSON.parse(item.metaText)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
          targetMeta = parsed
        } catch {
          error.value = t('wiki.checklist.invalidMeta', { label: item.label || draft.title })
          return
        }
      }

      items.push({
        id: item.id,
        label: item.label,
        hint: item.hint,
        targetPage: item.targetPage,
        targetMeta,
      })
    }

    payload.push({ id: draft.id, keySlug: draft.keySlug, title: draft.title, mode: draft.mode, items })
  }

  saving.value = true
  try {
    const res = await apiFetch<SaveWikiChecklistsResponse>(`/api/wiki/articles/${props.articleId}/checklists`, {
      method: 'PUT',
      body: { checklists: payload },
    })

    if (!res.ok) {
      error.value = res.error
      return
    }

    emit('update:modelValue', res.checklists)
    toast.success(t('wiki.checklist.savedToast'))
  } finally {
    saving.value = false
  }
}

watch(() => props.modelValue, (lists) => { drafts.value = toDrafts(lists ?? []) }, { immediate: true })
</script>
