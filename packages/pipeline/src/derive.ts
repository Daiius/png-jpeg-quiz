import type { RawImage } from './metrics.ts'

/**
 * 素材の派生加工（prd/05 §4「際どい問題の合成」の素材づくり）。
 *
 * ここは **sharp に依存しない純関数**にしておく（metrics.ts と同じ流儀）。
 * 入力は正規化済みの生ピクセル、出力は常に **RGB 3ch** の新しいバッファ。
 *
 * 🔒 **すべて決定的。** 乱数もディザも使わない。同じ入力からは常に同じバイト列が出る
 * （ディザは隣接画素をわざと散らすので、減色で狙う「ゆらぎの丸め」を打ち消す。prd/05 §4）。
 */

interface Box {
  /** このボックスに属する相異なる色（0xRRGGBB） */
  colors: number[]
  /** colors と同順の出現画素数 */
  counts: number[]
  population: number
}

/** 0xRRGGBB からチャンネル値を取り出す（0=R, 1=G, 2=B） */
function channelOf(color: number, channel: number): number {
  return (color >> ((2 - channel) * 8)) & 0xff
}

/** ボックス内で最も値域が広いチャンネルとその幅。分割対象の選定に使う */
function widestChannel(box: Box): { channel: number; range: number } {
  let bestChannel = 0
  let bestRange = -1
  for (let channel = 0; channel < 3; channel++) {
    let min = 255
    let max = 0
    for (const color of box.colors) {
      const value = channelOf(color, channel)
      if (value < min) min = value
      if (value > max) max = value
    }
    const range = max - min
    if (range > bestRange) {
      bestChannel = channel
      bestRange = range
    }
  }
  return { channel: bestChannel, range: bestRange }
}

/** 出現数の中央値でボックスを 2 分する。ソート順が完全に決まるので分割も決定的 */
function splitBox(box: Box): [Box, Box] {
  const { channel } = widestChannel(box)
  const order = box.colors
    .map((_, index) => index)
    .sort((a, b) => {
      const colorA = box.colors[a] ?? 0
      const colorB = box.colors[b] ?? 0
      const byChannel = channelOf(colorA, channel) - channelOf(colorB, channel)
      // 同値は色そのもので順序を固定する（比較器の安定性に頼らない）
      return byChannel !== 0 ? byChannel : colorA - colorB
    })

  const half = box.population / 2
  let cumulative = 0
  let cut = 1
  for (let i = 0; i < order.length - 1; i++) {
    cumulative += box.counts[order[i] ?? 0] ?? 0
    cut = i + 1
    if (cumulative >= half) break
  }

  const make = (indices: number[]): Box => ({
    colors: indices.map((i) => box.colors[i] ?? 0),
    counts: indices.map((i) => box.counts[i] ?? 0),
    population: indices.reduce((sum, i) => sum + (box.counts[i] ?? 0), 0),
  })
  return [make(order.slice(0, cut)), make(order.slice(cut))]
}

/** ボックスの代表色 = 出現数で重み付けした平均（四捨五入） */
function representative(box: Box): number {
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < box.colors.length; i++) {
    const color = box.colors[i] ?? 0
    const count = box.counts[i] ?? 0
    r += channelOf(color, 0) * count
    g += channelOf(color, 1) * count
    b += channelOf(color, 2) * count
  }
  const n = Math.max(box.population, 1)
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)
}

/**
 * メディアンカットによる減色（ディザなし・決定的）。
 *
 * ⚠ これは**意図した非可逆加工**であり、エンコード工程の可逆パレット化
 * （oxipng が担う。prd/01 §3.3）とは別物。sharp の `palette: true`（libimagequant）は
 * 使わない — 内部実装の再現性を自前で保証できないため、決定性をアルゴリズムごと持つ。
 */
export function quantize(image: RawImage, maxColors: number): RawImage {
  if (!Number.isInteger(maxColors) || maxColors < 2) {
    throw new RangeError('maxColors must be an integer >= 2')
  }
  const { data, width, height, channels } = image
  const pixels = width * height

  // 出現色を数える（キーは 0xRRGGBB）
  const histogram = new Map<number, number>()
  for (let i = 0; i < pixels; i++) {
    const index = i * channels
    const key = ((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0)
    histogram.set(key, (histogram.get(key) ?? 0) + 1)
  }

  // Map の列挙順は挿入順（＝走査順）なので決定的だが、入力順への依存を断つため色値で整列する
  const colors = [...histogram.keys()].sort((a, b) => a - b)
  const counts = colors.map((color) => histogram.get(color) ?? 0)

  let boxes: Box[] = [{ colors, counts, population: pixels }]
  while (boxes.length < maxColors) {
    // 最も値域の広いボックスを割る。同率は population 大 → 先頭寄りで固定
    let target = -1
    let targetRange = 0
    let targetPopulation = 0
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box === undefined || box.colors.length < 2) continue
      const { range } = widestChannel(box)
      if (range > targetRange || (range === targetRange && box.population > targetPopulation)) {
        target = i
        targetRange = range
        targetPopulation = box.population
      }
    }
    const targetBox = target >= 0 ? boxes[target] : undefined
    if (targetBox === undefined) break // 全ボックスが単色 = もう割れない
    const [left, right] = splitBox(targetBox)
    boxes = [...boxes.slice(0, target), left, right, ...boxes.slice(target + 1)]
  }

  const palette = boxes.map(representative)

  // 各出現色を最近傍の代表色へ（同距離は先頭のパレット index で固定）
  const lookup = new Map<number, number>()
  for (const color of colors) {
    let bestColor = palette[0] ?? 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of palette) {
      const dr = channelOf(color, 0) - channelOf(candidate, 0)
      const dg = channelOf(color, 1) - channelOf(candidate, 1)
      const db = channelOf(color, 2) - channelOf(candidate, 2)
      const distance = dr * dr + dg * dg + db * db
      if (distance < bestDistance) {
        bestDistance = distance
        bestColor = candidate
      }
    }
    lookup.set(color, bestColor)
  }

  const out = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    const index = i * channels
    const key = ((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0)
    const mapped = lookup.get(key) ?? 0
    out[i * 3] = (mapped >> 16) & 0xff
    out[i * 3 + 1] = (mapped >> 8) & 0xff
    out[i * 3 + 2] = mapped & 0xff
  }
  return { data: out, width, height, channels: 3 }
}

/** RGB 3 チャンネルの色（各 0..255）。2 色スナップのパレット指定に使う */
export type Rgb = readonly [number, number, number]

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]

/** Rec.601 の整数近似による輝度（決定的。浮動小数の係数を持ち回らない） */
export function rec601Luma(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000
}

/**
 * **2 色へのスナップ。** ラスタライズで出たアンチエイリアスの中間色を、輝度の閾値で
 * `ink`（暗い側）か `paper`（明るい側）のどちらかに落とす。
 *
 * 🔒 **中間色を 1 画素も残さない。** 出力のユニーク色数は必ず 2 以下になる
 * （縁に中間色が 1 画素でも残ると、そこだけノイズ源になって「真にフラット」でなくなる）。
 */
export function duotone(image: RawImage, ink: Rgb, paper: Rgb, threshold = 128): RawImage {
  const { data, width, height, channels } = image
  const pixels = width * height
  const out = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    const index = i * channels
    const source =
      rec601Luma(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0) < threshold
        ? ink
        : paper
    out[i * 3] = source[0]
    out[i * 3 + 1] = source[1]
    out[i * 3 + 2] = source[2]
  }
  return { data: out, width, height, channels: 3 }
}

/**
 * 白黒 2 値へのスナップ。ラスタライズで出たアンチエイリアスの中間色を
 * **純黒 (0,0,0) / 純白 (255,255,255)** のどちらかに落とす（`duotone` の白黒版）。
 */
export function binarize(image: RawImage, threshold = 128): RawImage {
  return duotone(image, BLACK, WHITE, threshold)
}

/**
 * 暗部（輝度 < `threshold`）の**代表色** — チャンネルごとの中央値。
 * 元画像のベタ塗り部分の色を 1 色に決めるのに使う（再描画版のインク色）。
 *
 * 平均ではなく中央値なのは、**縁のアンチエイリアスと AI 生成の画素ノイズに引きずられない**ため。
 * ⚠ チャンネルごとに取るので、返る色は元画像に実在する画素とは限らない
 * （狙いは「ベタ塗りの代表値」であって、実在画素の抽出ではない）。
 */
export function inkColor(image: RawImage, threshold = 128): Rgb {
  const { data, width, height, channels } = image
  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  for (let i = 0; i < width * height; i++) {
    const index = i * channels
    const r = data[index] ?? 0
    const g = data[index + 1] ?? 0
    const b = data[index + 2] ?? 0
    if (rec601Luma(r, g, b) >= threshold) continue
    reds.push(r)
    greens.push(g)
    blues.push(b)
  }
  if (reds.length === 0) {
    throw new RangeError(`no pixel darker than luma ${threshold}`)
  }
  const median = (values: number[]): number => {
    values.sort((a, b) => a - b)
    return values[values.length >> 1] ?? 0
  }
  return [median(reds), median(greens), median(blues)]
}
