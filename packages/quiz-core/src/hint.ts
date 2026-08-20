import type { ColorRange } from './contract.ts'

/**
 * 色数ヒント（prd/06 §7）。
 *
 * **減点と引き換えに、その画像の色数を 2 段階のレンジで開示する。**
 * T7（答えの方向を示す情報を回答前に出さない。prd/04 §3.5）の**唯一の例外**であり、
 * 成立条件は prd/04 §3.6 の 4 つ（opt-in / 記録が開示に先行 / 全問一律の定率 / 静的実測値のみ）。
 *
 * 🔒 ここは DB も HTTP も知らない純関数に保つ（prd/02 §4-1）。
 */

/**
 * レンジの境界は 256 のみ（prd/06 §7.1）。可逆パレット化が効くかの境界で、
 * 教材として意味のある境界はこれだけ（16 の境界を出すと減色合成の意地悪問題が割れる）。
 */
export const COLOR_RANGE_BOUNDARY = 256

/**
 * 実測色数を 2 段階レンジに落とす。
 * ⚠ `question.color_count` は 257 でキャップされている（257 = 256 超。prd/03 §3）が、
 * 境界が 256 なのでレンジの判定には影響しない。
 */
export function colorRange(colorCount: number): ColorRange {
  if (!Number.isInteger(colorCount) || colorCount < 1) {
    throw new RangeError('color_count は 1 以上の整数でなければならない')
  }
  return colorCount <= COLOR_RANGE_BOUNDARY ? 'le256' : 'gt256'
}

/**
 * モードごとのヒント設定（prd/06 §7.4）。`null` ならそのモードにヒントは無い。
 *
 * 🔒 **減点率は全問一律の定率**（prd/06 §7.2）。問題ごとに変えると、
 * 減点率そのものが答えの方向を指す第二の漏洩経路になる（T7 の再帰）。
 */
export interface HintConfig {
  kind: 'color-count-range'
  /** [0, 1)。1 未満でなければならない（「見て正解 > 見ずに不正解」を保つ） */
  penaltyRate: number
}

/**
 * `standard-30` の減点率（prd/06 §7.2）。
 *
 * 0.5 で 3 つが同時に成り立つ:
 * 1. 「見て正解」（0.5 S）＞「見ずに不正解」（0）
 * 2. ヒントが答えを確定させても EV は当てずっぽうと同じ 0.5 S（ヒント連打で上位に届かない）
 * 3. 損益分岐は q₀ < 0.5 —— 直感が裏切られる問題でだけ引き合う
 *
 * ⚠ 緩めると性質 2 が崩れる（−30% では確定ヒントの EV 0.7 S が当てずっぽうを超える）。
 */
export const HINT_PENALTY_RATE = 0.5

/** ヒント要求の判定に必要な、出題済み行の断面（prd/03 §7 の `session_question`） */
export interface ServedForHint {
  questionId: string
  answeredAt: Date | null
  hintUsedAt: Date | null
}

export type HintDecision =
  /** 初回開示。🔒 呼び出し側は**永続化してから**レンジを返すこと（prd/06 §7.3） */
  | 'disclose'
  /** 支払い済みの再要求。保存済みのレンジを返す（二重減点しない） */
  | 'replay'
  /** モードにヒントが無い */
  | 'reject-not-allowed'
  /** 現在の問題ではない（進行ずれ・questionId 不一致・未配信） */
  | 'reject-not-current'
  /** 回答済みの行への要求は拒否（prd/06 §7.3） */
  | 'reject-answered'

/**
 * ヒント要求の受理判定（prd/06 §7.3）。
 * DB を触るのは呼び出し側で、ここは**判定だけ**を持つ（冪等・拒否の規則を 1 箇所に集める）。
 */
export function decideHint(
  hint: HintConfig | null,
  served: ServedForHint | null,
  questionId: string,
): HintDecision {
  if (!hint) return 'reject-not-allowed'
  if (!served || served.questionId !== questionId) return 'reject-not-current'
  // ⚠ 回答済みが先勝ち。回答後にヒント代だけ請求される事故を作らない
  if (served.answeredAt) return 'reject-answered'
  return served.hintUsedAt ? 'replay' : 'disclose'
}
