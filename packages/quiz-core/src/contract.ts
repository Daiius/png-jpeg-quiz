import { z } from 'zod'
import { profileIdSchema } from './profile.ts'

/**
 * HTTP 契約（prd/02 §4-2）。**quiz-core が唯一の真実**にする。
 *
 * 🔒 出題レスポンス（`questionViewSchema`）に、正解・両形式のバイト数・
 * png/jpeg の URL・難易度の数値・得点の重みを**含めない**（prd/04 §2, §3.5）。
 * ここに足す前に prd/04 §3.5 を読むこと。
 */

export const answerSchema = z.enum(['png', 'jpeg'])
export type Answer = z.infer<typeof answerSchema>

export const questionIdSchema = z.string().min(1).max(64)
export const sessionIdSchema = z.string().min(1).max(64)

export const questionCategorySchema = z.enum([
  'photo',
  'illustration',
  'screenshot',
  'pixel-art',
  'render',
  'synthetic',
])
export type QuestionCategory = z.infer<typeof questionCategorySchema>

// --- POST /api/session ---

export const createSessionRequestSchema = z.object({
  mode: z.string().min(1).max(32).default('standard-30'),
  profileId: profileIdSchema,
})
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>

export const createSessionResponseSchema = z.object({
  sessionId: sessionIdSchema,
  mode: z.string(),
  profileId: profileIdSchema,
  questionCount: z.number().int().positive(),
})
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>

// --- GET /api/session/:id/question ---

/**
 * 🔒 出題時にクライアントへ渡してよいのはここに並ぶものだけ。
 * `display` の URL・寸法・カテゴリ（prd/02 §4-2）に限る。
 */
export const questionViewSchema = z.object({
  questionId: questionIdSchema,
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  displayUrl: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  category: questionCategorySchema,
})
export type QuestionView = z.infer<typeof questionViewSchema>

export const questionResponseSchema = z.union([
  z.object({ status: z.literal('question'), question: questionViewSchema }),
  z.object({ status: z.literal('finished') }),
])
export type QuestionResponse = z.infer<typeof questionResponseSchema>

// --- POST /api/session/:id/answer ---

export const submitAnswerRequestSchema = z.object({
  questionId: questionIdSchema,
  answer: answerSchema,
})
export type SubmitAnswerRequest = z.infer<typeof submitAnswerRequestSchema>

/** 回答後は全部見せる（prd/04 §4）。ここは意図的に開示側。 */
export const answerResultSchema = z.object({
  correct: z.boolean(),
  answer: answerSchema,
  chosen: answerSchema,
  pngBytes: z.number().int().positive(),
  jpegBytes: z.number().int().positive(),
  pngUrl: z.url(),
  jpegUrl: z.url(),
  displayUrl: z.url(),
  log2Ratio: z.number(),
  awardedPoints: z.number(),
  explanation: z.string().nullable(),
  source: z.record(z.string(), z.unknown()),
  hasNext: z.boolean(),
})
export type AnswerResult = z.infer<typeof answerResultSchema>
