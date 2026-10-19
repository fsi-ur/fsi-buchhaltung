<template>
  <PageMembersSpotlight @open="openMember" />

  <CommonPageTableCard
    :title="t('member.stored')"
    persist-key="members-list"
    :search-value="search"
    :search-placeholder="t('member.search')"
    :can-create="canEdit"
    :create-label="`+ ${t('member.new')}`"
    @update:search-value="search = $event"
    @create="createMember"
  >
    <template #actions>
      <PageAuditTableHistoryButton :tables="['members', 'member_positions', 'member_pending_field_changes']" />
      <button type="button" class="btn-secondary inline-flex items-center gap-2" @click="exportOpen = true">
        <Icon name="material-symbols:download-rounded" />
        {{ t('member.export.button') }}
      </button>
    </template>

    <CommonAdvancedTable
      :loading="loading"
      v-model:search="search"
      persist-key="members-list"
      :rows="members"
      :columns="columns"
      :empty-text="t('member.none')"
      table-class="min-w-[64rem]"
      @row-open="openMember($event.id)"
    />
  </CommonPageTableCard>

  <PageMembersExportModal v-model="exportOpen" />
</template>

<script setup lang="ts">
import type { AdvancedTableColumn } from '~/composables/useAdvancedTable'
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { usePage } from '~/composables/usePage'
import { useAuth } from '~/composables/useAuth'
import { type MemberListItem, MemberStatus } from '~/types/member'
const { today: appToday } = useAppTimeZone()

const { setPage } = usePage()
const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const { hasPermission } = useAuth()

const canEdit = computed(() => hasPermission('members.edit'))
const canViewUsers = computed(() => hasPermission(['users.view', 'users.manage']))

const members = ref<MemberListItem[]>([])
const loading = ref(true)
const search = ref('')
const exportOpen = ref(false)

const columns = computed<AdvancedTableColumn<MemberListItem>[]>(() => [
  {
    key: 'first_name',
    label: t('member.firstName'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.first_name,
    mobile: 'title',
  },
  {
    key: 'last_name',
    label: t('member.lastName'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.last_name,
    mobile: 'title',
  },
  {
    key: 'birthdate',
    label: t('member.birthdate'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.birthdate,
    format: row => formatDate(row.birthdate),
  },
  {
    key: 'subject_name',
    label: t('member.subject'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => row.subject_name ?? '-',
    format: row => row.subject_name || t('common.notAvailable'),
  },
  {
    key: 'status',
    label: t('member.status'),
    filterType: 'text',
    globalSearchable: true,
    getValue: row => statusLabel(row),
    format: row => statusLabel(row) || t('common.notAvailable'),
  },
  {
    key: 'joined_at',
    label: t('member.joinedAt'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.joined_at,
    format: row => formatDate(row.joined_at),
    mobileLabel: true,
  },
  {
    key: 'left_at',
    label: t('member.leftAt'),
    filterType: 'date',
    globalSearchable: true,
    getValue: row => row.left_at,
    format: row => row.left_at ? formatDate(row.left_at) : t('common.notAvailable'),
    mobileLabel: true,
  },
  {
    key: 'has_account',
    label: t('member.hasAccount'),
    filterType: 'text',
    globalSearchable: false,
    getValue: row => accountLabel(row),
    hidden: !canViewUsers.value,
    mobileLabel: true,
  },
])

async function load() {
  try {
    const res = await apiFetch<ApiResponse<'/api/members'>>('/api/members')
    if (res.ok) {
      members.value = res.members
    } else {
      console.log(res.error)
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)

function statusLabel(member: MemberListItem) {
  if (member.status === MemberStatus.Active) return t('member.states.active')
  if (member.status === MemberStatus.Passive) return t('member.states.passive')
  if (member.status === MemberStatus.Hold) return t('member.states.hold')
  if (member.left_at && member.left_at > appToday()) {
    return t('member.states.leaving')
  }
  return t('member.states.left')
}

function accountLabel(member: MemberListItem) {
  if (!member.has_account) return t('common.no')
  return `${t('common.yes')}${member.account_is_active ? '' : ` (${t('member.accountInactive')})`}`
}

function openMember(id: number) {
  setPage('MemberCreate', { memberId: id, returnTo: 'MemberList' })
}

function createMember() {
  setPage('MemberCreate', { returnTo: 'MemberList' })
}
</script>
