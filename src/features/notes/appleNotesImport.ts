import {
  createImageBlockFromFile,
  createTextBlock,
  type NoteFormBlock,
} from './noteForm'

type BrowserFileWithRelativePath = File & {
  webkitRelativePath: string
  importRelativePath?: string
}

export interface ImportedAppleNoteDraft {
  sourceFileName: string
  title: string
  blocks: NoteFormBlock[]
}

interface MarkdownImageMatch {
  startIndex: number
  endIndex: number
  referencePath: string
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])

const getFileExtension = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

const fileBaseName = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName
}

const normalizePathFragment = (value: string): string => {
  const decodedValue = (() => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  })()

  return decodedValue
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim()
    .toLowerCase()
}

const normalizeMarkdownReferenceLabel = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase()

const unescapeMarkdownPath = (value: string): string =>
  value.replace(/\\([\\()[\]<> ])/g, '$1')

const getRelativePath = (file: BrowserFileWithRelativePath): string =>
  normalizePathFragment(file.importRelativePath || file.webkitRelativePath || file.name)

const dirname = (value: string): string => {
  const normalized = normalizePathFragment(value)
  const separatorIndex = normalized.lastIndexOf('/')
  return separatorIndex === -1 ? '' : normalized.slice(0, separatorIndex)
}

const joinPath = (left: string, right: string): string =>
  [left, right]
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')

const buildAssetIndex = (
  files: BrowserFileWithRelativePath[],
): Map<string, File> => {
  const index = new Map<string, File>()

  for (const file of files) {
    const normalizedRelativePath = getRelativePath(file)
    const normalizedName = normalizePathFragment(file.name)

    if (normalizedRelativePath) {
      index.set(normalizedRelativePath, file)
    }

    if (normalizedName) {
      index.set(normalizedName, file)
    }
  }

  return index
}

const resolveAssetFile = (
  referencePath: string,
  documentFile: BrowserFileWithRelativePath,
  assetIndex: Map<string, File>,
): File | null => {
  const normalizedReference = normalizePathFragment(referencePath)

  if (!normalizedReference) {
    return null
  }

  const documentDirectory = dirname(getRelativePath(documentFile))
  const referenceName = normalizedReference.split('/').pop() ?? normalizedReference
  const candidates = [
    normalizedReference,
    referenceName,
    joinPath(documentDirectory, normalizedReference),
    joinPath(documentDirectory, referenceName),
  ]

  for (const candidate of candidates) {
    const file = assetIndex.get(candidate)

    if (file) {
      return file
    }
  }

  return null
}

const pushTextBlock = (blocks: NoteFormBlock[], text: string): void => {
  const normalized = text.replace(/\r\n?/g, '\n').trim()

  if (!normalized) {
    return
  }

  blocks.push(createTextBlock(normalized))
}

const findMatchingMarkdownEnclosure = (
  value: string,
  startIndex: number,
  openChar: string,
  closeChar: string,
): number => {
  let depth = 0
  let isEscaped = false

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index]

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (character === '\\') {
      isEscaped = true
      continue
    }

    if (character === openChar) {
      depth += 1
      continue
    }

    if (character === closeChar) {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

const findMatchingMarkdownLinkEnd = (
  value: string,
  startIndex: number,
): number => {
  let depth = 0
  let isEscaped = false
  let isInsideAngleBrackets = false

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index]

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (character === '\\') {
      isEscaped = true
      continue
    }

    if (character === '<' && depth === 1) {
      isInsideAngleBrackets = true
      continue
    }

    if (character === '>' && isInsideAngleBrackets) {
      isInsideAngleBrackets = false
      continue
    }

    if (isInsideAngleBrackets) {
      continue
    }

    if (character === '(') {
      depth += 1
      continue
    }

    if (character === ')') {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

const extractMarkdownLinkDestination = (value: string): string | null => {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  if (trimmedValue.startsWith('<')) {
    const closingBracketIndex = trimmedValue.indexOf('>')

    if (closingBracketIndex === -1) {
      return null
    }

    return unescapeMarkdownPath(trimmedValue.slice(1, closingBracketIndex).trim())
  }

  let destination = ''
  let depth = 0
  let isEscaped = false

  for (const character of trimmedValue) {
    if (isEscaped) {
      destination += character
      isEscaped = false
      continue
    }

    if (character === '\\') {
      destination += character
      isEscaped = true
      continue
    }

    if (character === '(') {
      depth += 1
      destination += character
      continue
    }

    if (character === ')') {
      if (depth === 0) {
        break
      }

      depth -= 1
      destination += character
      continue
    }

    if (/\s/.test(character) && depth === 0) {
      break
    }

    destination += character
  }

  const normalizedDestination = unescapeMarkdownPath(destination.trim())
  return normalizedDestination || null
}

const extractMarkdownReferenceDefinitions = (
  content: string,
): { contentWithoutDefinitions: string; references: Map<string, string> } => {
  const references = new Map<string, string>()
  const remainingLines: string[] = []

  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const referenceMatch = line.match(/^\s*\[([^\]]+)\]:\s*(.+?)\s*$/)

    if (!referenceMatch) {
      remainingLines.push(line)
      continue
    }

    const destination = extractMarkdownLinkDestination(referenceMatch[2])

    if (!destination) {
      remainingLines.push(line)
      continue
    }

    references.set(
      normalizeMarkdownReferenceLabel(referenceMatch[1]),
      destination,
    )
  }

  return {
    contentWithoutDefinitions: remainingLines.join('\n'),
    references,
  }
}

const fileFromDataUrl = (dataUrl: string, fileName: string): File | null => {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)

  if (!match) {
    return null
  }

  try {
    const mimeType = match[1]
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return new File([bytes], fileName, { type: mimeType })
  } catch {
    return null
  }
}

const extractMarkdownTitle = (
  content: string,
  fallbackTitle: string,
): { title: string; content: string } => {
  const normalized = content.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  let title = fallbackTitle
  let titleIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()

    if (!line) {
      continue
    }

    if (line.startsWith('# ')) {
      title = line.slice(2).trim() || fallbackTitle
      titleIndex = index
    }

    break
  }

  if (titleIndex === -1) {
    return {
      title,
      content: normalized,
    }
  }

  return {
    title,
    content: lines.filter((_, index) => index !== titleIndex).join('\n').trim(),
  }
}

const matchMarkdownImageAt = (
  content: string,
  startIndex: number,
  references: Map<string, string>,
): MarkdownImageMatch | null => {
  if (!content.startsWith('![', startIndex)) {
    return null
  }

  const altTextEndIndex = findMatchingMarkdownEnclosure(
    content,
    startIndex + 1,
    '[',
    ']',
  )

  if (altTextEndIndex === -1) {
    return null
  }

  const nextCharacter = content[altTextEndIndex + 1]

  if (nextCharacter === '(') {
    const linkEndIndex = findMatchingMarkdownLinkEnd(content, altTextEndIndex + 1)

    if (linkEndIndex === -1) {
      return null
    }

    const destination = extractMarkdownLinkDestination(
      content.slice(altTextEndIndex + 2, linkEndIndex),
    )

    if (!destination) {
      return null
    }

    return {
      startIndex,
      endIndex: linkEndIndex + 1,
      referencePath: destination,
    }
  }

  if (nextCharacter === '[') {
    const referenceEndIndex = findMatchingMarkdownEnclosure(
      content,
      altTextEndIndex + 1,
      '[',
      ']',
    )

    if (referenceEndIndex === -1) {
      return null
    }

    const explicitLabel = content.slice(altTextEndIndex + 2, referenceEndIndex).trim()
    const implicitLabel = content.slice(startIndex + 2, altTextEndIndex).trim()
    const referencePath =
      references.get(
        normalizeMarkdownReferenceLabel(explicitLabel || implicitLabel),
      ) ?? null

    if (!referencePath) {
      return null
    }

    return {
      startIndex,
      endIndex: referenceEndIndex + 1,
      referencePath,
    }
  }

  return null
}

const matchHtmlImageAt = (
  content: string,
  startIndex: number,
): MarkdownImageMatch | null => {
  if (content[startIndex] !== '<') {
    return null
  }

  const htmlImageMatch = content
    .slice(startIndex)
    .match(/^<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/i)

  if (!htmlImageMatch) {
    return null
  }

  const referencePath =
    htmlImageMatch[1] ?? htmlImageMatch[2] ?? htmlImageMatch[3] ?? ''

  if (!referencePath) {
    return null
  }

  return {
    startIndex,
    endIndex: startIndex + htmlImageMatch[0].length,
    referencePath,
  }
}

const parseMarkdownDocument = async (
  file: BrowserFileWithRelativePath,
  assetIndex: Map<string, File>,
): Promise<ImportedAppleNoteDraft> => {
  const rawContent = await file.text()
  const { title, content } = extractMarkdownTitle(
    rawContent,
    fileBaseName(file.name),
  )
  const { contentWithoutDefinitions, references } =
    extractMarkdownReferenceDefinitions(content)
  const blocks: NoteFormBlock[] = []
  let lastIndex = 0
  let cursor = 0

  while (cursor < contentWithoutDefinitions.length) {
    const imageMatch =
      matchMarkdownImageAt(contentWithoutDefinitions, cursor, references) ??
      matchHtmlImageAt(contentWithoutDefinitions, cursor)

    if (!imageMatch) {
      cursor += 1
      continue
    }

    pushTextBlock(
      blocks,
      contentWithoutDefinitions.slice(lastIndex, imageMatch.startIndex),
    )

    const imageFile = resolveAssetFile(imageMatch.referencePath, file, assetIndex)

    if (!imageFile) {
      throw new Error(
        `Для импорта "${file.name}" не найден файл изображения "${imageMatch.referencePath}". Выбери папку экспорта Apple Notes целиком или markdown/html вместе с экспортированными картинками.`,
      )
    }

    blocks.push(createImageBlockFromFile(imageFile))
    lastIndex = imageMatch.endIndex
    cursor = imageMatch.endIndex
  }

  pushTextBlock(blocks, contentWithoutDefinitions.slice(lastIndex))

  return {
    sourceFileName: file.name,
    title,
    blocks: blocks.length > 0 ? blocks : [createTextBlock('')],
  }
}

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'LI',
  'UL',
  'OL',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'TABLE',
  'TR',
  'TD',
  'TH',
])

const parseHtmlDocument = async (
  file: BrowserFileWithRelativePath,
  assetIndex: Map<string, File>,
): Promise<ImportedAppleNoteDraft> => {
  const rawContent = await file.text()
  const parser = new DOMParser()
  const documentNode = parser.parseFromString(rawContent, 'text/html')
  const blocks: NoteFormBlock[] = []
  const textParts: string[] = []

  const flushText = (): void => {
    if (textParts.length === 0) {
      return
    }

    pushTextBlock(blocks, textParts.join(''))
    textParts.length = 0
  }

  const walkNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      textParts.push(node.textContent ?? '')
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return
    }

    const element = node as HTMLElement

    if (element.tagName === 'BR') {
      textParts.push('\n')
      return
    }

    if (element.tagName === 'IMG') {
      flushText()

      const src = element.getAttribute('src') ?? ''
      const imageFile =
        fileFromDataUrl(
          src,
          `${fileBaseName(file.name)}-image-${blocks.length + 1}.png`,
        ) ?? resolveAssetFile(src, file, assetIndex)

      if (!imageFile) {
        throw new Error(
          `Для импорта "${file.name}" не найден файл изображения "${src}". Выбери html вместе с экспортированными картинками или всю папку Apple Notes.`,
        )
      }

      blocks.push(createImageBlockFromFile(imageFile))
      return
    }

    const isBlockTag = BLOCK_TAGS.has(element.tagName)

    if (isBlockTag && textParts.length > 0) {
      textParts.push('\n\n')
    }

    for (const child of Array.from(element.childNodes)) {
      walkNode(child)
    }

    if (isBlockTag) {
      textParts.push('\n\n')
    }
  }

  for (const child of Array.from(documentNode.body.childNodes)) {
    walkNode(child)
  }

  flushText()

  const title =
    documentNode.querySelector('h1')?.textContent?.trim() ||
    documentNode.title?.trim() ||
    fileBaseName(file.name)

  return {
    sourceFileName: file.name,
    title,
    blocks: blocks.length > 0 ? blocks : [createTextBlock('')],
  }
}

export const parseAppleNotesImportFiles = async (
  files: File[],
): Promise<ImportedAppleNoteDraft[]> => {
  const normalizedFiles = files as BrowserFileWithRelativePath[]
  const documentFiles = normalizedFiles.filter((file) => {
    const extension = getFileExtension(file.name)
    return MARKDOWN_EXTENSIONS.has(extension) || HTML_EXTENSIONS.has(extension)
  })

  if (documentFiles.length === 0) {
    throw new Error(
      'Не найдено ни одного Apple Notes файла. Выбери экспортированную папку заметки целиком или .md/.markdown/.html/.htm вместе с картинками.',
    )
  }

  const assetIndex = buildAssetIndex(normalizedFiles)
  const drafts: ImportedAppleNoteDraft[] = []

  for (const file of documentFiles) {
    const extension = getFileExtension(file.name)

    if (MARKDOWN_EXTENSIONS.has(extension)) {
      drafts.push(await parseMarkdownDocument(file, assetIndex))
      continue
    }

    drafts.push(await parseHtmlDocument(file, assetIndex))
  }

  return drafts
}
