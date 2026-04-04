import type {
  CreateCategoryInput,
} from '@/services/client/knowledgeBaseApi'
import type { Category } from '@/types'

export interface CategoryFormValues {
  name: string
  description: string
}

export const createEmptyCategoryForm = (): CategoryFormValues => ({
  name: '',
  description: '',
})

export const createCategoryFormFromCategory = (
  category: Category,
): CategoryFormValues => ({
  name: category.name,
  description: category.description,
})

export const toCategoryMutationInput = (
  values: CategoryFormValues,
): CreateCategoryInput => {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
  }
}
