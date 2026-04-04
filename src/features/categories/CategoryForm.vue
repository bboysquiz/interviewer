<script setup lang="ts">
import type { CategoryFormValues } from '@/features/categories/categoryForm'

const form = defineModel<CategoryFormValues>({ required: true })

withDefaults(
  defineProps<{
    submitLabel: string
    isSubmitting?: boolean
    errorMessage?: string | null
    cancelLabel?: string
    showCancel?: boolean
  }>(),
  {
    isSubmitting: false,
    errorMessage: null,
    cancelLabel: 'Отмена',
    showCancel: false,
  },
)

const emit = defineEmits<{
  submit: []
  cancel: []
}>()
</script>

<template>
  <form class="category-form" @submit.prevent="emit('submit')">
    <label class="category-form__field">
      <span class="category-form__label">Название</span>
      <input
        v-model.trim="form.name"
        class="category-form__input"
        type="text"
        name="name"
        placeholder="Например, JavaScript"
        maxlength="64"
        required
      />
    </label>

    <label class="category-form__field">
      <span class="category-form__label">Описание</span>
      <textarea
        v-model.trim="form.description"
        class="category-form__textarea"
        name="description"
        rows="3"
        placeholder="Коротко опиши, что будет внутри темы"
      />
    </label>

    <p v-if="errorMessage" class="category-form__error">
      {{ errorMessage }}
    </p>

    <div class="category-form__actions">
      <button
        class="app-button app-button--primary"
        type="submit"
        :disabled="isSubmitting"
      >
        {{ isSubmitting ? 'Сохраняем...' : submitLabel }}
      </button>

      <button
        v-if="showCancel"
        class="app-button app-button--secondary"
        type="button"
        :disabled="isSubmitting"
        @click="emit('cancel')"
      >
        {{ cancelLabel }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.category-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.category-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
}

.category-form__label {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.category-form__input,
.category-form__textarea {
  width: 100%;
  border: 1px solid rgba(180, 154, 123, 0.35);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text);
  padding: 0.78rem 0.92rem;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.category-form__textarea {
  min-height: 6rem;
  resize: vertical;
}

.category-form__input:focus,
.category-form__textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(31, 109, 90, 0.12);
  background: var(--surface-strong);
}

.category-form__error {
  margin: 0;
  padding: 0.7rem 0.82rem;
  border-radius: 16px;
  background: rgba(181, 65, 59, 0.12);
  color: #9f3b35;
  font-size: 0.85rem;
}

.category-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
</style>
