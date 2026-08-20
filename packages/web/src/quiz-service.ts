import {
  encodeProfile,
  getDatabase,
  question,
  questionDisplayAsset,
  questionEncodedAsset,
  questionEncoding,
  questionOverlayAsset,
  session,
  sessionQuestion,
} from '@png-jpeg-quiz/database'
import {
  type Answer,
  type AnswerResult,
  CHROMA_SUBSAMPLINGS,
  type ColorRange,
  classifyTiming,
  colorRange,
  decideHint,
  ENCODE_PROFILES,
  findMode,
  JPEG_QUALITIES,
  type PoolEntry,
  type ProfileResult,
  type QuestionView,
  type SessionStateResponse,
  standard30,
  type VerificationView,
} from '@png-jpeg-quiz/quiz-core'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { assetUrl } from './env.ts'
import type { SessionRow } from './session.ts'

/**
 * 出題と採点。**サーバだけが正解を持つ**（prd/04 §2）。
 *
 * 🔒 出題レスポンスに含めてよいのは `display` の URL・寸法・カテゴリだけ。
 * 正解・両形式のバイト数・png/jpeg の URL・難易度の数値は、回答を受け取るまで一切送らない。
 */

/** 出題ペイロード。`hint` は**支払い済み**の色数レンジの再表示（null = 未使用。prd/06 §7.3） */
export interface ServedQuestion {
  question: QuestionView
  hint: ColorRange | null
}

/**
 * 次の問題を選んで `session_question` に記録する。
 *
 * **出題選択は `quiz-core` のモードに委ねる**（prd/02 §4-1）。
 * ここは「DB から候補を集めて、選ばれたものを記録する」だけに留める。
 */
export async function serveNextQuestion(row: SessionRow): Promise<ServedQuestion | null> {
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
    const view = await toQuestionView(current.questionId, row.currentIndex, row.questionCount)
    if (!view) return null
    // 🔒 支払い済み（`hint_used_at` 非 null）のときだけレンジを載せる。無償では出さない（prd/04 §3.6）
    const hint = current.hintUsedAt ? await colorRangeFor(current.questionId) : null
    return { question: view, hint }
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

  const view = await toQuestionView(picked.questionId, row.currentIndex, row.questionCount)
  if (!view) return null
  return { question: view, hint: null }
}

/**
 * `question.color_count` を 2 段階レンジに落とす（prd/06 §7.1）。
 * 🔒 実行時に数えない——パイプラインの事前実測（prd/05 §3 ステップ 4）を読むだけ（原則 4）。
 */
async function colorRangeFor(questionId: string): Promise<ColorRange> {
  const rows = await getDatabase()
    .select({ colorCount: question.colorCount })
    .from(question)
    .where(eq(question.id, questionId))
    .limit(1)
  const count = rows[0]?.colorCount
  if (count === undefined) throw new Error(`問題が見つからない: ${questionId}`)
  return colorRange(count)
}

export type HintOutcome =
  | { status: 'ok'; colorRange: ColorRange }
  | { status: 'not-allowed' }
  | { status: 'not-current' }
  | { status: 'already-answered' }

/**
 * 色数ヒントの開示（prd/06 §7.3）。
 *
 * 🔒 **永続化が開示に先行する。** `hint_used_at` を書けた者だけがレンジを受け取る。
 * 開示した時点で減点が確定し、以後の回答内容・正誤に関係しない（prd/04 §3.6 の条件 2）。
 * 冪等: 支払い済みの再要求には保存済みのレンジを返す（二重減点しない）。
 */
export async function requestHint(row: SessionRow, questionId: string): Promise<HintOutcome> {
  const database = getDatabase()
  const mode = findMode(row.mode) ?? standard30

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
  const served = servedRows[0] ?? null

  const decision = decideHint(mode.hint, served, questionId)
  if (decision === 'reject-not-allowed') return { status: 'not-allowed' }
  if (decision === 'reject-not-current') return { status: 'not-current' }
  if (decision === 'reject-answered') return { status: 'already-answered' }
  if (decision === 'replay') return { status: 'ok', colorRange: await colorRangeFor(questionId) }

  // 初回開示。並行要求や回答との競合に備え、`hint_used_at IS NULL AND answered_at IS NULL` を
  // 条件にした UPDATE で 1 件更新できた者だけが「開示した」ことになる（submitAnswer と同じ形）
  const [result] = await database
    .update(sessionQuestion)
    .set({ hintUsedAt: new Date() })
    .where(
      and(
        eq(sessionQuestion.sessionId, row.id),
        eq(sessionQuestion.questionIndex, row.currentIndex),
        isNull(sessionQuestion.hintUsedAt),
        isNull(sessionQuestion.answeredAt),
      ),
    )

  if (result.affectedRows !== 1) {
    // 競合に負けた側。行を読み直して同じ規則で判定し直す（冪等）
    const settledRows = await database
      .select()
      .from(sessionQuestion)
      .where(
        and(
          eq(sessionQuestion.sessionId, row.id),
          eq(sessionQuestion.questionIndex, row.currentIndex),
        ),
      )
      .limit(1)
    const retry = decideHint(mode.hint, settledRows[0] ?? null, questionId)
    if (retry === 'replay') return { status: 'ok', colorRange: await colorRangeFor(questionId) }
    if (retry === 'reject-answered') return { status: 'already-answered' }
    return { status: 'not-current' }
  }

  return { status: 'ok', colorRange: await colorRangeFor(questionId) }
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

/**
 * セッション状態（リロード復元用。prd/06 §2.1）。
 *
 * 🔒 返すのは**プレイヤー自身の集計値**と**回答済みの問題の開示**だけ。
 * 未回答の問題については、配信済みかどうか（`currentServed`）以上の情報を入れない（prd/04 §3.5）。
 */
export async function sessionState(row: SessionRow): Promise<SessionStateResponse> {
  const database = getDatabase()

  const nearby = await database
    .select()
    .from(sessionQuestion)
    .where(
      and(
        eq(sessionQuestion.sessionId, row.id),
        inArray(sessionQuestion.questionIndex, [row.currentIndex - 1, row.currentIndex]),
      ),
    )
  const prev = nearby.find((entry) => entry.questionIndex === row.currentIndex - 1)
  const current = nearby.find((entry) => entry.questionIndex === row.currentIndex)

  let lastQuestion: QuestionView | null = null
  let lastResult: AnswerResult | null = null
  if (prev?.answeredAt && prev.answer) {
    const encoding = await findEncoding(prev.questionId, row.profileId)
    if (encoding) {
      lastQuestion = await toQuestionView(prev.questionId, prev.questionIndex, row.questionCount)
      lastResult = await discloseResult(row, prev.questionId, encoding, {
        chosen: prev.answer,
        correct: prev.isCorrect ?? encoding.answer === prev.answer,
        awardedPoints: prev.awardedPoints ?? 0,
        hintUsed: prev.hintUsedAt !== null,
        hasNext: row.currentIndex < row.questionCount,
      })
    }
  }

  return {
    mode: row.mode,
    profileId: row.profileId,
    status: row.status,
    score: row.score,
    correctCount: row.correctCount,
    currentIndex: row.currentIndex,
    questionCount: row.questionCount,
    currentServed: current !== undefined,
    lastQuestion,
    lastResult,
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
 *
 * ⚠ **制限時間は無い**（prd/04 §5.1）。経過時間は記録と「速すぎる」判定にだけ使う。
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
  if (!served || served.questionId !== questionId) {
    // 🔁 直前に回答済みの問題への「同一回答の再送」なら、保存済みの結果を返す（冪等）
    const replayed = await replayAnsweredQuestion(row, questionId, chosen)
    if (replayed) return { status: 'ok', result: replayed }
    return { status: 'not-current' }
  }
  if (served.answeredAt) {
    // 回答は 1 回だけ。異なる回答の再 POST は拒否する（prd/03 §7）
    if (served.answer !== chosen) return { status: 'already-answered' }
    // 🔁 同一回答の再送。再送側の認証が最初の POST の確定より先に走ると、
    // ここで回答済み行を読む（競合の窓。OCL-0C8DBA59）。この順序でも冪等に返す
    const encoding = await findEncoding(questionId, row.profileId)
    if (!encoding) return { status: 'already-answered' }
    return {
      status: 'ok',
      result: await discloseResult(row, questionId, encoding, {
        chosen,
        correct: served.isCorrect ?? encoding.answer === chosen,
        awardedPoints: served.awardedPoints ?? 0,
        hintUsed: served.hintUsedAt !== null,
        // 最初の受付で進行は確定済み。この行は row.currentIndex の位置なので、次は +1
        hasNext: row.currentIndex + 1 < row.questionCount,
      }),
    }
  }

  const encoding = await findEncoding(questionId, row.profileId)
  if (!encoding) return { status: 'not-current' }

  // 🔒 経過時間はサーバの `served_at` 基準（prd/03 §7）。クライアントの時計は使わない
  const elapsedMs = Date.now() - served.servedAt.getTime()
  if (classifyTiming(elapsedMs) === 'too-fast') {
    // 🔒 人間に不可能な速さは受け付けない（prd/04 §5 / T6）
    return { status: 'too-fast' }
  }

  const correct = encoding.answer === chosen

  // 得点はサプライザル方式（prd/06 §1）。🔒 実測正答率は混ぜない
  const profileRows = await database
    .select({ pngWinRate: encodeProfile.pngWinRate })
    .from(encodeProfile)
    .where(eq(encodeProfile.id, row.profileId))
    .limit(1)
  const pngWinRate = profileRows[0]?.pngWinRate ?? 0

  const mode = findMode(row.mode) ?? standard30
  // ヒントは開示した時点で確定している（prd/06 §7.3）。減点はモード定義の一律定率（§7.2）
  const hintUsed = served.hintUsedAt !== null
  const awardedPoints =
    correct && pngWinRate > 0 && pngWinRate < 1
      ? mode.score({
          correct,
          answer: encoding.answer,
          // 🔒 **出題時点の難易度**を使う（prd/03 §7）。問題データが再生成されても
          // 同じ出題に対する得点が再現できるようにする
          difficulty: served.difficultyAtServe,
          pngWinRate,
          hintUsed,
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

  if (!accepted) {
    // 並行 POST に負けた側。同一回答なら保存済みの結果を返し（冪等）、異なる回答なら拒否する
    const settledRows = await database
      .select()
      .from(sessionQuestion)
      .where(
        and(
          eq(sessionQuestion.sessionId, row.id),
          eq(sessionQuestion.questionIndex, row.currentIndex),
        ),
      )
      .limit(1)
    const settled = settledRows[0]
    if (settled?.answeredAt && settled.answer === chosen) {
      return {
        status: 'ok',
        result: await discloseResult(row, questionId, encoding, {
          chosen,
          correct: settled.isCorrect ?? encoding.answer === chosen,
          awardedPoints: settled.awardedPoints ?? 0,
          hintUsed: settled.hintUsedAt !== null,
          hasNext: nextIndex < row.questionCount,
        }),
      }
    }
    return { status: 'already-answered' }
  }

  return {
    status: 'ok',
    result: await discloseResult(row, questionId, encoding, {
      chosen,
      correct,
      awardedPoints,
      hintUsed,
      hasNext: nextIndex < row.questionCount,
    }),
  }
}

/**
 * 🔁 「現在の問題ではない」再送のうち、**直前に回答済みの問題への同一回答の再送**にだけ、
 * 保存済みの結果を返す（冪等な再送。prd/02 §4-2）。
 *
 * 送信後に応答を失ったクライアントは同じ回答をリトライしてよい。得点・進行は最初の受付時に
 * 確定済みで、ここでは**読み出すだけ**なので二重採点にならない。
 * ⚠ **異なる回答の再送は受け付けない**（回答は 1 回だけ。prd/03 §7）。
 */
async function replayAnsweredQuestion(
  row: SessionRow,
  questionId: string,
  chosen: Answer,
): Promise<AnswerResult | null> {
  if (row.currentIndex < 1) return null
  const database = getDatabase()

  const prevRows = await database
    .select()
    .from(sessionQuestion)
    .where(
      and(
        eq(sessionQuestion.sessionId, row.id),
        eq(sessionQuestion.questionIndex, row.currentIndex - 1),
      ),
    )
    .limit(1)
  const prev = prevRows[0]
  if (!prev || prev.questionId !== questionId || !prev.answeredAt) return null
  if (prev.answer !== chosen) return null

  const encoding = await findEncoding(questionId, row.profileId)
  if (!encoding) return null

  return await discloseResult(row, questionId, encoding, {
    chosen,
    correct: prev.isCorrect ?? encoding.answer === chosen,
    awardedPoints: prev.awardedPoints ?? 0,
    hintUsed: prev.hintUsedAt !== null,
    // 進行は最初の受付時に確定済み。currentIndex は既に次の問題を指している
    hasNext: row.currentIndex < row.questionCount,
  })
}

async function findEncoding(
  questionId: string,
  profileId: string,
): Promise<typeof questionEncoding.$inferSelect | undefined> {
  const rows = await getDatabase()
    .select()
    .from(questionEncoding)
    .where(
      and(eq(questionEncoding.questionId, questionId), eq(questionEncoding.profileId, profileId)),
    )
    .limit(1)
  return rows[0]
}

/**
 * 回答後の開示ペイロードを組み立てる（prd/04 §4「回答後は全部見せる」）。
 * ⚠ 採点はしない。判定済みの値を受け取って詰めるだけ（正規経路と再送経路で共有する）。
 */
async function discloseResult(
  row: SessionRow,
  questionId: string,
  encoding: typeof questionEncoding.$inferSelect,
  input: {
    chosen: Answer
    correct: boolean
    awardedPoints: number
    hintUsed: boolean
    hasNext: boolean
  },
): Promise<AnswerResult> {
  const database = getDatabase()

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

  // 検証ビュー（prd/04 §4.1）。🔒 回答後なので開示してよい
  const overlays = await database
    .select({
      jpegQuality: questionOverlayAsset.jpegQuality,
      chromaSubsampling: questionOverlayAsset.chromaSubsampling,
      metric: questionOverlayAsset.metric,
      objectKey: questionOverlayAsset.objectKey,
    })
    .from(questionOverlayAsset)
    .where(eq(questionOverlayAsset.questionId, questionId))

  const scalarRows = await database
    .select({
      profileId: questionEncoding.profileId,
      over2Pct: questionEncoding.de00Over2Pct,
    })
    .from(questionEncoding)
    .where(eq(questionEncoding.questionId, questionId))

  const verification: VerificationView[] = []
  for (const quality of JPEG_QUALITIES) {
    for (const subsampling of CHROMA_SUBSAMPLINGS) {
      const de00 = overlays.find(
        (row) =>
          row.jpegQuality === quality &&
          row.chromaSubsampling === subsampling &&
          row.metric === 'de00',
      )
      const ssim = overlays.find(
        (row) =>
          row.jpegQuality === quality &&
          row.chromaSubsampling === subsampling &&
          row.metric === 'ssim',
      )
      // 片方でも欠けている条件は出さない（片肺の検証ビューは誤読を招く）
      if (!de00 || !ssim) continue

      // スカラーはどのプロファイルでも同じ（PNG 最適化は JPEG を変えない）
      const anyProfile = ENCODE_PROFILES.find(
        (profile) => profile.jpegQuality === quality && profile.chromaSubsampling === subsampling,
      )
      const scalar = scalarRows.find((row) => row.profileId === anyProfile?.id)

      verification.push({
        jpegQuality: quality,
        chromaSubsampling: subsampling,
        over2Pct: scalar?.over2Pct ?? null,
        de00Url: assetUrl(de00.objectKey),
        ssimUrl: assetUrl(ssim.objectKey),
      })
    }
  }

  const details = await database
    .select({
      explanation: question.explanation,
      source: question.source,
      // 回答後は実数を開示する（prd/04 §4。ヒントの答え合わせ）。⚠ 257 = 256 超（prd/03 §3）
      colorCount: question.colorCount,
      displayKey: questionDisplayAsset.objectKey,
    })
    .from(question)
    .innerJoin(questionDisplayAsset, eq(questionDisplayAsset.questionId, question.id))
    .where(eq(question.id, questionId))
    .limit(1)
  const detail = details[0]

  return {
    correct: input.correct,
    answer: encoding.answer,
    chosen: input.chosen,
    pngBytes: encoding.pngBytes,
    jpegBytes: encoding.jpegBytes,
    pngUrl: assetUrl(pngKey),
    jpegUrl: assetUrl(jpegKey),
    displayUrl: assetUrl(detail?.displayKey ?? ''),
    log2Ratio: encoding.log2Ratio,
    awardedPoints: input.awardedPoints,
    colorCount: detail?.colorCount ?? 257,
    hintUsed: input.hintUsed,
    explanation: detail?.explanation ?? null,
    source: (detail?.source ?? {}) as Record<string, unknown>,
    profileResults,
    verification,
    hasNext: input.hasNext,
  }
}
