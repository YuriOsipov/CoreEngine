<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTranslation } from '@/core/translation'
import { completeOidcTicket } from '@/core/auth/session'
import { resolveAppHomeRoute } from '@/core/navigation/resolveAppHomeRoute'

const { t } = useTranslation()
const route = useRoute()
const router = useRouter()

const error = ref<string | null>(null)
const loading = ref(true)

onMounted(async () => {
  const ticket =
    typeof route.query.ticket === 'string' ? route.query.ticket.trim() : ''
  if (!ticket) {
    error.value = t('auth.ssoMissingTicket', 'Missing SSO ticket. Try signing in again.')
    loading.value = false
    return
  }
  try {
    await completeOidcTicket(ticket)
    const redirect =
      typeof route.query.redirect === 'string' &&
      route.query.redirect.startsWith('/') &&
      !route.query.redirect.startsWith('//')
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
        : t('auth.ssoFailed', 'SSO sign-in failed.')
    loading.value = false
  }
})

function backToLogin(): void {
  void router.replace({ name: 'login' })
}
</script>

<template>
  <div class="login-page flex min-h-screen items-center justify-center p-4">
    <div class="login-page__card w-full max-w-md">
      <p class="mb-1 text-2xl font-semibold">{{ t('auth.brand', 'CoreEngine') }}</p>
      <h1 class="mb-4 text-lg font-semibold">
        {{ t('auth.ssoCompleting', 'Completing sign-in…') }}
      </h1>
      <Message
        v-if="error"
        severity="error"
        :closable="false"
        class="mb-4"
      >
        {{ error }}
      </Message>
      <div
        v-if="loading && !error"
        class="flex items-center gap-2 text-sm text-surface-600"
      >
        <ProgressSpinner style="width: 1.5rem; height: 1.5rem" />
        {{ t('auth.ssoPleaseWait', 'Please wait.') }}
      </div>
      <Button
        v-if="error"
        type="button"
        :label="t('auth.backToSignIn', 'Back to sign in')"
        class="w-full"
        @click="backToLogin"
      />
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
