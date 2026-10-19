<template>
  <template v-if="hasAccess">
    <CommonCard
      :title="t('settings.association.legalTitle')"
      :description="t('settings.association.intro')"
    >
      <template #actions>
        <PageAuditTableHistoryButton
          :tables="['association_profiles', 'association_responsible_members', 'association_responsible_positions']"
          restricted
        />
      </template>

      <div class="field">
        <label>{{ t('settings.association.fields.logo') }}</label>
        <p class="mb-2 text-sm text-base-500">{{ t('settings.association.logoHelp') }}</p>
        <ClientOnly>
          <div class="max-w-xl">
            <PageFinancesFileDrop
              :model-value="logoFile"
              :existing-file="existingLogo"
              :can-edit="!isSaving"
              :normalize-images="false"
              :allowed-file-types="['png', 'jpg', 'jpeg']"
              compact
              @update:model-value="logoFile = $event"
              @remove-existing="removeExistingLogo"
            />
          </div>
        </ClientOnly>
      </div>

      <div class="field">
        <label>{{ t('common.name') }}</label>
        <input v-model="form.name" class="input" />
      </div>

      <div class="field">
        <label>{{ t('settings.association.fields.shortName') }}</label>
        <input v-model="form.short_name" class="input" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="field md:col-span-2">
          <label>{{ t('company.street') }}</label>
          <input v-model="form.street" class="input" />
        </div>

        <div class="field">
          <label>{{ t('company.streetNumber') }}</label>
          <input v-model="form.street_number" class="input" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="field">
          <label>{{ t('company.postalCode') }}</label>
          <input v-model="form.postal_code" class="input" />
        </div>

        <div class="field md:col-span-2">
          <label>{{ t('company.city') }}</label>
          <input v-model="form.city" class="input" />
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="field">
          <label>{{ t('settings.association.fields.registerNumber') }}</label>
          <input v-model="form.register_number" class="input" />
        </div>

        <div class="field">
          <label>{{ t('settings.association.fields.registerCourt') }}</label>
          <input v-model="form.register_court" class="input" />
        </div>
      </div>

      <div class="field">
        <label>{{ t('company.vatId') }}</label>
        <input v-model="form.vat_id" class="input" />
      </div>
    </CommonCard>

    <CommonCard :title="t('settings.association.contactTitle')">

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="field">
          <label>{{ t('member.email') }}</label>
          <input v-model="form.email" class="input" type="email" />
        </div>

        <div class="field">
          <label>{{ t('member.phone') }}</label>
          <input v-model="form.phone" class="input" />
        </div>
      </div>

      <div class="field">
        <label>{{ t('settings.association.fields.website') }}</label>
        <input v-model="form.website" class="input" />
      </div>
    </CommonCard>

    <CommonCard :title="t('settings.association.bankingTitle')">

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="field">
          <label>{{ t('reimbursement.iban') }}</label>
          <input v-model="form.iban" class="input" />
        </div>

        <div class="field">
          <label>{{ t('reimbursement.bic') }}</label>
          <input v-model="form.bic" class="input" />
        </div>
      </div>

      <div class="field">
        <label>{{ t('reimbursement.bankname') }}</label>
        <input v-model="form.bankname" class="input" />
      </div>
    </CommonCard>

    <CommonCard :title="t('settings.association.responsibleTitle')">
      <div class="field">
        <label>{{ t('settings.association.responsibleMembers') }}</label>
        <CommonSelectionListField
          :query="memberQuery"
          :options="memberSearchOptions"
          :selected-items="selectedMemberItems"
          :placeholder="t('settings.association.responsibleMembersPlaceholder')"
          :empty-text="t('settings.association.noMembersAvailable')"
          :empty-selection-text="t('settings.association.noResponsibleMembers')"
          :remove-label="t('actions.remove')"
          @update:query="memberQuery = $event"
          @select="selectMember"
          @clear-selection="memberQuery = ''"
          @remove="removeMember"
        />
      </div>

      <div class="field">
        <label>{{ t('settings.association.responsiblePositions') }}</label>
        <CommonSelectionListField
          :query="positionQuery"
          :options="positionSearchOptions"
          :selected-items="selectedPositionItems"
          :placeholder="t('settings.association.responsiblePositionsPlaceholder')"
          :empty-text="t('settings.association.noPositionsAvailable')"
          :empty-selection-text="t('settings.association.noResponsiblePositions')"
          :remove-label="t('actions.remove')"
          @update:query="positionQuery = $event"
          @select="selectPosition"
          @clear-selection="positionQuery = ''"
          @remove="removePosition"
        />
      </div>
    </CommonCard>

    <CommonCard :title="t('settings.association.effectiveResponsibleTitle')">

      <div v-if="effectiveResponsiblePeople.length" class="rounded-lg border border-base-200 bg-base-50">
        <div class="selection-scroll max-h-[min(38vh,20rem)] overflow-y-auto p-2">
          <div
            v-for="person in effectiveResponsiblePeople"
            :key="person.key"
            class="mb-2 rounded-lg border border-base-200 bg-white px-3 py-2 last:mb-0"
          >
            <p class="truncate text-sm font-medium text-base-800">{{ person.label }}</p>
            <p class="truncate text-xs text-base-500">{{ person.meta }}</p>
          </div>
        </div>
      </div>

      <div v-else class="rounded-lg border border-dashed border-base-300 px-3 py-4 text-sm text-base-500">
        {{ t('settings.association.noEffectiveResponsible') }}
      </div>
    </CommonCard>

    <CommonValidationSummary
      v-if="validationErrors.length > 0"
      :errors="validationErrors"
      :title="t('common.validationBlocked')"
    />

    <div class="sticky bottom-0 col-span-12 -mx-6 flex flex-wrap items-center justify-end gap-3 border-t border-base-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-6 sm:shadow-lg">
      <span v-if="dirty" class="mr-auto inline-flex items-center gap-1 text-xs text-warning-600">
        <Icon name="material-symbols:error-outline-rounded" class="h-4 w-4" aria-hidden="true" />
        {{ t('settings.notifications.unsavedChanges') }}
      </span>
      <button
        type="button"
        class="btn-secondary"
        :disabled="!dirty || isSaving"
        :class="{ 'opacity-50 cursor-not-allowed': !dirty || isSaving }"
        @click="load"
      >
        {{ t('actions.discard') }}
      </button>
      <button
        class="btn-primary"
        :class="{ 'opacity-50 cursor-not-allowed': isSaving || validationErrors.length > 0 }"
        :disabled="isSaving || validationErrors.length > 0"
        @click="save"
      >
        {{ t('actions.save') }}
      </button>
    </div>
  </template>
</template>

<script setup lang="ts">
import type { SearchSelectOption } from '~/components/Common/SearchSelect.vue'
import type { SelectionListItem } from '~/components/Common/SelectionListField.vue'
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import PageFinancesFileDrop from '~/components/Page/Finances/FileDrop.vue'
import type {
  AssociationProfileRow,
  AssociationResponsibleMemberOption,
  AssociationResponsiblePositionOption,
  SaveAssociationProfileBody,
} from '~/types/association'

const { t } = useI18n()
const toast = useToast()
const { hasPermission } = useAuth()

const hasAccess = computed(() => hasPermission('settings.association.manage'))
const isSaving = ref(false)
const memberQuery = ref('')
const positionQuery = ref('')
const memberOptions = ref<AssociationResponsibleMemberOption[]>([])
const positionOptions = ref<AssociationResponsiblePositionOption[]>([])
const logoFile = ref<File | null>(null)
const existingLogo = ref<{ id: number, url: string, name: string, mime_type: string, size: number } | null>(null)
const removeExistingLogoFlag = ref(false)
const savedSnapshot = ref('')
const form = reactive<SaveAssociationProfileBody>({
  name: '',
  short_name: null,
  street: '',
  street_number: '',
  postal_code: '',
  city: '',
  email: '',
  phone: null,
  website: null,
  vat_id: null,
  iban: null,
  bic: null,
  bankname: null,
  register_number: null,
  register_court: null,
  responsible_member_ids: [],
  responsible_position_ids: [],
})

function snapshot() {
  return JSON.stringify({
    form,
    logo: logoFile.value ? `${logoFile.value.name}:${logoFile.value.size}` : null,
    removeExistingLogo: removeExistingLogoFlag.value,
  })
}

const dirty = computed(() => savedSnapshot.value !== '' && snapshot() !== savedSnapshot.value)

const memberOptionsById = computed(() => new Map(memberOptions.value.map(member => [member.id, member])))
const positionOptionsById = computed(() => new Map(positionOptions.value.map(position => [position.id, position])))

const validationErrors = computed(() => {
  const errors: string[] = []
  if (!form.name.trim()) errors.push(t('settings.association.required.name'))
  if (!form.street.trim()) errors.push(t('settings.association.required.street'))
  if (!form.street_number.trim()) errors.push(t('settings.association.required.streetNumber'))
  if (!form.postal_code.trim()) errors.push(t('settings.association.required.postalCode'))
  if (!form.city.trim()) errors.push(t('settings.association.required.city'))
  if (!form.email.trim()) errors.push(t('settings.association.required.email'))
  return errors
})

const selectedMemberItems = computed<SelectionListItem[]>(() => {
  return form.responsible_member_ids
    .map(id => memberOptionsById.value.get(id))
    .filter((member): member is AssociationResponsibleMemberOption => Boolean(member))
    .map(member => ({
      id: member.id,
      label: member.full_name,
      meta: member.subject_name,
    }))
})

const selectedPositionItems = computed<SelectionListItem[]>(() => {
  return form.responsible_position_ids
    .map(id => positionOptionsById.value.get(id))
    .filter((position): position is AssociationResponsiblePositionOption => Boolean(position))
    .map(position => ({
      id: position.id,
      label: `${position.code} - ${position.name}`,
      meta: position.current_holder_names.length
        ? `${t('settings.association.currentPositionHolders')}: ${position.current_holder_names.join(', ')}`
        : t('settings.association.noCurrentPositionHolders'),
    }))
})

const memberSearchOptions = computed<SearchSelectOption<number>[]>(() => {
  const selectedIds = new Set(form.responsible_member_ids)
  return memberOptions.value
    .filter(member => !selectedIds.has(member.id))
    .map(member => ({
      key: member.id,
      label: member.full_name,
      value: member.id,
      searchText: `${member.full_name} ${member.subject_name || ''}`.trim(),
    }))
})

const positionSearchOptions = computed<SearchSelectOption<number>[]>(() => {
  const selectedIds = new Set(form.responsible_position_ids)
  return positionOptions.value
    .filter(position => !selectedIds.has(position.id))
    .map(position => ({
      key: position.id,
      label: `${position.code} - ${position.name}`,
      value: position.id,
      searchText: `${position.code} ${position.name} ${position.current_holder_names.join(' ')}`.trim(),
    }))
})

const effectiveResponsiblePeople = computed(() => {
  const entries = new Map<string, { key: string, label: string, metaParts: string[] }>()

  for (const memberId of form.responsible_member_ids) {
    const member = memberOptionsById.value.get(memberId)
    if (!member) continue
    entries.set(member.full_name, {
      key: `person-${member.id}`,
      label: member.full_name,
      metaParts: [t('settings.association.responsibleMembers')],
    })
  }

  for (const positionId of form.responsible_position_ids) {
    const position = positionOptionsById.value.get(positionId)
    if (!position) continue

    for (const holder of position.current_holder_names) {
      const existing = entries.get(holder)
      if (existing) {
        if (!existing.metaParts.includes(`${position.code} - ${position.name}`)) {
          existing.metaParts.push(`${position.code} - ${position.name}`)
        }
        continue
      }

      entries.set(holder, {
        key: `position-${position.id}-${holder}`,
        label: holder,
        metaParts: [`${position.code} - ${position.name}`],
      })
    }
  }

  return Array.from(entries.values())
    .map(entry => ({
      key: entry.key,
      label: entry.label,
      meta: entry.metaParts.join(', '),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
})

function applyProfile(profile: AssociationProfileRow | null) {
  Object.assign(form, {
    id: profile?.id,
    name: profile?.name ?? '',
    short_name: profile?.short_name ?? null,
    street: profile?.street ?? '',
    street_number: profile?.street_number ?? '',
    postal_code: profile?.postal_code ?? '',
    city: profile?.city ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? null,
    website: profile?.website ?? null,
    vat_id: profile?.vat_id ?? null,
    iban: profile?.iban ?? null,
    bic: profile?.bic ?? null,
    bankname: profile?.bankname ?? null,
    register_number: profile?.register_number ?? null,
    register_court: profile?.register_court ?? null,
    responsible_member_ids: profile?.responsible_member_ids ?? [],
    responsible_position_ids: profile?.responsible_position_ids ?? [],
  })
}

function removeExistingLogo() {
  existingLogo.value = null
  removeExistingLogoFlag.value = true
}

function normalizeOptionalString(value: string | null) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function selectMember(value: unknown) {
  const memberId = Number(value)
  if (!Number.isInteger(memberId) || memberId <= 0 || form.responsible_member_ids.includes(memberId)) return
  form.responsible_member_ids = [...form.responsible_member_ids, memberId]
  memberQuery.value = ''
}

function removeMember(value: string | number) {
  const memberId = Number(value)
  form.responsible_member_ids = form.responsible_member_ids.filter(id => id !== memberId)
}

function selectPosition(value: unknown) {
  const positionId = Number(value)
  if (!Number.isInteger(positionId) || positionId <= 0 || form.responsible_position_ids.includes(positionId)) return
  form.responsible_position_ids = [...form.responsible_position_ids, positionId]
  positionQuery.value = ''
}

function removePosition(value: string | number) {
  const positionId = Number(value)
  form.responsible_position_ids = form.responsible_position_ids.filter(id => id !== positionId)
}

async function load() {
  try {
    const res = await apiFetch<{
      ok: boolean
      profile?: AssociationProfileRow | null
      members?: AssociationResponsibleMemberOption[]
      positions?: AssociationResponsiblePositionOption[]
      logo?: { id: number, original_name: string, mime_type: string, file_size: number } | null
      error?: string
    }>('/api/settings/association')

    if (!res.ok) {
      toast.error(res.error || t('settings.association.loadFailed'))
      return
    }

    memberOptions.value = res.members ?? []
    positionOptions.value = res.positions ?? []
    applyProfile(res.profile ?? null)
    existingLogo.value = res.logo
      ? {
          id: Number(res.logo.id),
          url: '/api/settings/association/logo',
          name: String(res.logo.original_name),
          mime_type: String(res.logo.mime_type),
          size: Number(res.logo.file_size),
        }
      : null
    logoFile.value = null
    removeExistingLogoFlag.value = false
    savedSnapshot.value = snapshot()
  } catch (error) {
    console.error(error)
    toast.error(t('settings.association.loadFailed'))
  }
}

async function save() {
  if (validationErrors.value.length > 0 || isSaving.value) return

  isSaving.value = true
  try {
    const body = new FormData()
    if (logoFile.value) body.append('file', logoFile.value)
    body.append('removeExistingLogo', String(removeExistingLogoFlag.value))
    body.append('profile', JSON.stringify({
      ...form,
      short_name: normalizeOptionalString(form.short_name),
      phone: normalizeOptionalString(form.phone),
      website: normalizeOptionalString(form.website),
      vat_id: normalizeOptionalString(form.vat_id),
      iban: normalizeOptionalString(form.iban),
      bic: normalizeOptionalString(form.bic),
      bankname: normalizeOptionalString(form.bankname),
      register_number: normalizeOptionalString(form.register_number),
      register_court: normalizeOptionalString(form.register_court),
    } satisfies SaveAssociationProfileBody))

    const res = await apiFetch<ApiResponse<'/api/settings/association.save', 'post'>>('/api/settings/association.save', {
      method: 'POST',
      body,
    })

    if (!res.ok) {
      console.log(res)
      toast.error(res.error || t('settings.association.saveFailed'))
      return
    }

    await load()
    toast.success(t('settings.association.saveSuccess'))
  } catch (error) {
    console.error(error)
    toast.error(t('settings.association.saveFailed'))
  } finally {
    isSaving.value = false
  }
}

onMounted(async () => {
  if (!hasAccess.value) return
  await load()
})

useAppRefresh().onRefresh(async () => {
  if (!hasAccess.value) return
  await load()
})
</script>

<style scoped>
.selection-scroll {
  scrollbar-width: auto;
  scrollbar-color: var(--color-base-400) var(--color-base-200);
}

.selection-scroll::-webkit-scrollbar {
  width: 12px;
}

.selection-scroll::-webkit-scrollbar-track {
  background: var(--color-base-200);
  border-radius: 9999px;
}

.selection-scroll::-webkit-scrollbar-thumb {
  background: var(--color-base-400);
  border-radius: 9999px;
  border: 2px solid var(--color-base-200);
}
</style>
