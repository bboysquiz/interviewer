import { ref } from 'vue'
import { defineStore } from 'pinia'

import {
  knowledgeBaseApi,
  type CreateNoteInput,
  type OrganizeNoteResponse,
  type UpdateNoteInput,
} from '@/services/client/knowledgeBaseApi'
import type { Note } from '@/types'

import { useKnowledgeBaseStore } from './knowledgeBase'

const sortNotes = (value: Note[]): Note[] =>
  [...value].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt)
    }

    return right.createdAt.localeCompare(left.createdAt)
  })

export const useNotesStore = defineStore('notes', () => {
  const notesByCategory = ref<Record<string, Note[]>>({})
  const notesById = ref<Record<string, Note>>({})
  const categoryLoadingState = ref<Record<string, boolean>>({})
  const noteLoadingState = ref<Record<string, boolean>>({})
  const categoryErrors = ref<Record<string, string | null>>({})
  const noteErrors = ref<Record<string, string | null>>({})

  const upsertNote = (note: Note): void => {
    notesById.value[note.id] = note

    const currentCategoryNotes = notesByCategory.value[note.categoryId] ?? []
    const hasExistingNote = currentCategoryNotes.some(
      (currentNote) => currentNote.id === note.id,
    )

    notesByCategory.value[note.categoryId] = sortNotes(
      hasExistingNote
        ? currentCategoryNotes.map((currentNote) =>
            currentNote.id === note.id ? note : currentNote,
          )
        : [...currentCategoryNotes, note],
    )
  }

  const removeNote = (noteId: string, categoryId?: string): void => {
    delete notesById.value[noteId]
    delete noteErrors.value[noteId]

    if (categoryId) {
      const currentCategoryNotes = notesByCategory.value[categoryId] ?? []
      notesByCategory.value[categoryId] = currentCategoryNotes.filter(
        (note) => note.id !== noteId,
      )
      return
    }

    for (const currentCategoryId of Object.keys(notesByCategory.value)) {
      notesByCategory.value[currentCategoryId] = notesByCategory.value[
        currentCategoryId
      ].filter((note) => note.id !== noteId)
    }
  }

  const loadNotesByCategory = async (
    categoryId: string,
    options: { force?: boolean } = {},
  ): Promise<Note[]> => {
    if (!categoryId) {
      return []
    }

    if (!options.force && notesByCategory.value[categoryId]) {
      return notesByCategory.value[categoryId]
    }

    if (categoryLoadingState.value[categoryId]) {
      return notesByCategory.value[categoryId] ?? []
    }

    categoryLoadingState.value[categoryId] = true

    try {
      const notes = sortNotes(await knowledgeBaseApi.listNotes(categoryId))
      notesByCategory.value[categoryId] = notes
      categoryErrors.value[categoryId] = null

      for (const note of notes) {
        notesById.value[note.id] = note
      }

      return notes
    } catch (error) {
      categoryErrors.value[categoryId] =
        error instanceof Error ? error.message : 'Не удалось загрузить заметки.'
      throw error
    } finally {
      categoryLoadingState.value[categoryId] = false
    }
  }

  const loadNote = async (
    noteId: string,
    options: { force?: boolean } = {},
  ): Promise<Note> => {
    if (!noteId) {
      throw new Error('Не указан идентификатор заметки.')
    }

    if (!options.force && notesById.value[noteId]) {
      return notesById.value[noteId]
    }

    if (noteLoadingState.value[noteId] && notesById.value[noteId]) {
      return notesById.value[noteId]
    }

    noteLoadingState.value[noteId] = true

    try {
      const note = await knowledgeBaseApi.getNote(noteId)
      noteErrors.value[noteId] = null
      upsertNote(note)
      return note
    } catch (error) {
      noteErrors.value[noteId] =
        error instanceof Error ? error.message : 'Не удалось загрузить заметку.'
      throw error
    } finally {
      noteLoadingState.value[noteId] = false
    }
  }

  const createNote = async (input: CreateNoteInput): Promise<Note> => {
    const note = await knowledgeBaseApi.createNote(input)
    upsertNote(note)
    await useKnowledgeBaseStore().loadCategories()
    return note
  }

  const updateNote = async (
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<Note> => {
    const previousNote = notesById.value[noteId]
    const updatedNote = await knowledgeBaseApi.updateNote(noteId, input)

    if (previousNote && previousNote.categoryId !== updatedNote.categoryId) {
      removeNote(noteId, previousNote.categoryId)
    }

    upsertNote(updatedNote)
    await useKnowledgeBaseStore().loadCategories()
    return updatedNote
  }

  const organizeNote = async (noteId: string): Promise<OrganizeNoteResponse> => {
    const response = await knowledgeBaseApi.organizeNote(noteId)
    upsertNote(response.note)
    await useKnowledgeBaseStore().loadCategories()
    return response
  }

  const deleteNote = async (noteId: string): Promise<void> => {
    const existingNote = notesById.value[noteId]
    await knowledgeBaseApi.deleteNote(noteId)
    removeNote(noteId, existingNote?.categoryId)
    await useKnowledgeBaseStore().loadCategories()
  }

  return {
    notesByCategory,
    notesById,
    categoryLoadingState,
    noteLoadingState,
    categoryErrors,
    noteErrors,
    loadNotesByCategory,
    loadNote,
    createNote,
    updateNote,
    organizeNote,
    deleteNote,
  }
})
