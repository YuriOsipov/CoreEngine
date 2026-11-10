<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTranslation } from '@/core/translation'
import { loginWithBff } from '@/core/auth/session'
import { resolveAppHomeRoute } from '@/core/navigation/resolveAppHomeRoute'

const { t } = useTranslation()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

async function submit(): Promise<void> {
  error.value = null
  loading.value = true
  try {
    await loginWithBff({
      email: email.value.trim(),
      password: password.value,
    })
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
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : t('auth.loginFailed', 'Sign-in failed. Check your email and password.')
  } finally {
    loading.value = false
  }
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
        {{ t('auth.signInTitle', 'Sign in') }}
      </h1>
      <p class="mb-6 text-sm text-surface-600">
        {{ t('auth.signInHint', 'Sign in with your CoreEngine account.') }}
      </p>

      <Message
        v-if="error"
        severity="error"
        :closable="false"
        class="mb-4"
      >
        {{ error }}
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
            :disabled="loading"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="login-password">{{ t('auth.password', 'Password') }}</label>
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
        <Button
          type="submit"
          :label="t('auth.signIn', 'Sign in')"
          :loading="loading"
          class="w-full"
        />
      </form>
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
