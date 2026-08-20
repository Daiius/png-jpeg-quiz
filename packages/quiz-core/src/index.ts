/**
 * `quiz-core` — モード定義・出題選択・採点・得点計算・Zod スキーマ。
 *
 * 🔒 フレームワーク非依存の純関数に保つ（prd/02 §4-1）。
 * **DB も HTTP も import しない。** ここが Phase 2 の Vite + Hono 版と共有される本体になる。
 */

export {
  type Answer,
  type AnswerResult,
  answerResultSchema,
  answerSchema,
  type ColorRange,
  type CreateSessionRequest,
  type CreateSessionResponse,
  colorRangeSchema,
  createSessionRequestSchema,
  createSessionResponseSchema,
  type HintRequest,
  type HintResponse,
  hintRequestSchema,
  hintResponseSchema,
  type ProfileResult,
  profileResultSchema,
  type QuestionCategory,
  type QuestionResponse,
  type QuestionView,
  questionCategorySchema,
  questionIdSchema,
  questionResponseSchema,
  questionViewSchema,
  type SessionStateResponse,
  type SubmitAnswerRequest,
  sessionIdSchema,
  sessionStateResponseSchema,
  submitAnswerRequestSchema,
  type VerificationView,
  verificationViewSchema,
} from './contract.ts'
export { answerFor, log2Ratio, staticDifficulty } from './difficulty.ts'
export {
  COLOR_RANGE_BOUNDARY,
  colorRange,
  decideHint,
  HINT_PENALTY_RATE,
  type HintConfig,
  type HintDecision,
  type ServedForHint,
} from './hint.ts'
export {
  type AnswerTiming,
  classifyTiming,
  defaultModeForPool,
  findMode,
  MIN_ANSWER_MS,
  MODES,
  type ModeState,
  type PoolEntry,
  practice,
  type QuizMode,
  STANDARD_30_QUESTION_COUNT,
  standard30,
  targetDifficulty,
} from './mode.ts'
export {
  buildProfileId,
  CHROMA_SUBSAMPLINGS,
  type ChromaSubsampling,
  ENCODE_PROFILES,
  type EncodeProfile,
  findProfile,
  JPEG_QUALITIES,
  type JpegQuality,
  jpegOptionsFor,
  PREPROCESS,
  PROFILE_VERSION,
  type ProfileId,
  pngOptionsFor,
  profileIdSchema,
  STANDARD_PROFILE_ID,
} from './profile.ts'
export {
  answerProbability,
  difficultyWeight,
  expectedSurprisal,
  type ScoreInput,
  scoreQuestion,
  surprisal,
} from './score.ts'
