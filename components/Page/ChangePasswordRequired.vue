<template>
  <div class="max-w-md mx-auto">
    <div class="bg-white p-6 rounded-xl shadow-lg space-y-4">
      <div>
        <h2 class="text-xl font-semibold">{{ t('passwordChangeRequired.title') }}</h2>
        <p class="mt-1 text-sm text-base-600">{{ t('passwordChangeRequired.text') }}</p>
      </div>

      <form class="space-y-4" @submit.prevent="changePassword">
        <div class="field">
          <label for="required-current-password">{{ t('settings.general.currentPassword') }}</label>
          <input
            id="required-current-password"
            v-model="passwordForm.currentPassword"
            type="password"
            class="input"
            autocomplete="current-password"
            :disabled="isChangingPassword"
          >
        </div>

        <div class="field">
          <label for="required-new-password">{{ t('settings.general.newPassword') }}</label>
          <input
            id="required-new-password"
            v-model="passwordForm.newPassword"
            type="password"
            class="input"
            autocomplete="new-password"
            :disabled="isChangingPassword"
          >
        </div>

        <div class="field">
          <label for="required-confirm-password">{{ t('settings.general.confirmPassword') }}</label>
          <input
            id="required-confirm-password"
            v-model="passwordForm.confirmPassword"
            type="password"
            class="input"
            autocomplete="new-password"
            :disabled="isChangingPassword"
          >
        </div>

        <p class="text-xs text-base-500">{{ t('settings.general.passwordHelp', { min: MIN_PASSWORD_LENGTH }) }}</p>

        <div class="flex items-center justify-between gap-3">
          <button type="button" class="btn-secondary" :disabled="isChangingPassword" @click="handleLogout">
            {{ t('actions.logout') }}
          </button>

          <button
            type="submit"
            class="btn-primary"
            :disabled="isChangingPassword"
            :class="{ 'opacity-50 cursor-not-allowed': isChangingPassword }"
          >
            {{ isChangingPassword ? t('settings.general.passwordSaving') : t('passwordChangeRequired.submit') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { useToast } from '~/composables/useToast'
import type { ChangePasswordResponse } from '~/server/api/auth/change-password.post'
import { MIN_PASSWORD_LENGTH } from '~/config/validation'
import { parseDeepLinkHash } from '~/composables/usePage'

const { fetchSession, logout } = useAuth()
const { setPage } = usePage()
const { t } = useI18n()
const toast = useToast()

const isChangingPassword = ref(false)
const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

function translatePasswordError(error?: string) {
  if (error === 'Missing fields') return t('settings.general.passwordMissingFields')
  if (error === 'Password too short') return t('settings.general.passwordTooShort', { min: MIN_PASSWORD_LENGTH })
  if (error === 'Passwords do not match') return t('settings.general.passwordMismatch')
  if (error === 'Invalid current password') return t('settings.general.currentPasswordInvalid')
  if (error === 'Not authenticated') return t('errors.notAuthenticated')
  return error || t('settings.general.passwordFailed')
}

async function handleLogout() {
  await logout()
}

async function changePassword() {
  if (isChangingPassword.value) return

  if (!passwordForm.value.currentPassword || !passwordForm.value.newPassword || !passwordForm.value.confirmPassword) {
    toast.error(t('settings.general.passwordMissingFields'))
    return
  }

  if (passwordForm.value.newPassword.length < MIN_PASSWORD_LENGTH) {
    toast.error(t('settings.general.passwordTooShort', { min: MIN_PASSWORD_LENGTH }))
    return
  }

  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    toast.error(t('settings.general.passwordMismatch'))
    return
  }

  isChangingPassword.value = true
  try {
    const res = await apiFetch<ChangePasswordResponse>('/api/auth/change-password', {
      method: 'POST',
      body: {
        currentPassword: passwordForm.value.currentPassword,
        newPassword: passwordForm.value.newPassword,
        confirmPassword: passwordForm.value.confirmPassword,
      },
    })

    if (!res.ok) {
      toast.error(translatePasswordError(res.error))
      return
    }

    await fetchSession()
    toast.success(t('passwordChangeRequired.success'))
    const deepLink = parseDeepLinkHash()
    if (deepLink && deepLink.page !== 'Login') {
      setPage(deepLink.page, deepLink.meta || undefined)
    } else {
      setPage('Home')
    }
  } catch {
    toast.error(t('settings.general.passwordFailed'))
  } finally {
    isChangingPassword.value = false
  }
}
</script>
