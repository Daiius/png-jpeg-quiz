import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { RawImage } from './metrics.ts'

/**
 * 派生素材 CLI（`derive-*-cli.ts`）が共有する入出力（prd/05 §4）。
 *
 * **加工そのものは `derive.ts` の純関数**にあり、ここは sharp / fs に触れる薄い層だけを置く。
 * CLI 本体は import しただけで実行されるので、複数の CLI から使う道具はこちら側に分ける。
 */

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * 入力が既知の原本かを確かめる。**一致しなければ派生素材を作らせない。**
 *
 * 🔒 派生素材の出典・作者・ライセンスは**原本 1 枚に対する事実**であって、入力から導いた値ではない。
 * 寸法しか見ずに通すと、同寸の別画像や差し替わった既定ファイルに他人の来歴が付いたまま
 * DB と回答後表示へ流れる（prd/05 §1: 出典・作者・ライセンスが取れる素材だけ採用する）。
 */
export function assertKnownSource(
  actual: string,
  expected: string,
  sourcePath: string,
  assetName: string,
): void {
  if (actual === expected) return
  throw new Error(
    [
      `入力が既知の ${assetName} ではないので中断する: ${sourcePath}`,
      `  expected sha256=${expected}`,
      `  actual   sha256=${actual}`,
      `  この CLI は ${assetName} 専用で、出典・ライセンスを固定で書き出す（prd/05 §1）。`,
    ].join('\n'),
  )
}

/**
 * SVG を**原寸で**ラスタライズして RGB 3ch の生ピクセルにする。
 * ⚠ リサイズしない（measurements §5）。`width` / `height` は SVG 側で決める。
 */
export async function rasterizeSvg(svg: string): Promise<RawImage> {
  const { data, info } = await sharp(Buffer.from(svg))
    .toColorspace('srgb')
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/**
 * 派生素材そのものを PNG で書き出す（`assets/source/` に置く原本相当の 1 枚）。
 * ⚠ `effort` を必ず明示する（省くと 4 倍になる。AGENTS.md / measurements §1）。
 */
export async function encodeAssetPng(image: RawImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer()
}

/** 派生素材の PNG と `meta.json` を対で書き出す（meta の無い素材は build が採用しない） */
export async function writeAsset(
  outDir: string,
  name: string,
  png: Buffer,
  meta: unknown,
): Promise<void> {
  await writeFile(path.join(outDir, `${name}.png`), png)
  await writeFile(path.join(outDir, `${name}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`)
}
