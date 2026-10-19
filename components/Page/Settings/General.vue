<template>
  <CommonCard
    :title="t('settings.general.languageTitle')"
    :description="t('settings.general.languageText', { language: t(`language.${language === 'de' ? 'german' : 'english'}`) })"
  >
    <button class="btn-secondary" @click="toggleLanguage">
      {{ t('language.switchTo') }}
    </button>
  </CommonCard>

  <CommonCard :title="t('settings.general.passwordTitle')" :description="t('settings.general.passwordText')">
    <button class="btn-secondary" @click="openPasswordModal">
      {{ t('settings.general.passwordOpen') }}
    </button>
  </CommonCard>

  <CommonCard :title="t('settings.general.logoutTitle')" :description="t('settings.general.logoutText')">
    <div class="flex flex-col gap-3 sm:flex-row">
      <button class="btn-primary" @click="openLogoutModal">
        {{ t('actions.logout') }}
      </button>

      <button
        class="btn-secondary"
        :disabled="isLoggingOutAll"
        :class="{ 'opacity-50 cursor-not-allowed': isLoggingOutAll }"
        @click="openLogoutAllModal"
      >
        {{ isLoggingOutAll ? t('settings.general.logoutAllLoading') : t('settings.general.logoutAll') }}
      </button>
    </div>
  </CommonCard>

  <PageSettingsCalendarFeedSection />
  <PageSettingsNotificationPreferencesSection />

  <CommonModal
    v-model="showPasswordModal"
    :title="t('settings.general.passwordTitle')"
    @close="closePasswordModal"
  >
    <p class="text-sm text-base-600">{{ t('settings.general.passwordSessionText') }}</p>
    <form class="grid gap-4" @submit.prevent="changePassword">
      <div class="field">
        <label for="current-password">{{ t('settings.general.currentPassword') }}</label>
        <input
          id="current-password"
          v-model="passwordForm.currentPassword"
          type="password"
          class="input"
          autocomplete="current-password"
          :disabled="isChangingPassword"
        >
      </div>

      <div class="field">
        <label for="new-password">{{ t('settings.general.newPassword') }}</label>
        <input
          id="new-password"
          v-model="passwordForm.newPassword"
          type="password"
          class="input"
          autocomplete="new-password"
          :disabled="isChangingPassword"
        >
      </div>

      <div class="field">
        <label for="confirm-password">{{ t('settings.general.confirmPassword') }}</label>
        <input
          id="confirm-password"
          v-model="passwordForm.confirmPassword"
          type="password"
          class="input"
          autocomplete="new-password"
          :disabled="isChangingPassword"
        >
      </div>

      <p class="text-xs text-base-500">{{ t('settings.general.passwordHelp', { min: MIN_PASSWORD_LENGTH }) }}</p>
    </form>

    <template #footer>
      <button
        type="button"
        class="btn-secondary"
        :disabled="isChangingPassword"
        :class="{ 'opacity-50 cursor-not-allowed': isChangingPassword }"
        @click="closePasswordModal"
      >
        {{ t('actions.cancel') }}
      </button>

      <button
        type="button"
        class="btn-primary"
        :disabled="isChangingPassword"
        :class="{ 'opacity-50 cursor-not-allowed': isChangingPassword }"
        @click="changePassword"
      >
        {{ isChangingPassword ? t('settings.general.passwordSaving') : t('settings.general.passwordSave') }}
      </button>
    </template>
  </CommonModal>

  <CommonModal
    v-model="showLogoutModal"
    :title="t('settings.general.logoutConfirmTitle')"
    @close="closeLogoutModal"
  >
    <p class="text-sm text-base-600">{{ t('settings.general.logoutConfirmText') }}</p>

    <template #footer>
      <button class="btn-secondary" @click="closeLogoutModal">
        {{ t('actions.cancel') }}
      </button>

      <button class="btn-primary" @click="handleLogout">
        {{ t('settings.general.logoutConfirmButton') }}
      </button>
    </template>
  </CommonModal>

  <CommonModal
    v-model="showLogoutAllModal"
    :title="t('settings.general.logoutAllConfirmTitle')"
    @close="closeLogoutAllModal"
  >
    <p class="text-sm text-base-600">{{ t('settings.general.logoutAllConfirmText') }}</p>

    <template #footer>
      <button
        class="btn-secondary"
        :disabled="isLoggingOutAll"
        :class="{ 'opacity-50 cursor-not-allowed': isLoggingOutAll }"
        @click="closeLogoutAllModal"
      >
        {{ t('actions.cancel') }}
      </button>

      <button
        class="btn-primary"
        :disabled="isLoggingOutAll"
        :class="{ 'opacity-50 cursor-not-allowed': isLoggingOutAll }"
        @click="handleLogoutAll"
      >
        {{ isLoggingOutAll ? t('settings.general.logoutAllLoading') : t('settings.general.logoutAllConfirmButton') }}
      </button>
    </template>
  </CommonModal>
</template>

<script setup lang="ts">
import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { usePage } from '~/composables/usePage'
import { useToast } from '~/composables/useToast'
import type { ChangePasswordResponse } from '~/server/api/auth/change-password.post'
import type { LogoutAllResponse } from '~/server/api/auth/logout-all.post'
import { MIN_PASSWORD_LENGTH } from '~/config/validation'

const { logout, redirectToLogin } = useAuth()
const { setPage } = usePage()
const { language, t, toggleLanguage } = useI18n()
const toast = useToast()

const showPasswordModal = ref(false)
const showLogoutModal = ref(false)
const showLogoutAllModal = ref(false)
const isChangingPassword = ref(false)
const isLoggingOutAll = ref(false)
const passwordForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

async function handleLogout() {
  showLogoutModal.value = false
  await logout()
  setPage('Login')
}

async function handleLogoutAll() {
  if (isLoggingOutAll.value) return

  isLoggingOutAll.value = true
  try {
    const res = await apiFetch<LogoutAllResponse>('/api/auth/logout-all', { method: 'POST' })
    if (!res.ok) {
      toast.error(res.error || t('settings.general.logoutAllFailed'))
      return
    }

    showLogoutAllModal.value = false
    redirectToLogin()
  } catch {
    toast.error(t('settings.general.logoutAllFailed'))
  } finally {
    isLoggingOutAll.value = false
  }
}

function openLogoutModal() {
  showLogoutModal.value = true
}

function closeLogoutModal() {
  showLogoutModal.value = false
}

function openLogoutAllModal() {
  if (isLoggingOutAll.value) return
  showLogoutAllModal.value = true
}

function closeLogoutAllModal() {
  if (isLoggingOutAll.value) return
  showLogoutAllModal.value = false
}

function resetPasswordForm() {
  passwordForm.value = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  }
}

function openPasswordModal() {
  resetPasswordForm()
  showPasswordModal.value = true
}

function closePasswordModal() {
  if (isChangingPassword.value) return
  showPasswordModal.value = false
  resetPasswordForm()
}

function translatePasswordError(error?: string) {
  if (error === 'Missing fields') return t('settings.general.passwordMissingFields')
  if (error === 'Password too short') return t('settings.general.passwordTooShort', { min: MIN_PASSWORD_LENGTH })
  if (error === 'Passwords do not match') return t('settings.general.passwordMismatch')
  if (error === 'Invalid current password') return t('settings.general.currentPasswordInvalid')
  if (error === 'Not authenticated') return t('errors.notAuthenticated')
  return error || t('settings.general.passwordFailed')
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

    resetPasswordForm()
    showPasswordModal.value = false
    toast.success(t('settings.general.passwordSaved'))
  } catch {
    toast.error(t('settings.general.passwordFailed'))
  } finally {
    isChangingPassword.value = false
  }
}
</script>
