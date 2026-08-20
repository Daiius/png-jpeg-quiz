import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { binarize, quantize } from './derive.ts'
import { countColors, flatRatio, type RawImage } from './metrics.ts'
import { normalize } from './normalize.ts'

/**
 * `ai-geometric`（334x223・AI 生成の幾何学図形）から派生素材を 2 種つくる CLI。
 *
 * 1. **16 色減色版** — 減色してもまだ JPEG が勝つかを見る（prd/05 §4: 16 色で初めて効く）
 * 2. **クリーン 2 色版** — 元画像と同じ見た目を SVG から再描画した、ノイズゼロの白黒 2 色。
 *    真にフラットなら PNG が勝つことを対で見せる
 *
 * 使い方:
 *   pnpm --filter @png-jpeg-quiz/pipeline derive:geometric [sourcePath] [outDir]
 *   （省略時はリポジトリルートの assets/source/ai-geometric.png → assets/source/）
 *
 * 🔒 **決定的。** 乱数・ディザなし。同じ入力 + 同じ sharp 版なら再実行で同一バイトになる。
 * 正解（PNG か JPEG か）はここでは決めない — `pnpm quiz:build` の実測が決める。
 */

const EXPECTED = { width: 334, height: 223 } as const
const QUANT_COLORS = 16

/**
 * 元画像の図形配置の実測値（画素座標。目視 + 連結成分の bbox 計測）。
 * - 正方形: x 20..84, y 24..87 / 円: bbox x 117..182, y 23..88（中心 149.5, 55.5・半径 33）
 * - 三角形: 頂点 (245, 24)・底辺 y 86 の x 210..280
 * - 横線 3 本: x 20..282, 太さ 8 / 6 / 2（y 121 / 157 / 192 開始）
 */
const CLEAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${EXPECTED.width}" height="${EXPECTED.height}" viewBox="0 0 ${EXPECTED.width} ${EXPECTED.height}">
  <rect width="${EXPECTED.width}" height="${EXPECTED.height}" fill="#ffffff"/>
  <g fill="#000000">
    <rect x="20" y="24" width="65" height="64"/>
    <circle cx="149.7" cy="55.7" r="33"/>
    <polygon points="245.5,23.6 281,87 210,87"/>
    <rect x="20" y="121" width="263" height="8"/>
    <rect x="20" y="157" width="263" height="6"/>
    <rect x="20" y="192" width="263" height="2"/>
  </g>
</svg>`

/** PNG 書き出し。⚠ `effort` を必ず明示する（省くと 4 倍になる。AGENTS.md / measurements §1） */
async function encodePng(image: RawImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer()
}

function whiteRatio(image: RawImage): number {
  const { data, width, height, channels } = image
  let white = 0
  for (let i = 0; i < width * height; i++) {
    const index = i * channels
    if (
      (data[index] ?? 0) === 255 &&
      (data[index + 1] ?? 0) === 255 &&
      (data[index + 2] ?? 0) === 255
    )
      white++
  }
  return white / (width * height)
}

/** 明部（輝度 128 以上）の割合。元画像とクリーン版で図形の被覆が一致しているかの検査に使う */
function lightRatio(image: RawImage): number {
  const { data, width, height, channels } = image
  let light = 0
  for (let i = 0; i < width * height; i++) {
    const index = i * channels
    const luma =
      ((data[index] ?? 0) * 299 + (data[index + 1] ?? 0) * 587 + (data[index + 2] ?? 0) * 114) /
      1000
    if (luma >= 128) light++
  }
  return light / (width * height)
}

const QUANT_META = {
  source: {
    site: 'OpenAI ChatGPT（画像生成）',
    author: 'Daiius（生成・提供）',
    license: 'OpenAI 出力（生成者に権利帰属）',
    license_note:
      'OpenAI ChatGPT で生成した ai-geometric.png を 16 色に減色した派生素材。利用規約により出力の権利は生成者に譲渡され、再配布・商用利用が認められている。⚠ 日本法では創作的寄与が乏しく著作物性は認められない可能性が高いが、配布の妨げにはならない。🔒 AI 生成である旨は回答後の画面とクレジット一覧でのみ開示する（出題前に出すと T7 の漏洩になる）。確認日 2026-08-14。',
    retrieved: '2026-08-13',
    shared_via: 'clip.faveo-systema.net',
    derived_from: 'ai-geometric.png（334x223）を 16 色に減色（メディアンカット・ディザなし）',
    license_url: 'https://openai.com/policies/row-terms-of-use/',
  },
  category: 'illustration',
  tags: ['flat', 'shape', 'edge', 'ai-noise', 'quantized'],
  is_ai_generated: true,
  derivation: {
    op: 'quantize',
    source: 'ai-geometric',
    colors: QUANT_COLORS,
    method: 'median-cut（ディザなし・決定的）',
    script: 'packages/pipeline/src/derive-geometric-cli.ts',
    note: 'AI 生成由来の画素ノイズを 16 色へ丸める。「減色してもまだ JPEG が勝つか」を元画像・クリーン 2 色版と対で見せる意地悪問題ペアの素材（prd/05 §4）',
  },
  note: '幾何学図形・ライン（ai-geometric の 16 色減色版）',
  caution:
    '⚠ 減色後もアンチエイリアスぶんの中間色は残る。正解はパイプラインの実測で決める（断定しない）',
} as const

const CLEAN_META = {
  source: {
    site: '自作（本リポジトリの生成スクリプト）',
    author: 'Daiius（作成）',
    license: '自作（権利者が本プロジェクトでの利用・再配布を許諾）',
    license_note:
      'ai-geometric.png（AI 生成）の図形配置を目視・座標計測で写し取り、SVG から新規に描画した自作素材。画素は SVG のラスタライズ + 白黒 2 値化で生成しており、AI 出力のピクセルは一切含まない。構図の参照元が AI 生成であることは回答後の解説で開示する。',
    derived_from:
      'ai-geometric.png を参照した自作再描画（純白背景 + 単色黒、2 色のみ）。同寸 334x223',
  },
  category: 'illustration',
  tags: ['flat', 'shape', 'edge', 'clean'],
  is_ai_generated: false,
  derivation: {
    op: 'redraw',
    source: 'ai-geometric',
    colors: 2,
    method: 'SVG ラスタライズ + 白黒 2 値化（アンチエイリアスの中間色を除去）',
    script: 'packages/pipeline/src/derive-geometric-cli.ts',
    note: '見た目は元画像と同じだがノイズゼロ。「真にフラットなら PNG が勝つ」を元画像・16 色減色版と対で見せる意地悪問題ペアの素材（prd/05 §4）',
  },
  note: '幾何学図形・ライン（ai-geometric のクリーン 2 色再描画版）',
  caution: '⚠ 正解はパイプラインの実測で決める（断定しない）',
} as const

async function writeAsset(outDir: string, name: string, png: Buffer, meta: unknown): Promise<void> {
  await writeFile(path.join(outDir, `${name}.png`), png)
  await writeFile(path.join(outDir, `${name}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`)
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function main(argv: string[]): Promise<void> {
  // 既定パスはリポジトリルート基準（pnpm --filter は cwd をパッケージ側に変えるため、cwd に依存しない）
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  const sourcePath = argv[0] ?? path.join(repoRoot, 'assets', 'source', 'ai-geometric.png')
  const outDir = argv[1] ?? path.join(repoRoot, 'assets', 'source')
  await mkdir(outDir, { recursive: true })

  const original = await normalize(await readFile(sourcePath))
  assert.equal(original.width, EXPECTED.width, `source width must be ${EXPECTED.width}`)
  assert.equal(original.height, EXPECTED.height, `source height must be ${EXPECTED.height}`)

  // --- 1. 16 色減色版 ---------------------------------------------------
  const quantized = quantize(original.raw, QUANT_COLORS)
  const quantColors = countColors(quantized)
  assert.ok(quantColors <= QUANT_COLORS, `quantized colors ${quantColors} > ${QUANT_COLORS}`)
  assert.equal(quantized.width, EXPECTED.width)
  assert.equal(quantized.height, EXPECTED.height)
  const quantPng = await encodePng(quantized)
  await writeAsset(outDir, 'ai-geometric-16', quantPng, QUANT_META)

  // --- 2. クリーン 2 色版（SVG 再描画） ----------------------------------
  const rendered = await sharp(Buffer.from(CLEAN_SVG))
    .toColorspace('srgb')
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })
  assert.equal(rendered.info.width, EXPECTED.width, 'SVG raster width mismatch')
  assert.equal(rendered.info.height, EXPECTED.height, 'SVG raster height mismatch')

  const clean = binarize({
    data: rendered.data,
    width: rendered.info.width,
    height: rendered.info.height,
    channels: rendered.info.channels,
  })

  // 検証: ちょうど 2 色（純黒 / 純白）で、背景は純白ベタ
  const cleanColors = countColors(clean)
  assert.equal(cleanColors, 2, `clean image must have exactly 2 colors, got ${cleanColors}`)
  const cleanWhite = whiteRatio(clean)
  const cleanLight = lightRatio(clean)
  assert.equal(cleanWhite, cleanLight, 'every non-black pixel must be pure white')
  // 図形の被覆が元画像とほぼ一致すること（明部の割合の差が 2% 未満）
  const originalLight = lightRatio(original.raw)
  assert.ok(
    Math.abs(cleanLight - originalLight) < 0.02,
    `light ratio drifted: original=${originalLight.toFixed(4)} clean=${cleanLight.toFixed(4)}`,
  )
  const cleanPng = await encodePng(clean)
  await writeAsset(outDir, 'ai-geometric-clean', cleanPng, CLEAN_META)

  // --- 報告 --------------------------------------------------------------
  const report = [
    ['original', original.colorCount, original.flatRatio, lightRatio(original.raw)],
    ['ai-geometric-16', quantColors, flatRatio(quantized), lightRatio(quantized)],
    ['ai-geometric-clean', cleanColors, flatRatio(clean), cleanLight],
  ] as const
  for (const [name, colorCount, flat, light] of report) {
    console.log(
      `${String(name).padEnd(20)} colors=${String(colorCount).padStart(4)}  flat_ratio=${flat.toFixed(4)}  light_ratio=${light.toFixed(4)}`,
    )
  }
  console.log(`ai-geometric-16.png     ${quantPng.byteLength} bytes  sha256=${sha256(quantPng)}`)
  console.log(`ai-geometric-clean.png  ${cleanPng.byteLength} bytes  sha256=${sha256(cleanPng)}`)
  console.log(`written to ${path.resolve(outDir)}`)
}

await main(process.argv.slice(2))
