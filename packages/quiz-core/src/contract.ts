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
  /** 制限時間（ミリ秒）。表示用 */
  timeLimitMs: z.number().int().positive(),
  /**
   * **このレスポンスを作った時点でサーバが計算した残り時間**（ミリ秒）。
   *
   * 🔒 端末の時計とサーバの絶対時刻を突き合わせない（ずれると期限前に時間切れが飛ぶ）。
   * かといって「画面を描いた時点から満了まで」にすると、**再読み込みで残り時間が戻ってしまう**。
   * サーバが `served_at` から計算した相対値を渡し、クライアントはそこから減らすだけにする。
   * **期限の判定自体は引き続きサーバが行う。**
   */
  remainingMs: z.number().int().nonnegative(),
  displayUrl: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  category: questionCategorySchema,
})
export type QuestionView = z.infer<typeof questionViewSchema>

export const questionResponseSchema = z.union([
  z.object({
    status: z.literal('question'),
    question: questionViewSchema,
    /**
     * このリクエストをサーバ内部で処理するのにかかった時間（ミリ秒）。
     *
     * クライアントは往復時間からこれを引いて**ネットワーク分だけ**を残り時間から差し引く。
     * 引かないと、出題を確定する前（`served_at` を作る前）のサーバ処理時間まで
     * 回答時間から削ってしまう。
     */
    serverProcessingMs: z.number().nonnegative(),
  }),
  z.object({ status: z.literal('finished') }),
])
export type QuestionResponse = z.infer<typeof questionResponseSchema>

// --- POST /api/session/:id/answer ---

/**
 * 🔒 **時間切れはクライアントが「JPEG を選んだ」ことにしてはいけない**（prd/04 §2, §5）。
 * 端末の時計がサーバより進んでいると、サーバの 20 秒が経過する前に回答が確定してしまい、
 * 偶然その答えが正解なら得点まで入る。**時間切れは方向を持たない `timeout` として送り、
 * 期限を過ぎたかどうかはサーバが `served_at` から判定する。**
 */
export const submitActionSchema = z.union([answerSchema, z.literal('timeout')])
export type SubmitAction = z.infer<typeof submitActionSchema>

export const submitAnswerRequestSchema = z.object({
  questionId: questionIdSchema,
  answer: submitActionSchema,
})
export type SubmitAnswerRequest = z.infer<typeof submitAnswerRequestSchema>

/**
 * 「他の条件ならどうなるか」（prd/04 §4）。
 * **20 プロファイルすべての結果**を回答後に開示し、条件で答えが変わることを実演する。
 *
 * 🔒 `difficulty` は含めない。バイト数は出すが、**難易度の数値そのものは値として渡さない**
 * （他の問題の出題前に効いてくる可能性を避ける。prd/04 §3.5）。
 */
export const profileResultSchema = z.object({
  profileId: profileIdSchema,
  jpegQuality: z.number().int(),
  chromaSubsampling: z.string(),
  pngOptimize: z.boolean(),
  pngBytes: z.number().int().positive(),
  jpegBytes: z.number().int().positive(),
  answer: answerSchema,
  isStandard: z.boolean(),
  /** このセッションで選んでいる条件か */
  isSelected: z.boolean(),
})
export type ProfileResult = z.infer<typeof profileResultSchema>

/**
 * 検証ビュー（prd/04 §4.1）— JPEG が「どこを」「どれだけ」壊したか。
 *
 * 🔑 **条件は 10 通り**（5 品質 × 2 サブサンプリング）。PNG 最適化は JPEG を変えないので、
 * 20 プロファイルに対して劣化の実体は 10 通りしかない（prd/03 §5.3）。
 *
 * 🔒 **回答後にだけ到達できる。** 劣化量は素材の性質と相関し、素材の性質は答えと相関するので、
 * 出題レスポンスには絶対に含めない（prd/04 §3.5）。
 */
export const verificationViewSchema = z.object({
  jpegQuality: z.number().int(),
  chromaSubsampling: z.string(),
  /** 🔒 主指標: ΔE00 > 2 の画素の割合。**平均は出さない**（measurements §8.2） */
  over2Pct: z.number().nullable(),
  /** ΔE00（CIEDE2000）のオーバーレイ。輪郭の**上**に乗る */
  de00Url: z.url(),
  /** 1 − SSIM のオーバーレイ。輪郭の**外側**が光る。ΔE00 とは別の場所を指す */
  ssimUrl: z.url(),
})
export type VerificationView = z.infer<typeof verificationViewSchema>

/** 回答後は全部見せる（prd/04 §4）。ここは意図的に開示側。 */
export const answerResultSchema = z.object({
  correct: z.boolean(),
  answer: answerSchema,
  /** 時間切れなら `null`（どちらも選んでいない） */
  chosen: answerSchema.nullable(),
  pngBytes: z.number().int().positive(),
  jpegBytes: z.number().int().positive(),
  pngUrl: z.url(),
  jpegUrl: z.url(),
  displayUrl: z.url(),
  log2Ratio: z.number(),
  awardedPoints: z.number(),
  /** 制限時間を過ぎていたか（過ぎていれば内容によらず不正解・0 点。prd/04 §5） */
  timedOut: z.boolean(),
  explanation: z.string().nullable(),
  source: z.record(z.string(), z.unknown()),
  /** 20 プロファイルすべての結果（prd/04 §4） */
  profileResults: z.array(profileResultSchema),
  /** 検証ビュー（prd/04 §4.1）。10 条件分。空なら未生成（古いビルド） */
  verification: z.array(verificationViewSchema),
  hasNext: z.boolean(),
})
export type AnswerResult = z.infer<typeof answerResultSchema>
