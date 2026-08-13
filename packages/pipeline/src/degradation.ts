import type { RawImage } from './metrics.ts'

/**
 * 劣化の測定と可視化（prd/05 §6 / prd/04 §4.1）。
 *
 * 参照は**前処理後の原本**（＝可逆 PNG と画素単位で同一）。それに対して各条件の JPEG が
 * どこをどれだけ狂わせたかを、**ΔE00（CIEDE2000）**と **SSIM** の 2 つで測る。
 *
 * 🔒 **ここは実行時（web）に載せない。** 画像を触るものはパイプライン専用（prd/02 §1）。
 * ⚠ **CIEDE2000 は間違えても「それらしい絵」が出る。** Sharma らのテストベクタで
 * 縛ってあるので、式に触るときは必ず `degradation.test.ts` を通すこと（prd/05 §6）。
 */

// ============================================================
// sRGB → CIELAB（D65）
// ============================================================

/** sRGB の伝達関数の逆（8bit 値 0..255 → 線形 0..1） */
function srgbToLinear(value8: number): number {
  const c = value8 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** D65 白色点（sRGB の基準） */
const WHITE_X = 0.95047
const WHITE_Y = 1.0
const WHITE_Z = 1.08883

const DELTA = 6 / 29

/**
 * CIELAB の非線形圧縮。
 *
 * ⚠ **括弧を間違えやすい最頻出箇所。** 線形側は `t / (3δ²) + 4/29` であって、
 * `(t / (3δ²) + 4) / 29` ではない。間違えても平均は小さいままなので絵は「それらしく」出る。
 */
function labF(t: number): number {
  return t > DELTA ** 3 ? Math.cbrt(t) : t / (3 * DELTA ** 2) + 4 / 29
}

export interface Lab {
  L: number
  a: number
  b: number
}

export function srgbToLab(r8: number, g8: number, b8: number): Lab {
  const r = srgbToLinear(r8)
  const g = srgbToLinear(g8)
  const b = srgbToLinear(b8)

  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b

  const fx = labF(x / WHITE_X)
  const fy = labF(y / WHITE_Y)
  const fz = labF(z / WHITE_Z)

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

// ============================================================
// CIEDE2000
// ============================================================

const DEG = 180 / Math.PI
const RAD = Math.PI / 180
const POW25_7 = 25 ** 7

/** 0..360 に畳む（`atan2` は -180..180 を返す） */
function toDegrees0To360(radians: number): number {
  const degrees = radians * DEG
  return degrees >= 0 ? degrees : degrees + 360
}

/**
 * CIEDE2000（kL = kC = kH = 1）。Sharma, Wu, Dalal (2005) の定式化に従う。
 *
 * 🔒 **テストベクタで縛ってある**（`degradation.test.ts`）。誤差 1e-3 未満（prd/05 §6）。
 */
export function ciede2000(one: Lab, two: Lab): number {
  const c1 = Math.hypot(one.a, one.b)
  const c2 = Math.hypot(two.a, two.b)
  const cBar = (c1 + c2) / 2

  const cBar7 = cBar ** 7
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW25_7)))

  const a1p = (1 + g) * one.a
  const a2p = (1 + g) * two.a
  const c1p = Math.hypot(a1p, one.b)
  const c2p = Math.hypot(a2p, two.b)

  // ⚠ a' と b が両方 0 のときの色相は 0 と定める（`atan2(0, 0)` は 0 を返すが明示する）
  const h1p = a1p === 0 && one.b === 0 ? 0 : toDegrees0To360(Math.atan2(one.b, a1p))
  const h2p = a2p === 0 && two.b === 0 ? 0 : toDegrees0To360(Math.atan2(two.b, a2p))

  const deltaLp = two.L - one.L
  const deltaCp = c2p - c1p

  // 色相差は ±180 に巻き戻す。⚠ どちらかの彩度が 0 なら色相差は定義されないので 0
  const chromaProduct = c1p * c2p
  let deltahp = 0
  if (chromaProduct !== 0) {
    const diff = h2p - h1p
    deltahp = Math.abs(diff) <= 180 ? diff : diff > 180 ? diff - 360 : diff + 360
  }
  const deltaHp = 2 * Math.sqrt(chromaProduct) * Math.sin((deltahp / 2) * RAD)

  const lBarP = (one.L + two.L) / 2
  const cBarP = (c1p + c2p) / 2

  // 平均色相も巻き戻しが要る（0°/360° をまたぐ組み合わせで 180° ずれる）
  let hBarP: number
  if (chromaProduct === 0) {
    hBarP = h1p + h2p
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2
  } else if (h1p + h2p < 360) {
    hBarP = (h1p + h2p + 360) / 2
  } else {
    hBarP = (h1p + h2p - 360) / 2
  }

  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * RAD) +
    0.24 * Math.cos(2 * hBarP * RAD) +
    0.32 * Math.cos((3 * hBarP + 6) * RAD) -
    0.2 * Math.cos((4 * hBarP - 63) * RAD)

  const deltaTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2))
  const cBarP7 = cBarP ** 7
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + POW25_7))
  const rt = -Math.sin(2 * deltaTheta * RAD) * rc

  const lBarP50 = (lBarP - 50) ** 2
  const sl = 1 + (0.015 * lBarP50) / Math.sqrt(20 + lBarP50)
  const sc = 1 + 0.045 * cBarP
  const sh = 1 + 0.015 * cBarP * t

  const termL = deltaLp / sl
  const termC = deltaCp / sc
  const termH = deltaHp / sh

  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rt * termC * termH)
}

// ============================================================
// 画像に対するマップ
// ============================================================

function assertSameShape(reference: RawImage, degraded: RawImage): void {
  if (reference.width !== degraded.width || reference.height !== degraded.height) {
    throw new RangeError('比較する 2 枚の寸法が違う（リサイズしていないか確認する）')
  }
  if (reference.channels < 3 || degraded.channels < 3) {
    throw new RangeError('channels must be at least 3 (RGB)')
  }
}

/** 画素ごとの ΔE00。長さは `width * height` */
export function de00Map(reference: RawImage, degraded: RawImage): Float32Array {
  assertSameShape(reference, degraded)
  const count = reference.width * reference.height
  const out = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const ri = i * reference.channels
    const di = i * degraded.channels
    const labReference = srgbToLab(
      reference.data[ri] ?? 0,
      reference.data[ri + 1] ?? 0,
      reference.data[ri + 2] ?? 0,
    )
    const labDegraded = srgbToLab(
      degraded.data[di] ?? 0,
      degraded.data[di + 1] ?? 0,
      degraded.data[di + 2] ?? 0,
    )
    out[i] = ciede2000(labReference, labDegraded)
  }
  return out
}

/**
 * 輝度（Rec.709）。⚠ **ガンマ符号化されたままの 8bit 値**に係数を掛ける
 * （SSIM は知覚的な明度ではなく画素値の統計を見る指標なので、線形化しない）。
 */
function luma(data: RawImage['data'], index: number): number {
  return (
    0.2126 * (data[index] ?? 0) + 0.7152 * (data[index + 1] ?? 0) + 0.0722 * (data[index + 2] ?? 0)
  )
}

const SSIM_C1 = (0.01 * 255) ** 2
const SSIM_C2 = (0.03 * 255) ** 2
/** prd/04 §4.1「輝度・8×8 箱窓」 */
const SSIM_WINDOW = 8

/** 積分画像（(w+1)×(h+1)）。矩形和を O(1) で引く */
function integral(values: Float64Array, width: number, height: number): Float64Array {
  const sums = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += values[y * width + x] ?? 0
      sums[(y + 1) * (width + 1) + (x + 1)] = (sums[y * (width + 1) + (x + 1)] ?? 0) + rowSum
    }
  }
  return sums
}

function rectSum(
  sums: Float64Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const stride = width + 1
  return (
    (sums[(y1 + 1) * stride + (x1 + 1)] ?? 0) -
    (sums[y0 * stride + (x1 + 1)] ?? 0) -
    (sums[(y1 + 1) * stride + x0] ?? 0) +
    (sums[y0 * stride + x0] ?? 0)
  )
}

/**
 * 画素ごとの SSIM（輝度・8×8 箱窓）。長さは `width * height`。
 *
 * ⚠ **SSIM は輪郭の「外側」が光る。** 窓で均されるため、コントラストのピーク画素そのものは
 * SSIM ≈ 1（無傷）になる。ΔE00 とは**別の場所を指す**（prd/04 §4.1 / measurements §8.3）。
 *
 * 端は窓を切り詰める（画像の外を 0 で埋めない。埋めると縁が常に劣化して見える）。
 */
export function ssimMap(reference: RawImage, degraded: RawImage): Float32Array {
  assertSameShape(reference, degraded)
  const { width, height } = reference
  const count = width * height

  const x = new Float64Array(count)
  const y = new Float64Array(count)
  const xx = new Float64Array(count)
  const yy = new Float64Array(count)
  const xy = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const a = luma(reference.data, i * reference.channels)
    const b = luma(degraded.data, i * degraded.channels)
    x[i] = a
    y[i] = b
    xx[i] = a * a
    yy[i] = b * b
    xy[i] = a * b
  }

  const sx = integral(x, width, height)
  const sy = integral(y, width, height)
  const sxx = integral(xx, width, height)
  const syy = integral(yy, width, height)
  const sxy = integral(xy, width, height)

  const before = Math.floor(SSIM_WINDOW / 2)
  const after = SSIM_WINDOW - before - 1
  const out = new Float32Array(count)

  for (let py = 0; py < height; py++) {
    const y0 = Math.max(0, py - before)
    const y1 = Math.min(height - 1, py + after)
    for (let px = 0; px < width; px++) {
      const x0 = Math.max(0, px - before)
      const x1 = Math.min(width - 1, px + after)
      const n = (x1 - x0 + 1) * (y1 - y0 + 1)

      const muX = rectSum(sx, width, x0, y0, x1, y1) / n
      const muY = rectSum(sy, width, x0, y0, x1, y1) / n
      const varX = rectSum(sxx, width, x0, y0, x1, y1) / n - muX * muX
      const varY = rectSum(syy, width, x0, y0, x1, y1) / n - muY * muY
      const covXY = rectSum(sxy, width, x0, y0, x1, y1) / n - muX * muY

      const numerator = (2 * muX * muY + SSIM_C1) * (2 * covXY + SSIM_C2)
      const denominator = (muX * muX + muY * muY + SSIM_C1) * (varX + varY + SSIM_C2)
      out[py * width + px] = numerator / denominator
    }
  }
  return out
}

// ============================================================
// スカラー（prd/03 §4）
// ============================================================

export interface De00Scalars {
  mean: number
  p99: number
  max: number
  /** 🔒 検証ビューの主指標。平均は集中型素材で知覚閾値を下回る（measurements §8.2） */
  over2Pct: number
}

/**
 * ⚠ **`Math.max(...array)` を使わない。** 100 万要素の TypedArray でスタックが溢れる。
 */
export function de00Scalars(map: Float32Array): De00Scalars {
  if (map.length === 0) throw new RangeError('map is empty')

  let sum = 0
  let max = 0
  let over2 = 0
  for (const value of map) {
    sum += value
    if (value > max) max = value
    if (value > 2) over2++
  }

  const sorted = Float32Array.from(map).sort()
  // 99 パーセンタイル（最近傍。要素数が少ないときも範囲に収まる）
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))

  return {
    mean: sum / map.length,
    p99: sorted[index] ?? 0,
    max,
    over2Pct: (over2 / map.length) * 100,
  }
}

// ============================================================
// オーバーレイの描画（prd/04 §4.1）
// ============================================================

export const OVERLAY_METRICS = ['de00', 'ssim'] as const
export type OverlayMetric = (typeof OVERLAY_METRICS)[number]

/**
 * 🔒 **固定スケール**（prd/04 §4.1）。素材ごとに正規化すると、条件を切り替えても
 * 見た目が変わらなくなり、比較という目的そのものが壊れる。
 */
export const OVERLAY_LIMIT: Record<OverlayMetric, number> = {
  de00: 5,
  /** 1 − SSIM の上限。TODO(spec): 知覚的な基準が無い暫定値（prd/04 §4.1） */
  ssim: 0.25,
}

/** 下地をどこまで暗く落とすか（マゼンタが読めるように） */
const BASE_GRAY_SCALE = 0.55

/**
 * 🔒 **配色・上限・合成方法の版**（prd/03 §5.3）。
 * **完成品を配る**ので、ここを変えたら全件作り直しになる。変えたら必ず上げる。
 */
export const RENDERER_VERSION = 'overlay-magenta-v1'

/**
 * 劣化オーバーレイ。JPEG 版をグレー寄りに落とし、指標値に応じてマゼンタを重ねる。
 *
 * 元画像の内容（何が壊れたか）を残しつつ、劣化の色が元の色と競合しないようにする。
 * 戻り値は RGB 3ch の生ピクセル。
 */
export function renderOverlay(
  degraded: RawImage,
  map: Float32Array,
  metric: OverlayMetric,
): Buffer {
  const count = degraded.width * degraded.height
  if (map.length !== count) {
    throw new RangeError('map の長さが画像の画素数と合わない')
  }

  const limit = OVERLAY_LIMIT[metric]
  const out = Buffer.allocUnsafe(count * 3)

  for (let i = 0; i < count; i++) {
    const source = i * degraded.channels
    const base = luma(degraded.data, source) * BASE_GRAY_SCALE

    // SSIM は「似ている度」なので、劣化量に直してから正規化する
    const value = metric === 'ssim' ? 1 - (map[i] ?? 1) : (map[i] ?? 0)
    const t = Math.min(1, Math.max(0, value / limit))

    const target = i * 3
    const magenta = base + t * (255 - base)
    out[target] = Math.round(magenta)
    out[target + 1] = Math.round(base * (1 - t))
    out[target + 2] = Math.round(magenta)
  }
  return out
}
