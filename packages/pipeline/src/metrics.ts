/**
 * 素材を測る指標（prd/05 §3.1）。
 *
 * ここは **sharp に依存しない純関数**にしておく。入力は正規化済みの生ピクセル。
 * こうしておくとテストが画像ファイルを必要としない。
 */

export interface RawImage {
  /** 行優先・チャンネルインターリーブの生ピクセル */
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  /** 1 画素あたりのチャンネル数。**比較に使うのは先頭 3ch（RGB）だけ** */
  channels: number
}

/**
 * `flat_ratio` — **有向隣接ペアのうち RGB が完全一致する割合**（prd/05 §3.1）。
 *
 * ```
 * 分母 = h*(w-1) + (h-1)*w   # 右方向のペア + 下方向のペア
 * 分子 = そのうち RGB 全チャンネルが一致するペアの数
 * ```
 *
 * 「画素」ではなく「ペア」を数えるのが定義の要。右と下を別々に数えるので、
 * 縦縞と横縞が対称に扱われる。完全な単色なら 1、隣接が毎回変わるノイズなら 0 に近づく。
 *
 * ⚠ **正規化後（背景合成・アルファ除去済み）の画像に対して測る。**
 * 透明画素が残っていると、値が背景色の扱いに依存して動く。
 */
export function flatRatio(image: RawImage): number {
  const { data, width, height, channels } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('width and height must be positive integers')
  }
  if (channels < 3) {
    throw new RangeError('channels must be at least 3 (RGB)')
  }
  if (data.length < width * height * channels) {
    throw new RangeError('data is shorter than width * height * channels')
  }

  const total = height * (width - 1) + (height - 1) * width
  // 1x1 は適格判定（prd/05 §3 ステップ 2）で除外済みだが、ゼロ除算だけは避ける
  if (total === 0) return 1

  let matched = 0
  const rowStride = width * channels

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride
    for (let x = 0; x < width; x++) {
      const index = rowStart + x * channels
      if (x + 1 < width && sameRgb(data, index, index + channels)) matched++
      if (y + 1 < height && sameRgb(data, index, index + rowStride)) matched++
    }
  }

  return matched / total
}

function sameRgb(data: Uint8Array | Uint8ClampedArray, a: number, b: number): boolean {
  return data[a] === data[b] && data[a + 1] === data[b + 1] && data[a + 2] === data[b + 2]
}

/**
 * 相異なる RGB の個数（prd/05 §3 ステップ 4）。
 * 可逆パレット化が効くか（256 以下か）の判定に使う。
 */
export function countColors(image: RawImage): number {
  const { data, width, height, channels } = image
  const seen = new Set<number>()
  for (let i = 0; i < width * height; i++) {
    const index = i * channels
    const r = data[index] ?? 0
    const g = data[index + 1] ?? 0
    const b = data[index + 2] ?? 0
    seen.add((r << 16) | (g << 8) | b)
  }
  return seen.size
}
