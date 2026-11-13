<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTranslation } from '@/core/translation'
import {
  changePasswordWithBff,
  fetchOidcStatus,
  loginWithBff,
  mustChangePasswordPending,
  startOidcLogin,
} from '@/core/auth/session'
import { resolveAppHomeRoute } from '@/core/navigation/resolveAppHomeRoute'

const { t } = useTranslation()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const info = ref<string | null>(null)
const oidcEnabled = ref(false)
const oidcDisplayName = ref('SSO')
const forceChange = ref(
  mustChangePasswordPending() || route.query.changePassword === '1',
)

onMounted(async () => {
  if (typeof route.query.sso_error === 'string' && route.query.sso_error.trim()) {
    const code = route.query.sso_error.trim()
    if (code === 'sso_denied') {
      error.value = t('auth.ssoDenied', 'SSO sign-in was cancelled or denied.')
    } else if (code === 'sso_unavailable') {
      error.value = t(
        'auth.ssoUnavailable',
        'SSO is temporarily unavailable. Try again shortly.',
      )
    } else {
      // Generic only — never echo IdP / account-existence detail from the URL.
      error.value = t(
        'auth.ssoFailed',
        'Sign-in with SSO failed. Try again or contact an administrator.',
      )
    }
  }
  const status = await fetchOidcStatus()
  oidcEnabled.value = status.enabled
  oidcDisplayName.value = status.displayName
})

watch(
  () => route.query.changePassword,
  (value) => {
    if (value === '1' || mustChangePasswordPending()) {
      forceChange.value = true
    }
  },
)

const title = computed(() =>
  forceChange.value
    ? t('auth.changePasswordTitle', 'Change password')
    : t('auth.signInTitle', 'Sign in'),
)

const hint = computed(() =>
  forceChange.value
    ? t(
        'auth.changePasswordHint',
        'Your account requires a new password before you can continue.',
      )
    : t('auth.signInHint', 'Sign in with your CoreEngine account.'),
)

async function goHomeAfterLogin(): Promise<void> {
  const redirect =
    typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
  if (redirect === '/') {
    const homeRoute = await resolveAppHomeRoute()
    await router.replace(homeRoute ?? '/')
    return
  }
  await router.replace(redirect)
}

async function submitLogin(): Promise<void> {
  error.value = null
  info.value = null
  loading.value = true
  try {
    const session = await loginWithBff({
      email: email.value.trim(),
      password: password.value,
    })
    if (session.mustChangePassword) {
      forceChange.value = true
      info.value = t(
        'auth.mustChangePassword',
        'Choose a new password to finish signing in.',
      )
      return
    }
    await goHomeAfterLogin()
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('auth.loginFailed', 'Sign-in failed. Check your email and password.')
  } finally {
    loading.value = false
  }
}

async function submitChangePassword(): Promise<void> {
  error.value = null
  info.value = null
  if (newPassword.value !== confirmPassword.value) {
    error.value = t('auth.passwordMismatch', 'New passwords do not match.')
    return
  }
  loading.value = true
  try {
    await changePasswordWithBff({
      currentPassword: password.value,
      newPassword: newPassword.value,
    })
    forceChange.value = false
    password.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    info.value = t(
      'auth.passwordChangedReLogin',
      'Password updated. Sign in with your new password.',
    )
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('auth.changePasswordFailed', 'Could not change password.')
  } finally {
    loading.value = false
  }
}

async function submit(): Promise<void> {
  if (forceChange.value) {
    await submitChangePassword()
    return
  }
  await submitLogin()
}

function signInWithSso(): void {
  error.value = null
  const redirect =
    typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/'
  startOidcLogin(redirect)
}
</script>

<template>
  <div class="login-page flex min-h-screen items-center justify-center p-4">
    <div class="login-page__card w-full max-w-md">
      <p class="mb-1 text-2xl font-semibold">{{ t('auth.brand', 'CoreEngine') }}</p>
      <p class="mb-4 text-sm text-surface-600">
        {{ t('auth.brandSubtitle', 'Multi-purpose platform') }}
      </p>
      <h1 class="mb-1 text-lg font-semibold">
        {{ title }}
      </h1>
      <p class="mb-6 text-sm text-surface-600">
        {{ hint }}
      </p>

      <Message
        v-if="error"
        severity="error"
        :closable="false"
        class="mb-4"
      >
        {{ error }}
      </Message>
      <Message
        v-if="info"
        severity="info"
        :closable="false"
        class="mb-4"
      >
        {{ info }}
      </Message>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <label for="login-email">{{ t('auth.email', 'Email') }}</label>
          <InputText
            id="login-email"
            v-model="email"
            type="email"
            autocomplete="username"
            class="w-full"
            :disabled="loading || forceChange"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="login-password">
            {{
              forceChange
                ? t('auth.currentPassword', 'Current password')
                : t('auth.password', 'Password')
            }}
          </label>
          <Password
            id="login-password"
            v-model="password"
            input-class="w-full"
            class="w-full"
            :feedback="false"
            toggle-mask
            autocomplete="current-password"
            :disabled="loading"
          />
        </div>
        <template v-if="forceChange">
          <div class="flex flex-col gap-2">
            <label for="login-new-password">{{ t('auth.newPassword', 'New password') }}</label>
            <Password
              id="login-new-password"
              v-model="newPassword"
              input-class="w-full"
              class="w-full"
              :feedback="false"
              toggle-mask
              autocomplete="new-password"
              :disabled="loading"
            />
          </div>
          <div class="flex flex-col gap-2">
            <label for="login-confirm-password">
              {{ t('auth.confirmPassword', 'Confirm new password') }}
            </label>
            <Password
              id="login-confirm-password"
              v-model="confirmPassword"
              input-class="w-full"
              class="w-full"
              :feedback="false"
              toggle-mask
              autocomplete="new-password"
              :disabled="loading"
            />
          </div>
        </template>
        <Button
          type="submit"
          :label="
            forceChange
              ? t('auth.changePassword', 'Change password')
              : t('auth.signIn', 'Sign in')
          "
          :loading="loading"
          class="w-full"
        />
      </form>

      <template v-if="oidcEnabled && !forceChange">
        <div class="my-4 flex items-center gap-3 text-sm text-surface-500">
          <span class="h-px flex-1 bg-surface-200" />
          {{ t('auth.or', 'or') }}
          <span class="h-px flex-1 bg-surface-200" />
        </div>
        <Button
          type="button"
          severity="secondary"
          outlined
          class="w-full"
          :label="
            t('auth.signInWithSso', 'Sign in with {provider}', {
              provider: oidcDisplayName,
            })
          "
          :disabled="loading"
          @click="signInWithSso"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--p-primary-color) 16%, transparent), transparent 42%),
    var(--p-surface-50);
}

.login-page__card {
  border: 1px solid var(--p-content-border-color);
  border-radius: 1rem;
  background: var(--p-surface-0);
  padding: 1.75rem;
  box-shadow: 0 18px 40px color-mix(in srgb, var(--p-surface-900) 8%, transparent);
}
</style>
