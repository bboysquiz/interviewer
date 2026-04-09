import https from 'node:https'
import { randomBytes } from 'node:crypto'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { Resolver } from 'node:dns/promises'

import {
  GEMINI_API_KEY,
  GEMINI_DOH_URL,
  GEMINI_DNS_SERVERS,
  GEMINI_INTERVIEW_EVALUATION_MODEL,
  GEMINI_INTERVIEW_QUESTION_MODEL,
  GEMINI_VISION_MODEL,
} from '../../../config.js'

import type {
  AnalyzeImageForKnowledgeBaseInput,
  AnalyzeImageForKnowledgeBaseResult,
  EvaluateInterviewAnswerInput,
  EvaluateInterviewAnswerResult,
  GenerateInterviewQuestionInput,
  GenerateInterviewQuestionResult,
  OrganizeKnowledgeBaseNoteInput,
  OrganizeKnowledgeBaseNoteResult,
} from '../dto.js'
import {
  buildEvaluationResult,
  buildImageAnalysisPrompt,
  buildImageAnalysisResult,
  buildInterviewEvaluationSystemPrompt,
  buildInterviewEvaluationUserPrompt,
  buildInterviewQuestionSystemPrompt,
  buildInterviewQuestionUserPrompt,
  buildNoteOrganizationResult,
  buildNoteOrganizationSystemPrompt,
  buildNoteOrganizationUserPrompt,
  buildQuestionResult,
  buildUsage,
  formatProviderModel,
  imageAnalysisSchema,
  interviewEvaluationSchema,
  interviewQuestionSchema,
  parseStructuredRecord,
} from '../common.js'
import { AiServiceError } from '../errors.js'
import type { AiProvider } from '../providerTypes.js'

interface GeminiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: unknown
  }
}

interface GeminiCandidatePart {
  text?: string
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiCandidatePart[]
    }
    finishReason?: string
  }>
  promptFeedback?: {
    blockReason?: string
  }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  modelVersion?: string
  responseId?: string
}

type GeminiLookupFunction = (
  hostname: string,
  options: number | LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void

interface ResolvedAddress {
  address: string
  family: 4 | 6
}

const GEMINI_HOSTNAME = 'generativelanguage.googleapis.com'
const GEMINI_REQUEST_TIMEOUT_MS = 30000
const DOH_REQUEST_TIMEOUT_MS = 10000
const DNS_RECORD_TYPE_A = 1
const DNS_RECORD_TYPE_AAAA = 28
const DNS_RECORD_CLASS_IN = 1

const ensureGeminiConfigured = (): void => {
  if (!GEMINI_API_KEY) {
    throw new AiServiceError('GEMINI_API_KEY is not configured on the server.', {
      status: 503,
      code: 'ai_config_error',
    })
  }
}

const toAiErrorCode = (status: number): AiServiceError['code'] => {
  if (status === 400) {
    return 'ai_validation_error'
  }

  if (status === 404) {
    return 'ai_not_found'
  }

  return 'ai_upstream_error'
}

const parseDataUrl = (
  imageDataUrl: string,
): { mimeType: string; data: string } => {
  const match = imageDataUrl.match(/^data:(.+?);base64,([\s\S]+)$/)

  if (!match?.[1] || !match[2]) {
    throw new AiServiceError('Image data must be a valid base64 data URL.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  return {
    mimeType: match[1],
    data: match[2],
  }
}

const normalizeRequestedFamily = (
  options: number | LookupOptions,
): 0 | 4 | 6 => {
  if (typeof options === 'number') {
    return options === 4 || options === 6 ? options : 0
  }

  return options.family === 4 || options.family === 6 ? options.family : 0
}

const shouldReturnAllAddresses = (
  options: number | LookupOptions,
): boolean => typeof options === 'object' && options.all === true

const toLookupError = (error: unknown): NodeJS.ErrnoException =>
  Object.assign(
    new Error(
      error instanceof Error ? error.message : 'Custom DNS lookup failed.',
    ),
    {
      code: 'EDNSLOOKUP',
    },
  )

const ensureResolvedAddresses = (
  hostname: string,
  addresses: ResolvedAddress[],
): ResolvedAddress[] => {
  const uniqueAddresses = [
    ...new Map(
      addresses.map((entry) => [`${entry.family}:${entry.address}`, entry]),
    ).values(),
  ]

  if (uniqueAddresses.length > 0) {
    return uniqueAddresses
  }

  throw new Error(`No DNS addresses resolved for ${hostname}.`)
}

const buildLookupFromResolver = (
  resolveAddresses: (
    hostname: string,
    family: 0 | 4 | 6,
  ) => Promise<ResolvedAddress[]>,
): GeminiLookupFunction => {
  return (
    hostname: string,
    options: number | LookupOptions,
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    const requestedFamily = normalizeRequestedFamily(options)
    const shouldReturnAll = shouldReturnAllAddresses(options)

    void resolveAddresses(hostname, requestedFamily)
      .then((addresses) => {
        const resolvedAddresses = ensureResolvedAddresses(hostname, addresses)

        if (shouldReturnAll) {
          callback(null, resolvedAddresses)
          return
        }

        callback(
          null,
          resolvedAddresses[0]!.address,
          resolvedAddresses[0]!.family,
        )
      })
      .catch((error) => {
        if (shouldReturnAll) {
          callback(toLookupError(error), [])
          return
        }

        callback(toLookupError(error), '', 0)
      })
  }
}

const buildResolverLookup = (): GeminiLookupFunction | null => {
  if (GEMINI_DNS_SERVERS.length === 0) {
    return null
  }

  const resolver = new Resolver()
  try {
    resolver.setServers(GEMINI_DNS_SERVERS)
  } catch {
    throw new AiServiceError(
      'GEMINI_DNS_SERVERS must contain comma-separated DNS server IP addresses.',
      {
        status: 503,
        code: 'ai_config_error',
      },
    )
  }

  return buildLookupFromResolver(
    async (hostname: string, family: 0 | 4 | 6): Promise<ResolvedAddress[]> => {
      if (family === 6) {
        return ensureResolvedAddresses(
          hostname,
          (await resolver.resolve6(hostname)).map((address) => ({
            address,
            family: 6,
          })),
        )
      }

      if (family === 4) {
        return ensureResolvedAddresses(
          hostname,
          (await resolver.resolve4(hostname)).map((address) => ({
            address,
            family: 4,
          })),
        )
      }

      const ipv4Addresses = await resolver.resolve4(hostname).catch(() => [])
      const ipv6Addresses = await resolver.resolve6(hostname).catch(() => [])

      return ensureResolvedAddresses(hostname, [
        ...ipv4Addresses.map((address) => ({
          address,
          family: 4 as const,
        })),
        ...ipv6Addresses.map((address) => ({
          address,
          family: 6 as const,
        })),
      ])
    },
  )
}

const encodeDnsName = (hostname: string): Buffer => {
  const labels = hostname
    .split('.')
    .map((label) => label.trim())
    .filter(Boolean)

  if (labels.length === 0) {
    throw new Error('DNS hostname must not be empty.')
  }

  const encodedLabels = labels.map((label) => {
    const labelBuffer = Buffer.from(label, 'ascii')

    if (labelBuffer.length === 0 || labelBuffer.length > 63) {
      throw new Error(`Invalid DNS label length in hostname "${hostname}".`)
    }

    return Buffer.concat([Buffer.from([labelBuffer.length]), labelBuffer])
  })

  return Buffer.concat([...encodedLabels, Buffer.from([0])])
}

const buildDnsWireQuery = (
  hostname: string,
  recordType: typeof DNS_RECORD_TYPE_A | typeof DNS_RECORD_TYPE_AAAA,
): Buffer => {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(randomBytes(2).readUInt16BE(0), 0)
  header.writeUInt16BE(0x0100, 2)
  header.writeUInt16BE(1, 4)

  const question = Buffer.alloc(4)
  question.writeUInt16BE(recordType, 0)
  question.writeUInt16BE(DNS_RECORD_CLASS_IN, 2)

  return Buffer.concat([header, encodeDnsName(hostname), question])
}

const skipDnsName = (message: Buffer, offset: number): number => {
  let cursor = offset

  while (cursor < message.length) {
    const length = message[cursor]

    if (length === undefined) {
      break
    }

    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= message.length) {
        throw new Error('Unexpected end of DNS message while reading pointer.')
      }

      return cursor + 2
    }

    if (length === 0) {
      return cursor + 1
    }

    cursor += length + 1
  }

  throw new Error('Unexpected end of DNS message while reading name.')
}

const formatIpv6 = (rdata: Buffer): string => {
  const parts: string[] = []

  for (let index = 0; index < 16; index += 2) {
    parts.push(rdata.readUInt16BE(index).toString(16))
  }

  return parts.join(':')
}

const parseDnsWireResponse = (
  message: Buffer,
  expectedType: typeof DNS_RECORD_TYPE_A | typeof DNS_RECORD_TYPE_AAAA,
): ResolvedAddress[] => {
  if (message.length < 12) {
    throw new Error('DNS response is too short.')
  }

  const responseCode = message.readUInt16BE(2) & 0x000f

  if (responseCode !== 0) {
    throw new Error(`DoH resolver returned DNS error code ${responseCode}.`)
  }

  const questionCount = message.readUInt16BE(4)
  const answerCount = message.readUInt16BE(6)
  const authorityCount = message.readUInt16BE(8)
  const additionalCount = message.readUInt16BE(10)

  let offset = 12

  for (let index = 0; index < questionCount; index += 1) {
    offset = skipDnsName(message, offset)

    if (offset + 4 > message.length) {
      throw new Error('Unexpected end of DNS message while reading question.')
    }

    offset += 4
  }

  const totalRecordCount = answerCount + authorityCount + additionalCount
  const addresses: ResolvedAddress[] = []

  for (let index = 0; index < totalRecordCount; index += 1) {
    offset = skipDnsName(message, offset)

    if (offset + 10 > message.length) {
      throw new Error('Unexpected end of DNS message while reading record.')
    }

    const recordType = message.readUInt16BE(offset)
    const recordClass = message.readUInt16BE(offset + 2)
    const dataLength = message.readUInt16BE(offset + 8)
    offset += 10

    if (offset + dataLength > message.length) {
      throw new Error('Unexpected end of DNS message while reading record data.')
    }

    const rdata = message.subarray(offset, offset + dataLength)
    offset += dataLength

    if (recordClass !== DNS_RECORD_CLASS_IN || recordType !== expectedType) {
      continue
    }

    if (recordType === DNS_RECORD_TYPE_A && rdata.length === 4) {
      addresses.push({
        address: Array.from(rdata).join('.'),
        family: 4,
      })
      continue
    }

    if (recordType === DNS_RECORD_TYPE_AAAA && rdata.length === 16) {
      addresses.push({
        address: formatIpv6(rdata),
        family: 6,
      })
    }
  }

  return addresses
}

const resolveWithDoh = async (
  dohUrl: URL,
  hostname: string,
  recordType: typeof DNS_RECORD_TYPE_A | typeof DNS_RECORD_TYPE_AAAA,
): Promise<ResolvedAddress[]> => {
  const response = await fetch(dohUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/dns-message',
      accept: 'application/dns-message',
    },
    body: buildDnsWireQuery(hostname, recordType),
    signal: AbortSignal.timeout(DOH_REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(
      `DNS-over-HTTPS lookup failed with status ${response.status}.`,
    )
  }

  const responseBuffer = Buffer.from(await response.arrayBuffer())
  return parseDnsWireResponse(responseBuffer, recordType)
}

const buildDohLookup = (): GeminiLookupFunction | null => {
  if (!GEMINI_DOH_URL) {
    return null
  }

  let dohUrl: URL

  try {
    dohUrl = new URL(GEMINI_DOH_URL)
  } catch {
    throw new AiServiceError('GEMINI_DOH_URL must be a valid URL.', {
      status: 503,
      code: 'ai_config_error',
    })
  }

  if (dohUrl.protocol !== 'https:') {
    throw new AiServiceError('GEMINI_DOH_URL must use https.', {
      status: 503,
      code: 'ai_config_error',
    })
  }

  return buildLookupFromResolver(
    async (hostname: string, family: 0 | 4 | 6): Promise<ResolvedAddress[]> => {
      if (family === 6) {
        return ensureResolvedAddresses(
          hostname,
          await resolveWithDoh(dohUrl, hostname, DNS_RECORD_TYPE_AAAA),
        )
      }

      if (family === 4) {
        return ensureResolvedAddresses(
          hostname,
          await resolveWithDoh(dohUrl, hostname, DNS_RECORD_TYPE_A),
        )
      }

      const ipv4Addresses = await resolveWithDoh(
        dohUrl,
        hostname,
        DNS_RECORD_TYPE_A,
      ).catch(() => [])
      const ipv6Addresses = await resolveWithDoh(
        dohUrl,
        hostname,
        DNS_RECORD_TYPE_AAAA,
      ).catch(() => [])

      return ensureResolvedAddresses(hostname, [
        ...ipv4Addresses,
        ...ipv6Addresses,
      ])
    },
  )
}

let cachedGeminiLookup: GeminiLookupFunction | null | undefined

const getGeminiLookup = (): GeminiLookupFunction | undefined => {
  if (cachedGeminiLookup !== undefined) {
    return cachedGeminiLookup ?? undefined
  }

  cachedGeminiLookup =
    buildDohLookup() ?? buildResolverLookup() ?? null

  return cachedGeminiLookup ?? undefined
}

const callGemini = async (
  model: string,
  body: Record<string, unknown>,
): Promise<GeminiGenerateContentResponse> => {
  ensureGeminiConfigured()

  const requestBody = JSON.stringify(body)
  const geminiLookup = getGeminiLookup()
  const response = await new Promise<{
    statusCode: number
    bodyText: string
  }>((resolve, reject) => {
    const request = https.request(
      {
        protocol: 'https:',
        hostname: GEMINI_HOSTNAME,
        port: 443,
        method: 'POST',
        path: `/v1beta/models/${model}:generateContent`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          'x-goog-api-key': GEMINI_API_KEY,
        },
        servername: GEMINI_HOSTNAME,
        lookup: geminiLookup as never,
      },
      (responseMessage) => {
        const chunks: Buffer[] = []

        responseMessage.on('data', (chunk: Buffer | string) => {
          chunks.push(
            typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
          )
        })

        responseMessage.on('end', () => {
          resolve({
            statusCode: responseMessage.statusCode ?? 500,
            bodyText: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )

    request.setTimeout(GEMINI_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Gemini request timed out.'))
    })

    request.on('error', reject)
    request.write(requestBody)
    request.end()
  })

  let parsedBody: GeminiGenerateContentResponse | GeminiErrorBody | null = null

  if (response.bodyText) {
    try {
      parsedBody = JSON.parse(response.bodyText) as
        | GeminiGenerateContentResponse
        | GeminiErrorBody
    } catch {
      parsedBody = null
    }
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const errorBody = parsedBody as GeminiErrorBody | null
    const message =
      errorBody?.error?.message ||
      response.bodyText ||
      `Gemini request failed with status ${response.statusCode}.`

    throw new AiServiceError(message, {
      status: response.statusCode,
      code: toAiErrorCode(response.statusCode),
      details: {
        provider: 'gemini',
        providerStatus: errorBody?.error?.status ?? null,
        providerDetails: errorBody?.error?.details ?? null,
        customDohUrl: GEMINI_DOH_URL || null,
        customDnsServers: GEMINI_DNS_SERVERS,
      },
    })
  }

  return (parsedBody ?? {}) as GeminiGenerateContentResponse
}

const extractResponseText = (
  response: GeminiGenerateContentResponse,
  fallbackMessage: string,
): string => {
  const candidate = response.candidates?.[0]
  const rawText =
    candidate?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('\n')
      .trim() ?? ''

  if (rawText) {
    return rawText
  }

  if (response.promptFeedback?.blockReason) {
    throw new AiServiceError(
      `Gemini blocked the prompt: ${response.promptFeedback.blockReason}.`,
      {
        status: 422,
        code: 'ai_validation_error',
      },
    )
  }

  throw new AiServiceError(fallbackMessage, {
    status: 502,
    code: 'ai_invalid_response',
  })
}

const buildGeminiUsage = (
  response: GeminiGenerateContentResponse,
): AnalyzeImageForKnowledgeBaseResult['usage'] =>
  buildUsage({
    inputTokens: response.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    totalTokens: response.usageMetadata?.totalTokenCount ?? null,
  })

const analyzeImageForKnowledgeBase = async (
  input: AnalyzeImageForKnowledgeBaseInput,
): Promise<AnalyzeImageForKnowledgeBaseResult> => {
  if (!input.imageDataUrl.trim()) {
    throw new AiServiceError('Image data is required for AI analysis.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  const image = parseDataUrl(input.imageDataUrl)
  const response = await callGemini(GEMINI_VISION_MODEL, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildImageAnalysisPrompt(input),
          },
          {
            inlineData: image,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: imageAnalysisSchema,
      maxOutputTokens: 1200,
    },
  })
  const rawOutput = extractResponseText(
    response,
    'Gemini returned an empty structured response for image analysis.',
  )
  const record = parseStructuredRecord(
    rawOutput,
    'Gemini returned invalid JSON for image analysis.',
  )
  const model = formatProviderModel(
    'gemini',
    response.modelVersion ?? GEMINI_VISION_MODEL,
  )

  return buildImageAnalysisResult(
    record,
    model,
    response.responseId ?? null,
    buildGeminiUsage(response),
  )
}

const generateInterviewQuestion = async (
  input: GenerateInterviewQuestionInput,
): Promise<GenerateInterviewQuestionResult> => {
  if (!input.knowledgeBaseContext.trim()) {
    throw new AiServiceError('Knowledge base context is required.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  const response = await callGemini(GEMINI_INTERVIEW_QUESTION_MODEL, {
    systemInstruction: {
      parts: [
        {
          text: buildInterviewQuestionSystemPrompt(),
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildInterviewQuestionUserPrompt(input),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: interviewQuestionSchema,
      maxOutputTokens: 1000,
    },
  })
  const rawOutput = extractResponseText(
    response,
    'Gemini returned an empty structured response for interview question generation.',
  )
  const record = parseStructuredRecord(
    rawOutput,
    'Gemini returned invalid JSON for interview question generation.',
  )
  const model = formatProviderModel(
    'gemini',
    response.modelVersion ?? GEMINI_INTERVIEW_QUESTION_MODEL,
  )

  return buildQuestionResult(
    record,
    model,
    response.responseId ?? null,
    buildGeminiUsage(response),
    input.previousQuestions,
  )
}

const evaluateInterviewAnswer = async (
  input: EvaluateInterviewAnswerInput,
): Promise<EvaluateInterviewAnswerResult> => {
  if (!input.questionPrompt.trim() || !input.answerText.trim()) {
    throw new AiServiceError(
      'Question prompt and answer text are required for evaluation.',
      {
        status: 400,
        code: 'ai_validation_error',
      },
    )
  }

  const response = await callGemini(GEMINI_INTERVIEW_EVALUATION_MODEL, {
    systemInstruction: {
      parts: [
        {
          text: buildInterviewEvaluationSystemPrompt(),
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildInterviewEvaluationUserPrompt(input),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: interviewEvaluationSchema,
      maxOutputTokens: 1600,
    },
  })
  const rawOutput = extractResponseText(
    response,
    'Gemini returned an empty structured response for answer evaluation.',
  )
  const record = parseStructuredRecord(
    rawOutput,
    'Gemini returned invalid JSON for interview answer evaluation.',
  )
  const model = formatProviderModel(
    'gemini',
    response.modelVersion ?? GEMINI_INTERVIEW_EVALUATION_MODEL,
  )

  return buildEvaluationResult(
    record,
    model,
    response.responseId ?? null,
    buildGeminiUsage(response),
  )
}

const organizeKnowledgeBaseNote = async (
  input: OrganizeKnowledgeBaseNoteInput,
): Promise<OrganizeKnowledgeBaseNoteResult> => {
  if (input.blocks.length === 0) {
    throw new AiServiceError('Note blocks are required for organization.', {
      status: 400,
      code: 'ai_validation_error',
    })
  }

  const response = await callGemini(GEMINI_INTERVIEW_QUESTION_MODEL, {
    systemInstruction: {
      parts: [
        {
          text: buildNoteOrganizationSystemPrompt(),
        },
      ],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildNoteOrganizationUserPrompt(input),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 2200,
    },
  })
  const rawOutput = extractResponseText(
    response,
    'Gemini returned an empty structured response for note organization.',
  )
  const record = parseStructuredRecord(
    rawOutput,
    'Gemini returned invalid JSON for note organization.',
  )
  const model = formatProviderModel(
    'gemini',
    response.modelVersion ?? GEMINI_INTERVIEW_QUESTION_MODEL,
  )

  return buildNoteOrganizationResult(
    record,
    model,
    response.responseId ?? null,
    buildGeminiUsage(response),
  )
}

export const geminiProvider: AiProvider = {
  name: 'gemini',
  get isConfigured() {
    return Boolean(GEMINI_API_KEY)
  },
  supportsImageAnalysis: true,
  analyzeImageForKnowledgeBase,
  generateInterviewQuestion,
  evaluateInterviewAnswer,
  organizeKnowledgeBaseNote,
}
