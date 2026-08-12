import { PREPROCESS } from '@png-jpeg-quiz/quiz-core'
import sharp from 'sharp'
import { countColors, flatRatio, type RawImage } from './metrics.ts'

/**
 * 正規化（prd/05 §3 ステップ 3）。
 *
 * sRGB / 8bit / メタデータ除去 / **背景合成してからアルファ除去** / ⚠ **リサイズしない**。
 * リサイズは PNG を大きく不利にする（measurements §5）。
 */

export interface NormalizedImage {
  /** 以降のエンコードはすべてこの生ピクセルから行う（正規化を 1 度だけにする） */
  raw: RawImage
  width: number
  height: number
  colorCount: number
  flatRatio: number
  /** 原本が透過を持っていたか。合成した色は `flattenedWith` に入る */
  hadAlpha: boolean
  flattenedWith: string | null
}

export interface NormalizeOptions {
  /** `meta.json` の `preprocess.flatten`。省略時は白（prd/01 §1） */
  flatten?: string | undefined
}

export async function normalize(
  input: Buffer,
  options: NormalizeOptions = {},
): Promise<NormalizedImage> {
  const metadata = await sharp(input).metadata()
  const hadAlpha = metadata.hasAlpha === true
  const background = options.flatten ?? PREPROCESS.defaultFlatten

  const pipeline = sharp(input)
    .toColorspace('srgb')
    // メタデータは既定で落ちる（keepMetadata を呼ばない）。ICC も持ち回らない
    .flatten({ background })
    .removeAlpha()

  const { data, info } = await pipeline
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })

  const raw: RawImage = {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  }

  return {
    raw,
    width: info.width,
    height: info.height,
    colorCount: countColors(raw),
    flatRatio: flatRatio(raw),
    hadAlpha,
    // 透過が無ければ合成しても見た目は変わらないので、記録は「実際に効いたときだけ」
    flattenedWith: hadAlpha ? background : null,
  }
}

/** 正規化済みの生ピクセルを sharp に戻す（エンコードのたびに使う） */
export function toSharp(image: NormalizedImage) {
  return sharp(Buffer.from(image.raw.data), {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
}
