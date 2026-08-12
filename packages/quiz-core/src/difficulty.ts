/**
 * 静的難易度（prd/01 §4）。
 *
 * 🔒 実測正答率は絶対に混ぜない。二択では「みんなが間違える」＝「直感と逆が正解」が
 * 一意に決まるため、難易度経由で答えの方向が漏れる（prd/04 §3.5）。
 */

/** 出題の答え。小さいほうの形式（prd/01 §1） */
export type Answer = 'png' | 'jpeg'

/**
 * `log2(png_bytes / jpeg_bytes)`。
 * 負なら PNG が小さい（= PNG が正解）、正なら JPEG が小さい。
 */
export function log2Ratio(pngBytes: number, jpegBytes: number): number {
  if (!Number.isFinite(pngBytes) || !Number.isFinite(jpegBytes)) {
    throw new RangeError('bytes must be finite numbers')
  }
  if (pngBytes <= 0 || jpegBytes <= 0) {
    throw new RangeError('bytes must be positive')
  }
  return Math.log2(pngBytes / jpegBytes)
}

/**
 * バイト数から答えを決める。**同点の問題は採用しない**ので null を返す（prd/01 §1）。
 */
export function answerFor(pngBytes: number, jpegBytes: number): Answer | null {
  if (pngBytes === jpegBytes) return null
  return pngBytes < jpegBytes ? 'png' : 'jpeg'
}

/**
 * `|log2_ratio|` が 0 に近いほど難しい、を [0, 1] に写す（1 = 最難）。
 *
 * TODO(spec): 係数 `SATURATION` は暫定。prd/01 §4 は「|log2_ratio| から算出」までしか
 * 決めていない。実測レンジ（0.11〜4.65）に合わせて 4 を置いた。遊んでから調整する。
 */
const SATURATION = 4

export function staticDifficulty(log2RatioValue: number): number {
  if (!Number.isFinite(log2RatioValue)) {
    throw new RangeError('log2Ratio must be a finite number')
  }
  const distance = Math.abs(log2RatioValue)
  if (distance >= SATURATION) return 0
  return 1 - distance / SATURATION
}
