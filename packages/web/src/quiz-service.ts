import {
  getDatabase,
  question,
  questionDisplayAsset,
  questionEncodedAsset,
  questionEncoding,
  session,
  sessionQuestion,
} from '@png-jpeg-quiz/database'
import type { Answer, AnswerResult, QuestionView } from '@png-jpeg-quiz/quiz-core'
import { and, asc, eq, notInArray, sql } from 'drizzle-orm'
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
 * TODO(spec): 難易度カーブ（prd/01 §4.3）は M2。M1 は「易しい順」に出すだけ。
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
    return await toQuestionView(current.questionId, row.currentIndex, row.questionCount)
  }

  if (row.currentIndex >= row.questionCount) return null

  const alreadyUsed = await database
    .select({ questionId: sessionQuestion.questionId })
    .from(sessionQuestion)
    .where(eq(sessionQuestion.sessionId, row.id))
  const usedIds = alreadyUsed.map((used) => used.questionId)

  const candidates = await database
    .select({
      questionId: questionEncoding.questionId,
      difficulty: questionEncoding.difficulty,
    })
    .from(questionEncoding)
    .innerJoin(question, eq(question.id, questionEncoding.questionId))
    .where(
      and(
        eq(questionEncoding.profileId, row.profileId),
        eq(question.status, 'published'),
        usedIds.length > 0 ? notInArray(questionEncoding.questionId, usedIds) : undefined,
      ),
    )
    .orderBy(asc(questionEncoding.difficulty))
    .limit(1)

  const picked = candidates[0]
  if (!picked) return null

  await database.insert(sessionQuestion).values({
    sessionId: row.id,
    questionIndex: row.currentIndex,
    questionId: picked.questionId,
    profileId: row.profileId,
    difficultyAtServe: picked.difficulty,
  })

  return await toQuestionView(picked.questionId, row.currentIndex, row.questionCount)
}

async function toQuestionView(
  questionId: string,
  index: number,
  total: number,
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

  const correct = encoding.answer === chosen
  const elapsedMs = Date.now() - served.servedAt.getTime()

  // TODO(spec): 得点は M2（prd/06 §1 のサプライザル方式）。M1 は正解 1 点で通す
  const awardedPoints = correct ? 1 : 0

  await database
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
      ),
    )

  const nextIndex = row.currentIndex + 1
  const streak = correct ? row.streak + 1 : 0
  await database
    .update(session)
    .set({
      currentIndex: nextIndex,
      correctCount: sql`${session.correctCount} + ${correct ? 1 : 0}`,
      streak,
      maxStreak: Math.max(row.maxStreak, streak),
      score: sql`${session.score} + ${awardedPoints}`,
      ...(nextIndex >= row.questionCount
        ? { status: 'finished' as const, finishedAt: new Date() }
        : {}),
    })
    .where(eq(session.id, row.id))

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
      explanation: detail?.explanation ?? null,
      source: (detail?.source ?? {}) as Record<string, unknown>,
      hasNext: nextIndex < row.questionCount,
    },
  }
}
