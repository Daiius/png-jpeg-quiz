import type { Answer } from './contract.ts'
import type { HintConfig } from './hint.ts'

/**
 * 得点（prd/06 §1・サプライザル方式）。
 *
 * ```
 * 得点 = Σ [ 正解 × 静的難易度重み × ( -log2( p_profile(その問題の答え) ) ) ]
 * ```
 *
 * 🔒 **実測正答率は絶対に混ぜない。** 二択では「みんなが間違える」＝「直感と逆が正解」が
 * 一意に決まるので、得点の重みが答えの方向を指してしまう（prd/04 §3.5, prd/06 §1）。
 * ここで使ってよいのは**対称な情報だけ**——プロファイル全体の偏りと、サイズ比の拮抗度。
 */

/**
 * そのプロファイルのプールで、その答えが占める割合。
 * `png_win_rate` は「PNG が正解の問題の割合」（prd/03 §2）。
 */
export function answerProbability(pngWinRate: number, answer: Answer): number {
  if (!(pngWinRate > 0 && pngWinRate < 1)) {
    throw new RangeError('png_win_rate は 0 < p < 1 でなければならない')
  }
  return answer === 'png' ? pngWinRate : 1 - pngWinRate
}

/**
 * 少数派を当てるほど大きい「驚き」の量（bit）。
 * q60（PNG 勝ち 30%）で JPEG を当てても 0.51 bit、PNG を見抜けば 1.74 bit。
 */
export function surprisal(probability: number): number {
  if (!(probability > 0 && probability <= 1)) {
    throw new RangeError('確率は 0 < p <= 1 でなければならない')
  }
  return -Math.log2(probability)
}

/**
 * 静的難易度から重みを作る。
 *
 * TODO(spec): 係数は暫定。prd/06 §1 は「`|log2_ratio|` から算出した値（拮抗しているほど大きい）」
 * としか決めていない。**易問でも 1 倍は入る**ようにして、難問で最大 2 倍にした。
 * `difficulty` をそのまま掛けると易問が 0 点になり、30 問の積み上げが効かなくなる。
 */
export function difficultyWeight(difficulty: number): number {
  if (!(difficulty >= 0 && difficulty <= 1)) {
    throw new RangeError('difficulty は [0, 1] でなければならない')
  }
  return 1 + difficulty
}

export interface ScoreInput {
  correct: boolean
  /** その問題の正解（プロファイル依存） */
  answer: Answer
  /** 静的難易度 [0, 1]。🔒 クライアントには渡さない */
  difficulty: number
  /** そのプロファイルのプールでの PNG 正解率 */
  pngWinRate: number
  /** 色数ヒントを開示したか（prd/06 §7.2）。開示した時点で確定し、正誤に関係なく効く */
  hintUsed?: boolean
}

/**
 * 1 問分の得点。**不正解は 0 点**（prd/06 §1。⚠ 時間切れは無い。prd/04 §5.1）。
 *
 * ヒント使用時は `× (1 - penaltyRate)`（prd/06 §7.2）。
 * 🔒 減点率は**全問一律の定率**——問題ごとに変えると減点率そのものが
 * 答えの方向を指す第二の漏洩経路になる（T7 の再帰。prd/04 §3.6）。
 */
export function scoreQuestion(input: ScoreInput, hint?: HintConfig | null): number {
  if (hint && !(hint.penaltyRate >= 0 && hint.penaltyRate < 1)) {
    // 1 を許すと「見て正解」＝「見ずに不正解」になり、使う理由が消える（prd/06 §7.2 性質 1）
    throw new RangeError('penaltyRate は [0, 1) でなければならない')
  }
  if (!input.correct) return 0
  const probability = answerProbability(input.pngWinRate, input.answer)
  const base = difficultyWeight(input.difficulty) * surprisal(probability)
  if (!input.hintUsed || !hint) return base
  return base * (1 - hint.penaltyRate)
}

/**
 * そのプロファイルを選んだときの 1 問あたりの期待値（＝エントロピー `H(p)`）。
 *
 * **50:50 の標準条件で最大**になる。偏った条件は期待値が低い代わりに分散が大きい——
 * つまり**ハイリスク・ハイリターン**であり、条件が違っても 1 本のランキングに混ぜられる。
 */
export function expectedSurprisal(pngWinRate: number): number {
  const p = pngWinRate
  if (!(p > 0 && p < 1)) throw new RangeError('png_win_rate は 0 < p < 1 でなければならない')
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p))
}
