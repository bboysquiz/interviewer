export interface ClipboardAvailability {
  hasText: boolean
  hasImage: boolean
}

export interface ClipboardReadResult {
  text: string | null
  imageFiles: File[]
}

const getClipboardItems = async (): Promise<ClipboardItem[]> => {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.read !== 'function'
  ) {
    return []
  }

  return navigator.clipboard.read()
}

export const probeClipboardAvailability = async (): Promise<ClipboardAvailability> => {
  try {
    const items = await getClipboardItems()

    if (items.length > 0) {
      const hasImage = items.some((item) =>
        item.types.some((type) => type.startsWith('image/')),
      )
      const hasText = items.some((item) => item.types.includes('text/plain'))

      return {
        hasText,
        hasImage,
      }
    }
  } catch {
    // Fall back to readText below.
  }

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.readText === 'function'
  ) {
    try {
      const text = await navigator.clipboard.readText()

      return {
        hasText: text.trim().length > 0,
        hasImage: false,
      }
    } catch {
      return {
        hasText: false,
        hasImage: false,
      }
    }
  }

  return {
    hasText: false,
    hasImage: false,
  }
}

export const readClipboardContent = async (): Promise<ClipboardReadResult> => {
  const imageFiles: File[] = []
  let text: string | null = null

  try {
    const items = await getClipboardItems()

    for (const item of items) {
      for (const type of item.types) {
        if (!text && type === 'text/plain') {
          const blob = await item.getType(type)
          text = await blob.text()
          continue
        }

        if (type.startsWith('image/')) {
          const blob = await item.getType(type)
          const file = new File([blob], `clipboard-image-${Date.now()}.${type.split('/')[1] ?? 'png'}`, {
            type,
            lastModified: Date.now(),
          })
          imageFiles.push(file)
        }
      }
    }
  } catch {
    // Fall back to readText below.
  }

  if (!text && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      const fallbackText = await navigator.clipboard.readText()

      if (fallbackText.trim()) {
        text = fallbackText
      }
    } catch {
      // Ignore secondary failures.
    }
  }

  return {
    text,
    imageFiles,
  }
}
