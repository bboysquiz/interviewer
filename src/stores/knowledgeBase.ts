import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  knowledgeBaseApi,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@/services/client/knowledgeBaseApi'
import type { Category } from '@/types'

const sortCategories = (value: Category[]): Category[] =>
  [...value].sort((left, right) => left.name.localeCompare(right.name, 'ru'))

export const useKnowledgeBaseStore = defineStore('knowledge-base', () => {
  const categories = ref<Category[]>([])
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const loadError = ref<string | null>(null)

  const totalCategories = computed(() => categories.value.length)

  const loadCategories = async (): Promise<void> => {
    if (isLoading.value) {
      return
    }

    isLoading.value = true

    try {
      categories.value = sortCategories(await knowledgeBaseApi.listCategories())
      hasLoaded.value = true
      loadError.value = null
    } catch (error) {
      loadError.value =
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить категории.'
    } finally {
      isLoading.value = false
    }
  }

  const createCategory = async (
    input: CreateCategoryInput,
  ): Promise<Category> => {
    const created = await knowledgeBaseApi.createCategory(input)
    categories.value = sortCategories([...categories.value, created])
    return created
  }

  const updateCategory = async (
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<Category> => {
    const updated = await knowledgeBaseApi.updateCategory(categoryId, input)
    categories.value = sortCategories(
      categories.value.map((category) =>
        category.id === categoryId ? updated : category,
      ),
    )
    return updated
  }

  const deleteCategory = async (categoryId: string): Promise<void> => {
    await knowledgeBaseApi.deleteCategory(categoryId)
    categories.value = categories.value.filter(
      (category) => category.id !== categoryId,
    )
  }

  const resetState = (): void => {
    categories.value = []
    isLoading.value = false
    hasLoaded.value = false
    loadError.value = null
  }

  return {
    categories,
    isLoading,
    hasLoaded,
    loadError,
    totalCategories,
    loadCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    resetState,
  }
})
