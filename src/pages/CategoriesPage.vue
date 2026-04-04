<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import CategoryForm from '@/features/categories/CategoryForm.vue'
import {
  createCategoryFormFromCategory,
  createEmptyCategoryForm,
  toCategoryMutationInput,
} from '@/features/categories/categoryForm'
import AppNotice from '@/shared/ui/AppNotice.vue'
import ConfirmSheet from '@/shared/ui/ConfirmSheet.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import type { Category } from '@/types'

const knowledgeBaseStore = useKnowledgeBaseStore()
const { categories, hasLoaded, isLoading, loadError } =
  storeToRefs(knowledgeBaseStore)

const createForm = ref(createEmptyCategoryForm())
const editForm = ref(createEmptyCategoryForm())

const createError = ref<string | null>(null)
const editError = ref<string | null>(null)
const deleteError = ref<string | null>(null)

const isCreating = ref(false)
const isCreateFormVisible = ref(false)
const updatingCategoryId = ref<string | null>(null)
const deletingCategoryId = ref<string | null>(null)
const editingCategoryId = ref<string | null>(null)
const confirmingDeleteId = ref<string | null>(null)

const categoryPendingDelete = computed(
  () =>
    categories.value.find((category) => category.id === confirmingDeleteId.value) ??
    null,
)

const resetCreateForm = (): void => {
  createForm.value = createEmptyCategoryForm()
  createError.value = null
}

const toggleCreateForm = (): void => {
  isCreateFormVisible.value = !isCreateFormVisible.value

  if (!isCreateFormVisible.value) {
    resetCreateForm()
  }
}

const cancelEdit = (): void => {
  editingCategoryId.value = null
  editForm.value = createEmptyCategoryForm()
  editError.value = null
}

const startEdit = (category: Category): void => {
  editingCategoryId.value = category.id
  editForm.value = createCategoryFormFromCategory(category)
  editError.value = null
  deleteError.value = null
  confirmingDeleteId.value = null
}

const openDeleteConfirmation = (categoryId: string): void => {
  deleteError.value = null
  confirmingDeleteId.value = categoryId
  cancelEdit()
}

const closeDeleteConfirmation = (): void => {
  if (deletingCategoryId.value) {
    return
  }

  confirmingDeleteId.value = null
  deleteError.value = null
}

const submitCreate = async (): Promise<void> => {
  createError.value = null

  if (!createForm.value.name.trim()) {
    createError.value = 'Укажи название темы.'
    return
  }

  isCreating.value = true

  try {
    await knowledgeBaseStore.createCategory(
      toCategoryMutationInput(createForm.value),
    )
    resetCreateForm()
    isCreateFormVisible.value = false
  } catch (error) {
    createError.value =
      error instanceof Error ? error.message : 'Не удалось создать тему.'
  } finally {
    isCreating.value = false
  }
}

const submitEdit = async (): Promise<void> => {
  const categoryId = editingCategoryId.value

  if (!categoryId) {
    return
  }

  editError.value = null

  if (!editForm.value.name.trim()) {
    editError.value = 'Название темы не должно быть пустым.'
    return
  }

  updatingCategoryId.value = categoryId

  try {
    await knowledgeBaseStore.updateCategory(
      categoryId,
      toCategoryMutationInput(editForm.value),
    )
    cancelEdit()
  } catch (error) {
    editError.value =
      error instanceof Error ? error.message : 'Не удалось обновить тему.'
  } finally {
    updatingCategoryId.value = null
  }
}

const confirmDelete = async (category: Category): Promise<void> => {
  deleteError.value = null
  deletingCategoryId.value = category.id

  try {
    await knowledgeBaseStore.deleteCategory(category.id)
    confirmingDeleteId.value = null

    if (editingCategoryId.value === category.id) {
      cancelEdit()
    }
  } catch (error) {
    deleteError.value =
      error instanceof Error ? error.message : 'Не удалось удалить тему.'
  } finally {
    deletingCategoryId.value = null
  }
}

const reloadCategories = async (): Promise<void> => {
  await knowledgeBaseStore.loadCategories()
}
</script>

<template>
  <div class="page-stack categories-page">
    <SurfaceCard title="Темы">
      <div class="categories-page__toolbar">
        <button
          class="app-button app-button--primary"
          type="button"
          :disabled="isCreating"
          @click="toggleCreateForm"
        >
          {{ isCreateFormVisible ? 'Скрыть форму' : 'Добавить тему' }}
        </button>
      </div>

      <AppNotice
        v-if="isLoading && !hasLoaded"
        tone="loading"
        title="Подключаем темы"
        message="Загружаем список тем с сервера."
      />

      <AppNotice
        v-if="loadError"
        tone="error"
        title="Не удалось обновить темы"
        :message="loadError"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isLoading"
            @click="void reloadCategories()"
          >
            {{ isLoading ? 'Пробуем снова...' : 'Повторить' }}
          </button>
        </template>
      </AppNotice>

      <div v-if="isCreateFormVisible" class="categories-page__create-form">
        <CategoryForm
          v-model="createForm"
          submit-label="Создать тему"
          :is-submitting="isCreating"
          :error-message="createError"
          show-cancel
          cancel-label="Скрыть"
          @submit="submitCreate"
          @cancel="toggleCreateForm"
        />
      </div>
    </SurfaceCard>

    <SurfaceCard title="Список тем">
      <div v-if="!categories.length" class="categories-page__empty">
        Тем пока нет. Добавь первую тему, чтобы начать вести конспект.
      </div>

      <div v-else class="categories-page__list">
        <article
          v-for="category in categories"
          :key="category.id"
          class="category-card"
          :class="{
            'category-card--editing': editingCategoryId === category.id,
          }"
        >
          <div class="category-card__head">
            <div class="category-card__copy">
              <h3 class="category-card__title">{{ category.name }}</h3>
              <p class="category-card__description">
                {{ category.description || 'Описание пока не заполнено.' }}
              </p>
            </div>
          </div>

          <div class="category-card__actions">
            <RouterLink
              class="app-button app-button--primary"
              :to="{
                name: 'category-notes',
                params: {
                  categoryId: category.id,
                },
              }"
            >
              Открыть
            </RouterLink>

            <button
              class="app-button app-button--secondary"
              type="button"
              :disabled="Boolean(deletingCategoryId)"
              @click="startEdit(category)"
            >
              Редактировать
            </button>

            <button
              class="app-button app-button--danger"
              type="button"
              :disabled="Boolean(updatingCategoryId)"
              @click="openDeleteConfirmation(category.id)"
            >
              Удалить
            </button>
          </div>

          <div
            v-if="editingCategoryId === category.id"
            class="category-card__editor"
          >
            <CategoryForm
              v-model="editForm"
              submit-label="Сохранить изменения"
              :is-submitting="updatingCategoryId === category.id"
              :error-message="editError"
              show-cancel
              @submit="submitEdit"
              @cancel="cancelEdit"
            />
          </div>
        </article>
      </div>
    </SurfaceCard>

    <ConfirmSheet
      v-if="categoryPendingDelete"
      :open="true"
      title="Удалить тему?"
      :description="`Тема «${categoryPendingDelete.name}» будет удалена вместе с её конспектом и вложениями.`"
      confirm-label="Удалить тему"
      :is-submitting="deletingCategoryId === categoryPendingDelete.id"
      :error-message="deleteError"
      @cancel="closeDeleteConfirmation"
      @confirm="void confirmDelete(categoryPendingDelete)"
    />
  </div>
</template>

<style scoped>
.categories-page__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.72rem;
}

.categories-page__create-form {
  padding-top: 0.2rem;
}

.categories-page__empty {
  padding: 1rem;
  border: 1px dashed rgba(180, 154, 123, 0.4);
  border-radius: 18px;
  color: var(--text-muted);
  text-align: center;
}

.categories-page__list {
  display: flex;
  flex-direction: column;
  gap: 0.82rem;
}

.category-card {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
  padding: 1.02rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(255, 250, 243, 0.58));
  box-shadow: 0 12px 24px rgba(71, 50, 24, 0.06);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.category-card--editing {
  background: rgba(255, 250, 243, 0.88);
  border-color: rgba(31, 109, 90, 0.28);
  box-shadow: 0 16px 28px rgba(31, 109, 90, 0.08);
}

.category-card__copy {
  min-width: 0;
  flex: 1;
}

.category-card__title {
  margin: 0 0 0.2rem;
  font-size: 1rem;
  line-height: 1.2;
}

.category-card__description {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
}

.category-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.category-card__actions > * {
  flex: 1 1 calc(50% - 0.3rem);
}

.category-card__editor {
  padding-top: 0.15rem;
  border-top: 1px solid rgba(180, 154, 123, 0.2);
}

@media (hover: hover) {
  .category-card:hover {
    transform: translateY(-1px);
    border-color: rgba(31, 109, 90, 0.18);
    box-shadow: 0 16px 28px rgba(71, 50, 24, 0.09);
  }
}

@media (min-width: 420px) {
  .category-card__actions > * {
    flex: 0 1 auto;
  }
}
</style>
