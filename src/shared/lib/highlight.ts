const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const extractSearchTerms = (value: string): string[] =>
  [...new Set(
    value
      .trim()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  )].sort((left, right) => right.length - left.length)

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const highlightText = (value: string, query: string): string => {
  const terms = extractSearchTerms(query)
  const escapedValue = escapeHtml(value)

  if (!terms.length || !escapedValue) {
    return escapedValue
  }

  const pattern = new RegExp(
    `(${terms.map((term) => escapeRegExp(term)).join('|')})`,
    'gi',
  )

  return escapedValue.replace(pattern, '<mark>$1</mark>')
}
