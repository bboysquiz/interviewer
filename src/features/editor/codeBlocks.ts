export const CODE_BLOCK_LANGUAGE_OPTIONS = [
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'js', label: 'JavaScript' },
  { value: 'vue', label: 'Vue' },
  { value: 'ts', label: 'TypeScript' },
] as const

export type CodeBlockLanguage =
  (typeof CODE_BLOCK_LANGUAGE_OPTIONS)[number]['value']

export interface TextLikeBlock {
  id: string
  type: 'text'
  text: string
}

export interface CodeLikeBlock {
  id: string
  type: 'code'
  language: CodeBlockLanguage
  code: string
}

export type TextAndCodeBlock = TextLikeBlock | CodeLikeBlock

export const DEFAULT_CODE_BLOCK_LANGUAGE: CodeBlockLanguage = 'js'

export const normalizeEditorText = (value: string): string =>
  value.replace(/\r\n?/g, '\n')

export const hasMeaningfulEditorText = (value: string): boolean =>
  normalizeEditorText(value).trim().length > 0

export const serializeTextAndCodeBlocksToPlainText = (
  blocks: TextAndCodeBlock[],
): string =>
  blocks
    .map((block) => {
      if (block.type === 'text') {
        return normalizeEditorText(block.text).trim()
      }

      const normalizedCode = normalizeEditorText(block.code).trim()

      if (!normalizedCode) {
        return ''
      }

      return `\`\`\`${block.language}\n${normalizedCode}\n\`\`\``
    })
    .filter(Boolean)
    .join('\n\n')

const codeFencePattern = /```(html|css|js|vue|ts)?\n([\s\S]*?)```/gi

export const parsePlainTextToTextAndCodeBlocks = (
  rawValue: string,
  createTextBlock: (text?: string) => TextLikeBlock,
  createCodeBlock: (
    code?: string,
    language?: CodeBlockLanguage,
  ) => CodeLikeBlock,
): TextAndCodeBlock[] => {
  const normalized = normalizeEditorText(rawValue)
  const blocks: TextAndCodeBlock[] = []
  let lastIndex = 0

  normalized.replace(
    codeFencePattern,
    (fullMatch, language: string | undefined, code: string, offset: number) => {
      const beforeText = normalized.slice(lastIndex, offset)

      if (beforeText) {
        blocks.push(createTextBlock(beforeText))
      }

      blocks.push(
        createCodeBlock(
          code.replace(/\n$/, ''),
          (language as CodeBlockLanguage | undefined) ?? DEFAULT_CODE_BLOCK_LANGUAGE,
        ),
      )

      lastIndex = offset + fullMatch.length
      return fullMatch
    },
  )

  const tailText = normalized.slice(lastIndex)

  if (tailText || blocks.length === 0) {
    blocks.push(createTextBlock(tailText))
  }

  return blocks
}
