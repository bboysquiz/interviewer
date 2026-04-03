<script setup lang="ts">
import { CATEGORY_COLOR_PRESETS } from '@/features/categories/categoryForm'
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

const setPresetColor = (color: string): void => {
  form.value = {
    ...form.value,
    color,
  }
}
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
        placeholder="Коротко опиши, что будет внутри категории"
      />
    </label>

    <div class="category-form__field">
      <span class="category-form__label">Цвет</span>
      <input
        v-model.trim="form.color"
        class="category-form__input"
        type="text"
        name="color"
        placeholder="#6cbf93"
        maxlength="16"
      />

      <div class="category-form__chips">
        <button
          v-for="color in CATEGORY_COLOR_PRESETS"
          :key="color"
          type="button"
          class="category-form__color-chip"
          :class="{
            'category-form__color-chip--active': form.color === color,
          }"
          :style="{ '--chip-color': color }"
          @click="setPresetColor(color)"
        >
          {{ color }}
        </button>
      </div>
    </div>

    <div class="category-form__grid">
      <label class="category-form__field">
        <span class="category-form__label">Короткая метка</span>
        <input
          v-model.trim="form.icon"
          class="category-form__input"
          type="text"
          name="icon"
          placeholder="JS"
          maxlength="4"
        />
      </label>

      <label class="category-form__field">
        <span class="category-form__label">Порядок</span>
        <input
          v-model.trim="form.sortOrder"
          class="category-form__input"
          type="text"
          name="sortOrder"
          inputmode="numeric"
          placeholder="0"
        />
      </label>
    </div>

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

.category-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.72rem;
}

.category-form__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.48rem;
}

.category-form__color-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.36rem;
  padding: 0.44rem 0.66rem;
  border: 1px solid rgba(180, 154, 123, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 700;
}

.category-form__color-chip::before {
  content: '';
  width: 0.72rem;
  height: 0.72rem;
  border-radius: 999px;
  background: var(--chip-color);
}

.category-form__color-chip--active {
  border-color: var(--accent);
  color: var(--accent-strong);
  background: var(--accent-soft);
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

@media (max-width: 360px) {
  .category-form__grid {
    grid-template-columns: 1fr;
  }
}
</style>
