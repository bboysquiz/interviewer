<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
const visibleCategories = ref<Category[]>([])
const draggedCategoryId = ref<string | null>(null)
const dragOverCategoryId = ref<string | null>(null)
const dragOriginOrderIds = ref<string[]>([])
const reorderError = ref<string | null>(null)
const isReordering = ref(false)

let activeDragPointerId: number | null = null

const categoryPendingDelete = computed(
  () =>
    categories.value.find((category) => category.id === confirmingDeleteId.value) ??
    null,
)
const isCategoryDragDisabled = computed(
  () =>
    isReordering.value ||
    Boolean(editingCategoryId.value) ||
    Boolean(updatingCategoryId.value) ||
    Boolean(deletingCategoryId.value),
)

watch(
  categories,
  (nextCategories) => {
    if (!draggedCategoryId.value) {
      visibleCategories.value = [...nextCategories]
    }
  },
  { immediate: true },
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

const getCategoryIdFromPoint = (event: PointerEvent): string | null => {
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const categoryCard = target?.closest<HTMLElement>('[data-category-id]')

  return categoryCard?.dataset.categoryId ?? null
}

const moveVisibleCategory = (
  draggedCategoryId: string,
  targetCategoryId: string,
): void => {
  if (draggedCategoryId === targetCategoryId) {
    return
  }

  const fromIndex = visibleCategories.value.findIndex(
    (category) => category.id === draggedCategoryId,
  )
  const toIndex = visibleCategories.value.findIndex(
    (category) => category.id === targetCategoryId,
  )

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return
  }

  const nextCategories = [...visibleCategories.value]
  const [draggedCategory] = nextCategories.splice(fromIndex, 1)

  if (!draggedCategory) {
    return
  }

  nextCategories.splice(toIndex, 0, draggedCategory)
  visibleCategories.value = nextCategories
}

const autoScrollDuringDrag = (event: PointerEvent): void => {
  const edgeSize = 96
  const maxStep = 18
  const viewportHeight = window.innerHeight
  let scrollStep = 0

  if (event.clientY < edgeSize) {
    scrollStep = -maxStep
  } else if (viewportHeight - event.clientY < edgeSize) {
    scrollStep = maxStep
  }

  if (scrollStep) {
    document.scrollingElement?.scrollBy({ top: scrollStep })
  }
}

const handleCategoryDragMove = (event: PointerEvent): void => {
  if (
    activeDragPointerId !== event.pointerId ||
    !draggedCategoryId.value
  ) {
    return
  }

  event.preventDefault()
  autoScrollDuringDrag(event)

  const targetCategoryId = getCategoryIdFromPoint(event)
  dragOverCategoryId.value = targetCategoryId

  if (targetCategoryId) {
    moveVisibleCategory(draggedCategoryId.value, targetCategoryId)
  }
}

const cleanupCategoryDragListeners = (): void => {
  window.removeEventListener('pointermove', handleCategoryDragMove)
  window.removeEventListener('pointerup', finishCategoryDrag)
  window.removeEventListener('pointercancel', cancelCategoryDrag)
  activeDragPointerId = null
}

const resetCategoryDragState = (): void => {
  draggedCategoryId.value = null
  dragOverCategoryId.value = null
  dragOriginOrderIds.value = []
}

const cancelCategoryDrag = (): void => {
  cleanupCategoryDragListeners()
  visibleCategories.value = [...categories.value]
  resetCategoryDragState()
}

const finishCategoryDrag = async (event: PointerEvent): Promise<void> => {
  if (activeDragPointerId !== event.pointerId) {
    return
  }

  event.preventDefault()
  cleanupCategoryDragListeners()

  const nextOrderIds = visibleCategories.value.map((category) => category.id)
  const hasOrderChanged =
    nextOrderIds.length !== dragOriginOrderIds.value.length ||
    nextOrderIds.some(
      (categoryId, index) => categoryId !== dragOriginOrderIds.value[index],
    )

  resetCategoryDragState()

  if (!hasOrderChanged) {
    visibleCategories.value = [...categories.value]
    return
  }

  isReordering.value = true
  reorderError.value = null

  try {
    await knowledgeBaseStore.reorderCategories(nextOrderIds)
  } catch (error) {
    visibleCategories.value = [...categories.value]
    reorderError.value =
      error instanceof Error ? error.message : 'Не удалось сохранить порядок тем.'
  } finally {
    isReordering.value = false
  }
}

const startCategoryDrag = (
  category: Category,
  event: PointerEvent,
): void => {
  if (
    isCategoryDragDisabled.value ||
    (event.pointerType === 'mouse' && event.button !== 0)
  ) {
    return
  }

  event.preventDefault()
  reorderError.value = null
  activeDragPointerId = event.pointerId
  draggedCategoryId.value = category.id
  dragOverCategoryId.value = category.id
  dragOriginOrderIds.value = visibleCategories.value.map(
    (visibleCategory) => visibleCategory.id,
  )

  window.addEventListener('pointermove', handleCategoryDragMove, {
    passive: false,
  })
  window.addEventListener('pointerup', finishCategoryDrag)
  window.addEventListener('pointercancel', cancelCategoryDrag)
}

onBeforeUnmount(() => {
  cleanupCategoryDragListeners()
})
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
      <AppNotice
        v-if="isReordering"
        tone="loading"
        title="Сохраняем порядок"
        message="Фиксируем новый порядок тем на сервере."
      />

      <AppNotice
        v-if="reorderError"
        tone="error"
        title="Не удалось сохранить порядок"
        :message="reorderError"
      />

      <div v-if="!visibleCategories.length" class="categories-page__empty">
        Тем пока нет. Добавь первую тему, чтобы начать вести конспект.
      </div>

      <div v-else class="categories-page__list">
        <article
          v-for="category in visibleCategories"
          :key="category.id"
          class="category-card"
          :class="{
            'category-card--editing': editingCategoryId === category.id,
            'category-card--dragging': draggedCategoryId === category.id,
            'category-card--drop-target':
              dragOverCategoryId === category.id &&
              draggedCategoryId !== category.id,
          }"
          :data-category-id="category.id"
        >
          <div class="category-card__head">
            <div class="category-card__copy">
              <h3 class="category-card__title">{{ category.name }}</h3>
              <p class="category-card__description">
                {{ category.description || 'Описание пока не заполнено.' }}
              </p>
            </div>

            <button
              class="category-card__drag-handle"
              type="button"
              :disabled="isCategoryDragDisabled"
              :aria-label="`Изменить порядок темы ${category.name}`"
              @pointerdown="startCategoryDrag(category, $event)"
            >
              <span class="category-card__drag-dots" aria-hidden="true"></span>
            </button>
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

.category-card--dragging {
  opacity: 0.68;
  transform: scale(0.985);
  border-color: rgba(31, 109, 90, 0.48);
  box-shadow: 0 18px 34px rgba(31, 109, 90, 0.14);
}

.category-card--drop-target {
  border-color: rgba(232, 138, 69, 0.55);
  box-shadow:
    inset 0 0 0 2px rgba(232, 138, 69, 0.2),
    0 16px 28px rgba(71, 50, 24, 0.08);
}

.category-card__head {
  display: flex;
  align-items: flex-start;
  gap: 0.72rem;
}

.category-card__copy {
  min-width: 0;
  flex: 1;
}

.category-card__drag-handle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid rgba(180, 154, 123, 0.28);
  border-radius: 14px;
  background: rgba(255, 250, 243, 0.86);
  color: rgba(107, 91, 76, 0.8);
  box-shadow: 0 8px 16px rgba(71, 50, 24, 0.06);
  cursor: grab;
  touch-action: none;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    background 0.18s ease;
}

.category-card__drag-handle:hover:not(:disabled),
.category-card__drag-handle:focus-visible {
  border-color: rgba(31, 109, 90, 0.34);
  background: rgba(231, 242, 236, 0.88);
  color: var(--accent);
  transform: translateY(-1px);
}

.category-card__drag-handle:active:not(:disabled) {
  cursor: grabbing;
  transform: translateY(0) scale(0.98);
}

.category-card__drag-handle:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

.category-card__drag-dots {
  width: 1rem;
  height: 1.35rem;
  background-image: radial-gradient(circle, currentColor 1.6px, transparent 1.8px);
  background-position: 0 0;
  background-size: 0.5rem 0.5rem;
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
  .category-card:not(.category-card--dragging):hover {
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

@media (min-width: 1100px) {
  .categories-page {
    display: grid;
    grid-template-columns: minmax(19rem, 24rem) minmax(0, 1fr);
    align-items: start;
  }

  .categories-page > :deep(.surface-card) {
    min-height: 100%;
  }

  .categories-page__list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .category-card {
    height: 100%;
  }

  .category-card__actions {
    margin-top: auto;
  }
}

@media (min-width: 1480px) {
  .categories-page__list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
