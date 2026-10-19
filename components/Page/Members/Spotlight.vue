<template>
  <CommonSpotlight
    :loading="loading"
    :is-empty="!stats || stats.total === 0"
    empty-icon="material-symbols:groups-rounded"
    :empty-text="t('member.spotlight.none')"
    :title="t('member.spotlight.overviewTitle')"
  >
    <template #subtitle>
      <p v-if="stats" class="mt-1 flex items-center gap-1.5 text-sm text-base-300">
        <Icon name="material-symbols:groups-rounded" class="text-base text-base-400" />
        {{ t('member.spotlight.headerSummary', { total: stats.total, active: stats.active }) }}
      </p>
    </template>

    <template v-if="stats">
      <!-- Body -->
      <div class="grid gap-4 md:grid-cols-[1fr_1.1fr]">
        <!-- Membership stats -->
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 self-start">
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
        <div class="rounded-xl border border-base-200 bg-base-50/60 p-4">
          <p class="flex items-center gap-1.5 text-sm font-semibold text-base-700">
            <Icon name="material-symbols:cake-rounded" class="text-base text-pink-500" />
            {{ t('member.spotlight.upcomingBirthdays') }}
          </p>

          <ul v-if="birthdays.length" class="mt-3 space-y-1">
            <li v-for="member in visibleBirthdays" :key="member.id">
              <button
                type="button"
                class="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition cursor-pointer hover:bg-base-100/80"
                @click="$emit('open', member.id)"
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
    </template>
  </CommonSpotlight>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import type { GetMemberSpotlightResponse } from '~/server/api/members/spotlight.get'
import type { MemberBirthday, MemberSpotlightStats } from '~/types/member'

defineEmits<{ (e: 'open', memberId: number): void }>()

const { t } = useI18n()
const { formatDate } = useLocaleFormatters()

const loading = ref(true)
const stats = ref<MemberSpotlightStats | null>(null)
const birthdays = ref<MemberBirthday[]>([])
const horizonDays = ref(60)
const canViewUsers = ref(false)

const MAX_VISIBLE_BIRTHDAYS = 3
const visibleBirthdays = computed(() => birthdays.value.slice(0, MAX_VISIBLE_BIRTHDAYS))

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
