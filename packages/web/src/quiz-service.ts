import {
  encodeProfile,
  getDatabase,
  question,
  questionDisplayAsset,
  questionEncodedAsset,
  questionEncoding,
  session,
  sessionQuestion,
} from '@png-jpeg-quiz/database'
import {
  type Answer,
  type AnswerResult,
  classifyTiming,
  ENCODE_PROFILES,
  findMode,
  type PoolEntry,
  type ProfileResult,
  QUESTION_TIME_LIMIT_MS,
  type QuestionView,
  standard30,
} from '@png-jpeg-quiz/quiz-core'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { assetUrl } from './env.ts'
import type { SessionRow } from './session.ts'

/**
 * 出題と採点。**サーバだけが正解を持つ**（prd/04 §2）。
 *
 * 🔒 出題レスポンスに含めてよいのは `display` の URL・寸法・カテゴリだけ。
 * 正解・両形式のバイト数・png/jpeg の URL・難易度の数値は、回答を受け取るまで一切送らない。
 */

/**
 * 次の問題を選んで `session_question` に記録する。
 *
 * **出題選択は `quiz-core` のモードに委ねる**（prd/02 §4-1）。
 * ここは「DB から候補を集めて、選ばれたものを記録する」だけに留める。
 */
export async function serveNextQuestion(row: SessionRow): Promise<QuestionView | null> {
  const database = getDatabase()

  // 出題済みなら同じ問題を返す（リロードで問題が変わらないように）
  const served = await database
    .select()
    .from(sessionQuestion)
    .where(
      and(
        eq(sessionQuestion.sessionId, row.id),
        eq(sessionQuestion.questionIndex, row.currentIndex),
      ),
    )
    .limit(1)

  const current = served[0]
  if (current) {
    if (current.answeredAt) return null
    return await toQuestionView(
      current.questionId,
      row.currentIndex,
      row.questionCount,
      current.servedAt,
    )
  }

  if (row.currentIndex >= row.questionCount) return null

  const alreadyUsed = await database
    .select({ questionId: sessionQuestion.questionId })
    .from(sessionQuestion)
    .where(eq(sessionQuestion.sessionId, row.id))
  const usedIds = alreadyUsed.map((used) => used.questionId)

  const pool: PoolEntry[] = await database
    .select({
      questionId: questionEncoding.questionId,
      difficulty: questionEncoding.difficulty,
      answer: questionEncoding.answer,
    })
    .from(questionEncoding)
    .innerJoin(question, eq(question.id, questionEncoding.questionId))
    .where(and(eq(questionEncoding.profileId, row.profileId), eq(question.status, 'published')))
    .orderBy(asc(questionEncoding.questionId))

  const mode = findMode(row.mode) ?? standard30
  const picked = mode.pickNext(
    {
      index: row.currentIndex,
      questionCount: row.questionCount,
      usedQuestionIds: usedIds,
      correctCount: row.correctCount,
      streak: row.streak,
    },
    pool,
  )
  if (!picked) return null

  // 🔒 出題時刻はサーバが決める。経過時間の基準になる（prd/03 §7）
  const servedAt = new Date()
  await database.insert(sessionQuestion).values({
    sessionId: row.id,
    questionIndex: row.currentIndex,
    questionId: picked.questionId,
    profileId: row.profileId,
    servedAt,
    difficultyAtServe: picked.difficulty,
  })

  return await toQuestionView(picked.questionId, row.currentIndex, row.questionCount, servedAt)
}

async function toQuestionView(
  questionId: string,
  index: number,
  total: number,
  servedAt: Date,
): Promise<QuestionView | null> {
  const rows = await getDatabase()
    .select({
      id: question.id,
      width: question.width,
      height: question.height,
      category: question.category,
      objectKey: questionDisplayAsset.objectKey,
    })
    .from(question)
    .innerJoin(questionDisplayAsset, eq(questionDisplayAsset.questionId, question.id))
    .where(eq(question.id, questionId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  return {
    questionId: row.id,
    index,
    total,
    timeLimitMs: QUESTION_TIME_LIMIT_MS,
    servedAt: servedAt.toISOString(),
    displayUrl: assetUrl(row.objectKey),
    width: row.width,
    height: row.height,
    category: row.category,
  }
}

export type SubmitOutcome =
  | { status: 'ok'; result: AnswerResult }
  | { status: 'not-current' }
  | { status: 'already-answered' }
  | { status: 'too-fast' }

/**
 * 回答の受付と採点。
 *
 * 🔒 クライアントから受け取るのは「どちらを選んだか」だけ。
 * 経過時間はサーバの `served_at` 基準で測る（prd/03 §7）。
 */
export async function submitAnswer(
  row: SessionRow,
  questionId: string,
  chosen: Answer,
): Promise<SubmitOutcome> {
  const database = getDatabase()

  const servedRows = await database
    .select()
    .from(sessionQuestion)
    .where(
      and(
        eq(sessionQuestion.sessionId, row.id),
        eq(sessionQuestion.questionIndex, row.currentIndex),
      ),
    )
    .limit(1)

  const served = servedRows[0]
  if (!served || served.questionId !== questionId) return { status: 'not-current' }
  // 回答は 1 回だけ。既に入っている行への再 POST は拒否する（prd/03 §7）
  if (served.answeredAt) return { status: 'already-answered' }

  const encodingRows = await database
    .select()
    .from(questionEncoding)
    .where(
      and(
        eq(questionEncoding.questionId, questionId),
        eq(questionEncoding.profileId, row.profileId),
      ),
    )
    .limit(1)
  const encoding = encodingRows[0]
  if (!encoding) return { status: 'not-current' }

  const elapsedMs = Date.now() - served.servedAt.getTime()
  const timing = classifyTiming(elapsedMs)
  // 🔒 人間に不可能な速さは受け付けない（prd/04 §5 / T6）
  if (timing === 'too-fast') return { status: 'too-fast' }

  // 🔒 時間切れは不正解扱い（prd/04 §5）。選んだ内容によらず 0 点
  const timedOut = timing === 'timed-out'
  const correct = !timedOut && encoding.answer === chosen

  // 得点はサプライザル方式（prd/06 §1）。🔒 実測正答率は混ぜない
  const profileRows = await database
    .select({ pngWinRate: encodeProfile.pngWinRate })
    .from(encodeProfile)
    .where(eq(encodeProfile.id, row.profileId))
    .limit(1)
  const pngWinRate = profileRows[0]?.pngWinRate ?? 0

  const mode = findMode(row.mode) ?? standard30
  const awardedPoints =
    correct && pngWinRate > 0 && pngWinRate < 1
      ? mode.score({
          correct,
          answer: encoding.answer,
          difficulty: encoding.difficulty,
          pngWinRate,
        })
      : // プールが片方に寄りきっていると -log2(0) が発散する。
        // その条件は出題対象から外してあるが、保険として 0 点にする（例外にはしない）
        0
  const nextIndex = row.currentIndex + 1
  const streak = correct ? row.streak + 1 : 0

  /**
   * 🔒 **回答の受付は 1 回だけ**（prd/03 §7, prd/04 §2 の T4）。
   *
   * 上の `answeredAt` チェックだけでは、同じ Cookie で並行 POST されたときに
   * すべてのリクエストが「未回答」を読んで通り、`score` と `correct_count` が二重に積まれる。
   * **`answered_at IS NULL` を条件にした UPDATE で 1 件更新できた者だけ**が
   * セッション集計に進む。回答行とセッション行は同じトランザクションで確定させる。
   */
  const accepted = await database.transaction(async (tx) => {
    const [result] = await tx
      .update(sessionQuestion)
      .set({
        answeredAt: new Date(),
        answer: chosen,
        isCorrect: correct,
        elapsedMs,
        awardedPoints,
      })
      .where(
        and(
          eq(sessionQuestion.sessionId, row.id),
          eq(sessionQuestion.questionIndex, row.currentIndex),
          isNull(sessionQuestion.answeredAt),
        ),
      )

    if (result.affectedRows !== 1) return false

    await tx
      .update(session)
      .set({
        currentIndex: nextIndex,
        correctCount: sql`${session.correctCount} + ${correct ? 1 : 0}`,
        streak,
        maxStreak: sql`GREATEST(${session.maxStreak}, ${streak})`,
        score: sql`${session.score} + ${awardedPoints}`,
        ...(nextIndex >= row.questionCount
          ? { status: 'finished' as const, finishedAt: new Date() }
          : {}),
      })
      .where(eq(session.id, row.id))

    return true
  })

  if (!accepted) return { status: 'already-answered' }

  const assets = await database
    .select({ kind: questionEncodedAsset.kind, objectKey: questionEncodedAsset.objectKey })
    .from(questionEncodedAsset)
    .where(
      and(
        eq(questionEncodedAsset.questionId, questionId),
        eq(questionEncodedAsset.profileId, row.profileId),
      ),
    )

  const pngKey = assets.find((asset) => asset.kind === 'png')?.objectKey
  const jpegKey = assets.find((asset) => asset.kind === 'jpeg')?.objectKey
  if (!pngKey || !jpegKey) {
    throw new Error(`回答用アセットが揃っていない: ${questionId} / ${row.profileId}`)
  }

  // 「他の条件ならどうなるか」（prd/04 §4）。回答後なので開示してよい
  const allEncodings = await database
    .select({
      profileId: questionEncoding.profileId,
      pngBytes: questionEncoding.pngBytes,
      jpegBytes: questionEncoding.jpegBytes,
      answer: questionEncoding.answer,
    })
    .from(questionEncoding)
    .where(eq(questionEncoding.questionId, questionId))

  const profileResults: ProfileResult[] = ENCODE_PROFILES.flatMap((profile) => {
    const found = allEncodings.find((row) => row.profileId === profile.id)
    if (!found) return []
    return [
      {
        profileId: profile.id,
        jpegQuality: profile.jpegQuality,
        chromaSubsampling: profile.chromaSubsampling,
        pngOptimize: profile.pngOptimize,
        pngBytes: found.pngBytes,
        jpegBytes: found.jpegBytes,
        answer: found.answer,
        isStandard: profile.isStandard,
        isSelected: profile.id === row.profileId,
      },
    ]
  })

  const details = await database
    .select({
      explanation: question.explanation,
      source: question.source,
      displayKey: questionDisplayAsset.objectKey,
    })
    .from(question)
    .innerJoin(questionDisplayAsset, eq(questionDisplayAsset.questionId, question.id))
    .where(eq(question.id, questionId))
    .limit(1)
  const detail = details[0]

  return {
    status: 'ok',
    result: {
      correct,
      answer: encoding.answer,
      chosen,
      pngBytes: encoding.pngBytes,
      jpegBytes: encoding.jpegBytes,
      pngUrl: assetUrl(pngKey),
      jpegUrl: assetUrl(jpegKey),
      displayUrl: assetUrl(detail?.displayKey ?? ''),
      log2Ratio: encoding.log2Ratio,
      awardedPoints,
      timedOut,
      explanation: detail?.explanation ?? null,
      source: (detail?.source ?? {}) as Record<string, unknown>,
      profileResults,
      hasNext: nextIndex < row.questionCount,
    },
  }
}
