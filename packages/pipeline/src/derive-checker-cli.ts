import { strict as assert } from 'node:assert'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { duotone, inkColor, rec601Luma } from './derive.ts'
import {
  assertKnownSource,
  CLEAN_META,
  checkerSvg,
  EXPECTED,
  INK,
  PAPER,
  SNAP_THRESHOLD,
  toHex,
} from './derive-checker-meta.ts'
import { encodeAssetPng, rasterizeSvg, sha256, writeAsset } from './derive-io.ts'
import { countColors, flatRatio, type RawImage } from './metrics.ts'
import { normalize } from './normalize.ts'

/**
 * `ai-pattern-checker`（312x197・AI 生成の市松パターン）から
 * **クリーン 2 色版**をつくる CLI（prd/05 §4）。
 *
 * 原本は白と青のベタに見えて画素ノイズを持つ（相異なる色が 5000 以上ある）。
 * その格子配置と青の代表色だけを写し取り、**SVG から新規に描き直して 2 色に固定**する。
 * ⚠ **原本は差し替えない。** ノイズ有りの 1 枚は意地悪問題としてそのまま残し、対で見せる。
 *
 * 使い方:
 *   pnpm --filter @png-jpeg-quiz/pipeline derive:checker [sourcePath] [outDir]
 *   （省略時はリポジトリルートの assets/source/ai-pattern-checker.png → assets/source/）
 *
 * 🔒 **ai-pattern-checker.png 専用。** 格子座標もインク色もこの 1 枚の実測値なので、
 * 入力の SHA-256 が既知の原本と一致しなければ中断する（`SOURCE_SHA256`）。
 *
 * 🔒 **決定的。** 乱数・ディザなし。同じ入力 + 同じ sharp 版なら再実行で同一バイトになる。
 * 正解（PNG か JPEG か）はここでは決めない — `pnpm quiz:build` の実測が決める。
 */

/** 輝度が閾値未満の画素の割合。原本と再描画版で青マスの被覆が一致しているかの検査に使う */
function inkRatio(image: RawImage, threshold: number): number {
  const { data, width, height, channels } = image
  let dark = 0
  for (let i = 0; i < width * height; i++) {
    const index = i * channels
    if (rec601Luma(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0) < threshold) dark++
  }
  return dark / (width * height)
}

/** 画像に現れる相異なる色を `#rrggbb` の昇順で挙げる（「ちょうどこの 2 色」の検査に使う） */
function paletteHex(image: RawImage): string[] {
  const { data, width, height, channels } = image
  const seen = new Set<string>()
  for (let i = 0; i < width * height; i++) {
    const index = i * channels
    seen.add(toHex([data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0]))
  }
  return [...seen].sort()
}

async function main(argv: string[]): Promise<void> {
  // 既定パスはリポジトリルート基準（pnpm --filter は cwd をパッケージ側に変えるため、cwd に依存しない）
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  const sourcePath = argv[0] ?? path.join(repoRoot, 'assets', 'source', 'ai-pattern-checker.png')
  const outDir = argv[1] ?? path.join(repoRoot, 'assets', 'source')

  // 🔒 格子座標もインク色もこの 1 枚の実測値なので、**原本そのものかを内容で確かめる**（prd/05 §1）。
  // ⚠ 出力先を作る前に確かめる（別画像に対して走らせたとき、痕跡を残さず止める）
  const sourceBytes = await readFile(sourcePath)
  assertKnownSource(sha256(sourceBytes), sourcePath)
  await mkdir(outDir, { recursive: true })

  const original = await normalize(sourceBytes)
  assert.equal(original.width, EXPECTED.width, `source width must be ${EXPECTED.width}`)
  assert.equal(original.height, EXPECTED.height, `source height must be ${EXPECTED.height}`)

  // インク色は毎回測り直し、meta が書き出す値と一致することを確かめる
  // （記述を実測に縛る。ずれたら「原本の青」を名乗れない）
  const measuredInk = inkColor(original.raw, SNAP_THRESHOLD)
  assert.deepEqual(
    [...measuredInk],
    [...INK],
    `ink color drifted: measured=${toHex(measuredInk)} declared=${toHex(INK)}`,
  )

  const rendered = await rasterizeSvg(checkerSvg(INK))
  assert.equal(rendered.width, EXPECTED.width, 'SVG raster width mismatch')
  assert.equal(rendered.height, EXPECTED.height, 'SVG raster height mismatch')

  const clean = duotone(rendered, INK, PAPER, SNAP_THRESHOLD)

  // 検証 1: ちょうど 2 色で、その 2 色が宣言どおりの白と青（中間色を 1 画素も残さない）
  const cleanColors = countColors(clean)
  assert.equal(cleanColors, 2, `clean image must have exactly 2 colors, got ${cleanColors}`)
  assert.deepEqual(
    paletteHex(clean),
    [toHex(INK), toHex(PAPER)].sort(),
    'clean image must use exactly the declared ink and paper',
  )

  // 検証 2: 青マスの被覆が原本とほぼ一致（格子の写し取りがずれていないこと。差が 2% 未満）
  const originalInk = inkRatio(original.raw, SNAP_THRESHOLD)
  const cleanInk = inkRatio(clean, SNAP_THRESHOLD)
  assert.ok(
    Math.abs(cleanInk - originalInk) < 0.02,
    `ink ratio drifted: original=${originalInk.toFixed(4)} clean=${cleanInk.toFixed(4)}`,
  )

  const cleanPng = await encodeAssetPng(clean)
  await writeAsset(outDir, 'ai-pattern-checker-clean', cleanPng, CLEAN_META)

  // --- 報告 --------------------------------------------------------------
  const report = [
    ['ai-pattern-checker', original.colorCount, original.flatRatio, originalInk],
    ['ai-pattern-checker-clean', cleanColors, flatRatio(clean), cleanInk],
  ] as const
  for (const [name, colorCount, flat, ink] of report) {
    console.log(
      `${String(name).padEnd(26)} colors=${String(colorCount).padStart(5)}  flat_ratio=${flat.toFixed(4)}  ink_ratio=${ink.toFixed(4)}`,
    )
  }
  console.log(
    `ink=${toHex(INK)}  paper=${toHex(PAPER)}  snap_threshold=${SNAP_THRESHOLD.toFixed(2)}`,
  )
  console.log(
    `ai-pattern-checker-clean.png  ${cleanPng.byteLength} bytes  sha256=${sha256(cleanPng)}`,
  )
  console.log(`written to ${path.resolve(outDir)}`)
}

await main(process.argv.slice(2))
