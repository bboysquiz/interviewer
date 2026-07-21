import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('php', php)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('python', python)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

export interface InterviewPromptTextBlock {
  id: string
  type: 'text'
  text: string
}

export interface InterviewPromptCodeBlock {
  id: string
  type: 'code'
  code: string
  language: string
}

export type InterviewPromptBlock =
  | InterviewPromptTextBlock
  | InterviewPromptCodeBlock

const languageAliases: Record<string, string> = {
  'c#': 'csharp',
  'c++': 'cpp',
  c: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  dotnet: 'csharp',
  html: 'xml',
  jsx: 'javascript',
  js: 'javascript',
  node: 'javascript',
  py: 'python',
  ps1: 'powershell',
  shell: 'bash',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  yml: 'yaml',
  zsh: 'bash',
}

const languageLabels: Record<string, string> = {
  bash: 'Bash',
  cpp: 'C / C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  php: 'PHP',
  powershell: 'PowerShell',
  python: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  sql: 'SQL',
  swift: 'Swift',
  typescript: 'TypeScript',
  xml: 'HTML / XML',
  yaml: 'YAML',
}

const normalizePromptText = (value: string): string =>
  value.replace(/\r\n?/g, '\n').trim()

const normalizeLanguage = (value: string): string => {
  const token = value.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return languageAliases[token] ?? token
}

const inferCodeLanguage = (code: string): string => {
  const normalized = code.trim()

  if (/^\s*(?:select|with|insert|update|delete|create\s+table)\b/im.test(normalized)) {
    return 'sql'
  }

  if (/^\s*(?:def|class)\s+\w+.*:|\b(?:from\s+\w+\s+import|print\s*\()/m.test(normalized)) {
    return 'python'
  }

  if (/^\s*(?:interface|type)\s+\w+|:\s*(?:string|number|boolean)\b/m.test(normalized)) {
    return 'typescript'
  }

  if (/^\s*#\s*include\b|\b(?:std::|int\s+main\s*\(|cout\s*<<)/m.test(normalized)) {
    return 'cpp'
  }

  if (/\b(?:const|let|var|function)\b|=>|console\./m.test(normalized)) {
    return 'javascript'
  }

  if (/^\s*(?:package\s+\w+;|public\s+(?:class|interface)|System\.out\.)/m.test(normalized)) {
    return 'java'
  }

  if (/^\s*[{[]/.test(normalized)) {
    try {
      JSON.parse(normalized)
      return 'json'
    } catch {
      // Continue with the remaining language heuristics.
    }
  }

  if (/^\s*<[/!?a-z][\s\S]*>\s*$/i.test(normalized)) {
    return 'xml'
  }

  if (/^\s*#!.*\b(?:bash|sh)\b|\b(?:echo|printf|sudo)\s+/m.test(normalized)) {
    return 'bash'
  }

  return ''
}

const looksLikeLegacyInlineCode = (value: string): boolean => {
  if (value.length < 18) {
    return false
  }

  const hasCodeKeyword = [
    /\b(?:const|let|var|function|class|return|import|interface|public|private)\b/i,
    /\b(?:def|print|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i,
    /(?:console\.|=>|System\.out\.|#include\s*[<"])/,
  ].some((pattern) => pattern.test(value))
  const hasCodePunctuation = /[{}();]|:\s*[=({[]/.test(value)

  return hasCodeKeyword && hasCodePunctuation
}

const regexPrefixKeywords = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])

const hasPossibleRegexClosingDelimiter = (
  value: string,
  slashIndex: number,
  stopAtStatementBoundary = false,
): boolean => {
  const nextCharacter = value[slashIndex + 1] ?? ''

  if (!nextCharacter || nextCharacter === '/' || nextCharacter === '*') {
    return false
  }

  let escaped = false
  let characterClass = false

  for (let index = slashIndex + 1; index < value.length; index += 1) {
    const character = value[index] ?? ''

    if (character === '\n') {
      return false
    }

    if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '[') {
      characterClass = true
    } else if (character === ']') {
      characterClass = false
    } else if (
      stopAtStatementBoundary &&
      character === ';' &&
      !characterClass
    ) {
      return false
    } else if (character === '/' && !characterClass) {
      return true
    }
  }

  return false
}

const closesControlFlowHeader = (prefix: string): boolean => {
  if (!prefix.endsWith(')')) {
    return false
  }

  let depth = 0

  for (let index = prefix.length - 1; index >= 0; index -= 1) {
    const character = prefix[index] ?? ''

    if (character === ')') {
      depth += 1
    } else if (character === '(') {
      depth -= 1

      if (depth === 0) {
        const keyword = /([A-Za-z_$][\w$]*)\s*$/.exec(
          prefix.slice(0, index),
        )?.[1]
        return Boolean(
          keyword &&
            ['catch', 'for', 'if', 'switch', 'while', 'with'].includes(keyword),
        )
      }
    }
  }

  return false
}

const isDefiniteRegexLiteralStart = (
  value: string,
  slashIndex: number,
): boolean => {
  const prefix = value.slice(0, slashIndex).trimEnd()

  if (!prefix) {
    return true
  }

  const previousCharacter = prefix.at(-1) ?? ''

  if (/[([{=:;,!?&|+\-*%^~<>]/.test(previousCharacter)) {
    return true
  }

  const previousWord = /([A-Za-z_$][\w$]*)$/.exec(prefix)?.[1]

  if (previousWord && regexPrefixKeywords.has(previousWord)) {
    return true
  }

  return previousCharacter === ')' && closesControlFlowHeader(prefix)
}

const legacyExplanationPattern = /^(?:объясните|определите|укажите|найдите|исправьте|перепишите|реализуйте|дополните|ответьте|почему|что\s+будет|что\s+выведет|как\s+можно|в\s+ч[её]м)(?:\s|[,:.!?])/iu

const findLegacyExplanationStart = (value: string): number | null => {
  let quote: "'" | '"' | '`' | null = null
  let escaped = false
  let regexLiteral = false
  let regexCharacterClass = false
  let blockComment = false
  let lineComment = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    const nextCharacter = value[index + 1] ?? ''

    if (lineComment) {
      if (character === '\n') {
        lineComment = false
      }

      continue
    }

    if (blockComment) {
      if (character === '*' && nextCharacter === '/') {
        blockComment = false
        index += 1
      }

      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }

      continue
    }

    if (regexLiteral) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '[') {
        regexCharacterClass = true
      } else if (character === ']') {
        regexCharacterClass = false
      } else if (character === '/' && !regexCharacterClass) {
        regexLiteral = false
      }

      continue
    }

    if (character === '/' && nextCharacter === '/') {
      lineComment = true
      index += 1
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      blockComment = true
      index += 1
      continue
    }

    if (
      character === '#' &&
      (index === 0 || /\s/.test(value[index - 1] ?? '')) &&
      !/^#\s*(?:define|elif|else|endif|error|if|ifdef|ifndef|include|line|pragma|undef)\b/.test(
        value.slice(index),
      )
    ) {
      lineComment = true
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }

    if (
      character === '/' &&
      (isDefiniteRegexLiteralStart(value, index) ||
        hasPossibleRegexClosingDelimiter(value, index, true))
    ) {
      regexLiteral = true
      regexCharacterClass = false
      continue
    }

    if (/\s/.test(character)) {
      let explanationStart = index

      while (/\s/.test(value[explanationStart] ?? '')) {
        explanationStart += 1
      }

      if (legacyExplanationPattern.test(value.slice(explanationStart))) {
        return index
      }
    }
  }

  return null
}

const legacyBraceLanguages = new Set([
  'cpp',
  'csharp',
  'java',
  'javascript',
  'typescript',
])

const formatLegacyInlineCode = (rawCode: string, language: string): string => {
  const code = rawCode.trim()

  if (
    code.includes('\n') ||
    !legacyBraceLanguages.has(language) ||
    code.includes('//') ||
    code.includes('/*')
  ) {
    return code
  }

  let output = ''
  let indentLevel = 0
  let parenthesisDepth = 0
  let braceDepth = 0
  let quote: "'" | '"' | '`' | null = null
  let escaped = false
  let regexLiteral = false
  let regexCharacterClass = false
  let atLineStart = true

  const append = (value: string): void => {
    if (atLineStart && value.trim()) {
      output += '  '.repeat(indentLevel)
      atLineStart = false
    }

    output += value
  }

  const appendNewline = (): void => {
    output = output.trimEnd()

    if (!output.endsWith('\n')) {
      output += '\n'
    }

    atLineStart = true
  }

  for (let index = 0; index < code.length; index += 1) {
    const character = code[index] ?? ''

    if (quote) {
      append(character)

      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }

      continue
    }

    if (regexLiteral) {
      append(character)

      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '[') {
        regexCharacterClass = true
      } else if (character === ']') {
        regexCharacterClass = false
      } else if (character === '/' && !regexCharacterClass) {
        regexLiteral = false
      }

      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
      append(character)
      continue
    }

    if (character === '/') {
      if (isDefiniteRegexLiteralStart(code, index)) {
        regexLiteral = true
        regexCharacterClass = false
        append(character)
        continue
      }

      if (hasPossibleRegexClosingDelimiter(code, index)) {
        return code
      }
    }

    if (/\s/.test(character)) {
      if (!atLineStart && !/\s$/.test(output)) {
        append(' ')
      }
      continue
    }

    if (character === '(') {
      parenthesisDepth += 1
      append(character)
      continue
    }

    if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1)
      append(character)
      continue
    }

    if (character === '{') {
      append(character)
      braceDepth += 1
      indentLevel += 1
      appendNewline()
      continue
    }

    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
      indentLevel = Math.max(0, indentLevel - 1)

      if (!atLineStart) {
        appendNewline()
      }

      append(character)
      continue
    }

    if (character === ';') {
      append(character)

      if (parenthesisDepth === 0) {
        appendNewline()
      }
      continue
    }

    if (character === ',' && parenthesisDepth === 0 && braceDepth > 0) {
      append(character)
      appendNewline()
      continue
    }

    append(character)
  }

  return output.trim()
}

const parseLegacyInlinePrompt = (
  prompt: string,
): InterviewPromptBlock[] | null => {
  const leadMatch = /(?:код|фрагмент\s+кода)\s*:\s*/iu.exec(prompt)

  if (!leadMatch || leadMatch.index === undefined) {
    return null
  }

  const codeStart = leadMatch.index + leadMatch[0].length
  const remaining = prompt.slice(codeStart)
  const explanationStart = findLegacyExplanationStart(remaining)

  if (explanationStart === null) {
    return null
  }

  const rawCode = remaining.slice(0, explanationStart).trim()

  if (!looksLikeLegacyInlineCode(rawCode)) {
    return null
  }

  const prefix = prompt.slice(0, codeStart).trim()
  const suffix = remaining.slice(explanationStart).trim()
  const language = inferCodeLanguage(rawCode)

  return [
    ...(prefix
      ? [{ id: 'prompt-text-0', type: 'text' as const, text: prefix }]
      : []),
    {
      id: 'prompt-code-0',
      type: 'code',
      code: formatLegacyInlineCode(rawCode, language),
      language,
    },
    ...(suffix
      ? [{ id: 'prompt-text-1', type: 'text' as const, text: suffix }]
      : []),
  ]
}

export const parseInterviewPrompt = (rawPrompt: string): InterviewPromptBlock[] => {
  const prompt = normalizePromptText(rawPrompt)

  if (!prompt) {
    return []
  }

  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g
  const blocks: InterviewPromptBlock[] = []
  let lastIndex = 0
  let textIndex = 0
  let codeIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = fencePattern.exec(prompt)) !== null) {
    const leadingText = prompt.slice(lastIndex, match.index).trim()

    if (leadingText) {
      blocks.push({
        id: `prompt-text-${textIndex}`,
        type: 'text',
        text: leadingText,
      })
      textIndex += 1
    }

    const code = (match[2] ?? '').replace(/\n$/, '')
    const declaredLanguage = normalizeLanguage(match[1] ?? '')

    blocks.push({
      id: `prompt-code-${codeIndex}`,
      type: 'code',
      code,
      language: declaredLanguage || inferCodeLanguage(code),
    })
    codeIndex += 1
    lastIndex = match.index + match[0].length
  }

  const trailingText = prompt.slice(lastIndex).trim()

  if (trailingText) {
    blocks.push({
      id: `prompt-text-${textIndex}`,
      type: 'text',
      text: trailingText,
    })
  }

  if (codeIndex > 0) {
    return blocks
  }

  return (
    parseLegacyInlinePrompt(prompt) ?? [
      {
        id: 'prompt-text-0',
        type: 'text',
        text: prompt,
      },
    ]
  )
}

export const getInterviewCodeLanguageLabel = (language: string): string => {
  const normalized = normalizeLanguage(language)
  return languageLabels[normalized] ?? (language.trim() || 'Код')
}

export const highlightInterviewCode = (
  code: string,
  language: string,
): string | null => {
  const normalized = normalizeLanguage(language)

  if (!normalized || !hljs.getLanguage(normalized)) {
    return null
  }

  return hljs.highlight(code, {
    language: normalized,
    ignoreIllegals: true,
  }).value
}

export const toInterviewPromptSpeechText = (prompt: string): string =>
  parseInterviewPrompt(prompt)
    .map((block) =>
      block.type === 'text'
        ? block.text
        : `Фрагмент кода ${getInterviewCodeLanguageLabel(block.language)}.\n${block.code}`,
    )
    .join('\n\n')
