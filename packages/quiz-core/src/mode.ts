import type { Answer } from './contract.ts'
import { HINT_PENALTY_RATE, type HintConfig } from './hint.ts'
import { type ScoreInput, scoreQuestion } from './score.ts'

/**
 * モード抽象（prd/02 §4-1）。**最重要の差し替え点。**
 *
 * 遊んでみて思いついた競技基準を後から足せるようにする。
 * ⚠ **DB も HTTP も知らない純関数**に保つ。ここが Phase 2 の Vite + Hono 版と共有される本体になる。
 */

/** 出題候補。🔒 `difficulty` はサーバ内部の値で、クライアントには渡さない */
export interface PoolEntry {
  questionId: string
  /** 静的難易度 [0, 1]。1 が最難（拮抗） */
  difficulty: number
  /** そのプロファイルでの正解 */
  answer: Answer
}

/** 出題選択に渡す進行状況 */
export interface ModeState {
  /** 何問目か（0 始まり） */
  index: number
  questionCount: number
  usedQuestionIds: readonly string[]
  correctCount: number
  streak: number
}

export interface QuizMode {
  id: string
  /** 条件選択を許すか（prd/06 §2） */
  allowProfileChoice: boolean
  /**
   * 色数ヒント（prd/06 §7.4）。**null = このモードにヒントは無い**。
   * ⚠ 連勝を競技基準にするモード（endless）には載せない——連勝数は減点できない量（prd/06 §7.2）。
   */
  hint: HintConfig | null
  /** プールの大きさから 1 セッションの問題数を決める */
  questionCount(poolSize: number): number
  /** 出題選択と終了条件（null で終了） */
  pickNext(state: ModeState, pool: readonly PoolEntry[]): PoolEntry | null
  /** 得点計算 */
  score(input: ScoreInput): number
}

/** prd/06 §2 の既定モード。30 問固定・難易度カーブ・条件選択あり。 */
export const STANDARD_30_QUESTION_COUNT = 30

/**
 * 人間に不可能な速さを弾く（prd/04 §5 / T6）。
 *
 * ⚠ **上限は無い**（制限時間は 2026-08-14 に廃止した。prd/04 §5.1）。ここで見るのは
 * 「速すぎる」側だけで、遅い側は自動化の兆候ではないので判定に使わない。
 */
export const MIN_ANSWER_MS = 300

export type AnswerTiming = 'ok' | 'too-fast'

/**
 * 🔒 **経過時間はサーバの `served_at` 基準**で測ったものを渡すこと（prd/03 §7）。
 * クライアントの申告値は使わない。
 */
export function classifyTiming(elapsedMs: number): AnswerTiming {
  if (elapsedMs < MIN_ANSWER_MS) return 'too-fast'
  return 'ok'
}

/**
 * 難易度カーブ（prd/01 §4.3）。**易しい問題から段階的に難しくする。**
 *
 * 進行度 `t = index / (questionCount - 1)` をそのまま目標難易度にし、
 * 未使用の候補から**目標に最も近いもの**を選ぶ。
 *
 * ⚠ カーブがある時点で「後半ほど難しい」は開示されている。これは体験のために許容するが、
 * **難易度の数値そのものは回答前に見せない**（prd/04 §3.5）。
 */
export function targetDifficulty(index: number, questionCount: number): number {
  if (questionCount <= 1) return 0
  const t = index / (questionCount - 1)
  return Math.min(1, Math.max(0, t))
}

/**
 * 出題選択の本体。`standard-30` と `practice` で共有する
 * （違いは**問題数だけ**なので、カーブと重複回避は 1 つに保つ）。
 */
function pickByCurve(state: ModeState, pool: readonly PoolEntry[]): PoolEntry | null {
  if (state.index >= state.questionCount) return null

  const used = new Set(state.usedQuestionIds)
  // 同一セッション内で同じ問題を二度出さない（prd/01 §4.3）
  const candidates = pool.filter((entry) => !used.has(entry.questionId))
  if (candidates.length === 0) return null

  const target = targetDifficulty(state.index, state.questionCount)
  let best = candidates[0]
  if (!best) return null
  let bestDistance = Math.abs(best.difficulty - target)

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.difficulty - target)
    // 同距離なら questionId の辞書順で決める（**選択を決定的にする**ため）
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate.questionId < best.questionId)
    ) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * prd/06 §2 の既定モード。🔒 **30 問固定。**
 *
 * 二択 × 10 問では実力差が出ない（実力 80% の人が全問正解する確率が 10.7% で、
 * 100 人遊べば 10 人が満点になる）。30 問で 0.12%。**ランキングはこの前提に乗っている**ので、
 * プールが足りないときは**短くせず、そのプロファイルでの開始を断る**。
 */
/** `standard-30` のヒント設定。減点は一律 ×0.5（prd/06 §7.2） */
const standardHint: HintConfig = { kind: 'color-count-range', penaltyRate: HINT_PENALTY_RATE }

/** `practice` のヒント設定。ランキングに載らないので減点なし（prd/06 §7.4） */
const practiceHint: HintConfig = { kind: 'color-count-range', penaltyRate: 0 }

export const standard30: QuizMode = {
  id: 'standard-30',
  allowProfileChoice: true,
  hint: standardHint,
  questionCount(): number {
    return STANDARD_30_QUESTION_COUNT
  },
  pickNext: pickByCurve,
  score(input) {
    return scoreQuestion(input, standardHint)
  },
}

/**
 * 問題プールが 30 問に満たない条件でも遊べるようにする**練習モード**。
 *
 * ⚠ **`standard-30` とは別の ID にする。** 問題数が違えば得点の積み上げも変わるので、
 * 同じランキングに混ぜてはいけない（prd/06 §2）。素材が増えれば出番は無くなる。
 */
export const practice: QuizMode = {
  id: 'practice',
  allowProfileChoice: true,
  hint: practiceHint,
  questionCount(poolSize: number): number {
    return Math.max(1, Math.min(STANDARD_30_QUESTION_COUNT, poolSize))
  },
  pickNext: pickByCurve,
  score(input) {
    return scoreQuestion(input, practiceHint)
  },
}

/**
 * 「おまかせ開始」で使うモード（prd/06 §2.1）。`/` を開いた瞬間の出題はここで決まる。
 *
 * 🔒 **`standard-30` を短くしない。** プールが 30 問に満たなければ `practice` を選ぶ。
 * ランキングは 30 問という前提に乗っているため、短い `standard-30` を作ってはいけない。
 */
export function defaultModeForPool(poolSize: number): QuizMode {
  return poolSize >= STANDARD_30_QUESTION_COUNT ? standard30 : practice
}

export const MODES: Readonly<Record<string, QuizMode>> = {
  [standard30.id]: standard30,
  [practice.id]: practice,
}

export function findMode(id: string): QuizMode | undefined {
  return MODES[id]
}
