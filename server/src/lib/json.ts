export const parseStringArray = (value: string | null | undefined): string[] => {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export const toJson = (value: unknown): string => JSON.stringify(value)
