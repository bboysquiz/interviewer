<script setup lang="ts">
import { computed, ref } from 'vue'

import { useAuthStore } from '@/stores/auth'

type AuthMode = 'login' | 'register'

const authStore = useAuthStore()

const mode = ref<AuthMode>('login')
const username = ref('')
const password = ref('')
const localError = ref<string | null>(null)

const panelTitle = computed(() =>
  mode.value === 'login' ? 'Вход в аккаунт' : 'Создание аккаунта',
)

const submitLabel = computed(() =>
  mode.value === 'login' ? 'Войти' : 'Создать аккаунт',
)

const canSubmit = computed(
  () =>
    username.value.trim().length >= 3 &&
    password.value.trim().length >= 8 &&
    !authStore.isSubmitting,
)

const switchMode = (nextMode: AuthMode): void => {
  mode.value = nextMode
  localError.value = null
}

const submit = async (): Promise<void> => {
  localError.value = null

  try {
    if (mode.value === 'login') {
      await authStore.login({
        username: username.value,
        password: password.value,
      })
      return
    }

    await authStore.register({
      username: username.value,
      password: password.value,
    })
  } catch (error) {
    localError.value =
      error instanceof Error
        ? error.message
        : 'Не удалось выполнить авторизацию.'
  }
}
</script>

<template>
  <section class="auth-panel surface-card">
    <div class="surface-card__header">
      <p class="surface-card__eyebrow">Аккаунт</p>
      <h2 class="surface-card__title">{{ panelTitle }}</h2>
    </div>

    <div class="surface-card__body">
      <p class="muted">
        Войди в существующий аккаунт или создай новый, чтобы заметки,
        скриншоты и история собеседований сохранялись отдельно по
        пользователям.
      </p>

      <div class="auth-panel__modes" role="tablist" aria-label="Режим авторизации">
        <button
          type="button"
          class="auth-panel__mode"
          :class="{ 'auth-panel__mode--active': mode === 'login' }"
          @click="switchMode('login')"
        >
          Вход
        </button>
        <button
          type="button"
          class="auth-panel__mode"
          :class="{ 'auth-panel__mode--active': mode === 'register' }"
          @click="switchMode('register')"
        >
          Регистрация
        </button>
      </div>

      <form class="auth-panel__form" @submit.prevent="void submit()">
        <label class="auth-panel__field">
          <span class="auth-panel__label">Логин</span>
          <input
            v-model="username"
            class="auth-panel__input"
            type="text"
            name="username"
            autocomplete="username"
            placeholder="Например, bboysquiz"
          >
        </label>

        <label class="auth-panel__field">
          <span class="auth-panel__label">Пароль</span>
          <input
            v-model="password"
            class="auth-panel__input"
            type="password"
            name="password"
            autocomplete="current-password"
            placeholder="Минимум 8 символов"
          >
        </label>

        <p v-if="localError || authStore.authError" class="auth-panel__error">
          {{ localError ?? authStore.authError }}
        </p>

        <button
          type="submit"
          class="app-button app-button--primary auth-panel__submit"
          :disabled="!canSubmit"
        >
          {{ authStore.isSubmitting ? 'Подключаем аккаунт...' : submitLabel }}
        </button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.auth-panel {
  max-width: 34rem;
  margin: 0 auto;
}

.auth-panel__modes {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
  padding: 0.36rem;
  border-radius: 18px;
  background: rgba(35, 28, 21, 0.05);
}

.auth-panel__mode {
  min-height: 2.75rem;
  padding: 0.65rem 1rem;
  border-radius: 14px;
  color: var(--text-muted);
  font-weight: 700;
}

.auth-panel__mode--active {
  background: rgba(255, 255, 255, 0.92);
  color: var(--text);
  box-shadow: 0 8px 18px rgba(71, 50, 24, 0.08);
}

.auth-panel__form {
  display: flex;
  flex-direction: column;
  gap: 0.88rem;
}

.auth-panel__field {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

.auth-panel__label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-muted);
}

.auth-panel__input {
  min-height: 3.15rem;
  padding: 0.82rem 0.96rem;
  border: 1px solid rgba(180, 154, 123, 0.34);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--text);
}

.auth-panel__input:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}

.auth-panel__error {
  margin: 0;
  color: #9f3b35;
  font-size: 0.88rem;
  line-height: 1.45;
}

.auth-panel__submit {
  width: 100%;
}
</style>
