<template>
  <PageHomeWidgetFrame
    :title="t('home.widgets.members.title')"
    icon="material-symbols:groups-rounded"
    :loading="loading"
    :is-empty="!stats || stats.total === 0"
    empty-icon="material-symbols:groups-rounded"
    :empty-text="t('member.spotlight.none')"
  >
    <template #subtitle>
      <p v-if="stats" class="mt-0.5 truncate text-xs text-base-300">
        {{ t('member.spotlight.headerSummary', { total: stats.total, active: stats.active }) }}
      </p>
    </template>

    <template #action>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-base-200 transition cursor-pointer hover:bg-white/20 hover:text-white"
        @click="setPage('MemberList')"
      >
        {{ t('home.widgets.showAll') }}
        <Icon name="material-symbols:arrow-forward-rounded" class="text-sm" />
      </button>
    </template>

    <div v-if="stats" class="flex h-full flex-col gap-4">
      <!-- Membership stats -->
      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('member.states.active') }}</dt>
          <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-base-800">
            <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span>{{ stats.active }}</span>
          </dd>
        </div>

        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('member.states.passive') }}</dt>
          <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-base-800">
            <span class="h-2 w-2 shrink-0 rounded-full bg-base-400" />
            <span>{{ stats.passive }}</span>
          </dd>
        </div>

        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('member.states.hold') }}</dt>
          <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-base-800">
            <span class="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            <span>{{ stats.hold }}</span>
          </dd>
        </div>

        <div>
          <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('member.honorary') }}</dt>
          <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-base-800">
            <Icon name="material-symbols:star-rounded" class="shrink-0 text-base text-amber-400" />
            <span>{{ stats.honorary }}</span>
          </dd>
        </div>

        <template v-if="canViewUsers">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('member.spotlight.activeAccounts') }}</dt>
            <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-base-800">
              <Icon name="material-symbols:badge-rounded" class="shrink-0 text-base text-emerald-500" />
              <span>{{ stats.active_accounts }}</span>
            </dd>
          </div>

          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-base-400">{{ t('member.spotlight.inactiveAccounts') }}</dt>
            <dd class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-base-800">
              <Icon name="material-symbols:badge-rounded" class="shrink-0 text-base text-base-400" />
              <span>{{ stats.inactive_accounts }}</span>
            </dd>
          </div>
        </template>
      </dl>

      <!-- Upcoming birthdays -->
      <div class="flex-1 rounded-xl border border-base-200 bg-base-50/60 p-4">
        <p class="flex items-center gap-1.5 text-sm font-semibold text-base-700">
          <Icon name="material-symbols:cake-rounded" class="text-base text-pink-500" />
          {{ t('member.spotlight.upcomingBirthdays') }}
        </p>

        <ul v-if="birthdays.length" class="mt-3 space-y-1">
          <li v-for="member in birthdays" :key="member.id">
            <button
              type="button"
              class="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition cursor-pointer hover:bg-base-100/80"
              @click="openMember(member.id)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-base-800">{{ member.full_name }}</span>
                <span class="block text-xs text-base-500">
                  {{ formatDate(member.birthdate) }} · {{ t('member.spotlight.turnsAge', { age: member.turning_age }) }}
                </span>
              </span>
              <span
                class="shrink-0 text-xs font-semibold"
                :class="member.days_until === 0 ? 'text-pink-600' : 'text-base-500'"
              >
                {{ member.days_until === 0 ? t('member.spotlight.today') : t('member.spotlight.inDays', { days: member.days_until }) }}
              </span>
            </button>
          </li>
        </ul>

        <p v-else class="mt-3 text-sm text-base-400">
          {{ t('member.spotlight.noBirthdays', { days: horizonDays }) }}
        </p>
      </div>
    </div>
  </PageHomeWidgetFrame>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { GetMemberSpotlightResponse } from '~/server/api/members/spotlight.get'
import type { MemberBirthday, MemberSpotlightStats } from '~/types/member'

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()
const { setPage } = usePage()

const loading = ref(true)
const stats = ref<MemberSpotlightStats | null>(null)
const birthdays = ref<MemberBirthday[]>([])
const horizonDays = ref(60)
const canViewUsers = ref(false)

function openMember(id: number) {
  setPage('MemberCreate', { memberId: id, returnTo: 'Home' })
}

async function load() {
  loading.value = true
  try {
    const res = await apiFetch<GetMemberSpotlightResponse>('/api/members/spotlight')
    if (res.ok) {
      stats.value = res.stats
      birthdays.value = res.birthdays
      horizonDays.value = res.horizonDays
      canViewUsers.value = res.canViewUsers
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)
useAppRefresh().onRefresh(load)
</script>
