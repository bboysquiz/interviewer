import type { CodeBlockLanguage } from '@/features/editor/codeBlocks'

export interface CodeAutocompleteResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

const OPENING_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
}

const CLOSING_PAIR_KEYS = new Set(Object.values(OPENING_PAIRS))
const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const supportsHtmlTagAutocomplete = (language: CodeBlockLanguage): boolean =>
  language === 'html' || language === 'vue'

const inferHtmlClosingTag = (
  value: string,
  selectionStart: number,
): string | null => {
  const before = value.slice(0, selectionStart)

  if (before.endsWith('/')) {
    return null
  }

  const match = before.match(/<([A-Za-z][\w:-]*)(?:\s[^<>]*)?$/u)

  if (!match) {
    return null
  }

  const tagName = match[1]

  if (!tagName || VOID_HTML_TAGS.has(tagName.toLowerCase())) {
    return null
  }

  const after = value.slice(selectionStart)
  const normalizedAfter = after.trimStart().toLowerCase()

  if (normalizedAfter.startsWith(`</${tagName.toLowerCase()}`)) {
    return null
  }

  return `</${tagName}>`
}

export const getCodeAutocompleteResult = (params: {
  key: string
  value: string
  selectionStart: number
  selectionEnd: number
  language: CodeBlockLanguage
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}): CodeAutocompleteResult | null => {
  const {
    key,
    value,
    selectionStart,
    selectionEnd,
    language,
    ctrlKey = false,
    metaKey = false,
    altKey = false,
  } = params

  if (ctrlKey || metaKey || altKey) {
    return null
  }

  const safeStart = Math.max(0, Math.min(selectionStart, value.length))
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length))
  const before = value.slice(0, safeStart)
  const selectedText = value.slice(safeStart, safeEnd)
  const after = value.slice(safeEnd)

  const closingPair = OPENING_PAIRS[key]

  if (closingPair) {
    return {
      value: `${before}${key}${selectedText}${closingPair}${after}`,
      selectionStart: safeStart + 1,
      selectionEnd: safeStart + 1 + selectedText.length,
    }
  }

  if (
    CLOSING_PAIR_KEYS.has(key) &&
    safeStart === safeEnd &&
    value[safeStart] === key
  ) {
    return {
      value,
      selectionStart: safeStart + 1,
      selectionEnd: safeStart + 1,
    }
  }

  if (key === '>' && safeStart === safeEnd && supportsHtmlTagAutocomplete(language)) {
    const closingTag = inferHtmlClosingTag(value, safeStart)

    if (!closingTag) {
      return null
    }

    return {
      value: `${before}>${closingTag}${after}`,
      selectionStart: safeStart + 1,
      selectionEnd: safeStart + 1,
    }
  }

  return null
}
