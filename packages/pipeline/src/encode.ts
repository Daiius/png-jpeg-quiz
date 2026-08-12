import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import optimise, { init as initOxipng } from '@jsquash/oxipng/optimise.js'
import {
  answerFor,
  type EncodeProfile,
  jpegOptionsFor,
  log2Ratio,
  pngOptionsFor,
  staticDifficulty,
} from '@png-jpeg-quiz/quiz-core'
import sharp from 'sharp'
import { type NormalizedImage, toSharp } from './normalize.ts'

/**
 * エンコード（prd/05 §3 ステップ 5〜7）。
 *
 * ⚠ **`effort` を必ず明示する。** 省くと PNG が 4 倍になる（measurements §1）。
 * ⚠ **可逆パレット化は oxipng が担う。** sharp の `palette: true` は非可逆量子化なので使わない。
 */

export interface EncodedResult {
  profileId: string
  png: Buffer
  jpeg: Buffer
  pngBytes: number
  jpegBytes: number
  answer: 'png' | 'jpeg'
  log2Ratio: number
  difficulty: number
}

/**
 * ⚠ **Node では wasm を自分でロードする必要がある。**
 * @jsquash は既定で `fetch(new URL('...wasm', import.meta.url))` を試みるが、
 * Node の fetch は `file:` スキームを実装していないので `not implemented... yet...` で落ちる。
 */
let oxipngReady: Promise<void> | undefined

async function ensureOxipng(): Promise<void> {
  oxipngReady ??= (async () => {
    const require = createRequire(import.meta.url)
    const wasmPath = require.resolve('@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm')
    // BufferSource をそのまま渡す（WebAssembly.compile は lib.dom 由来で Node の型に無い）
    await initOxipng(await readFile(wasmPath))
  })()
  await oxipngReady
}

export async function encodePng(image: NormalizedImage, profile: EncodeProfile): Promise<Buffer> {
  const options = pngOptionsFor(profile)
  const png = await toSharp(image)
    .png({ compressionLevel: options.compressionLevel, effort: options.effort })
    .toBuffer()

  if (!options.oxipng) return png

  await ensureOxipng()
  // ArrayBuffer を渡す（Buffer の backing store をそのまま渡すと隣の領域まで巻き込む）
  const source = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
  const optimized = await optimise(source, {
    level: options.oxipng.level,
    interlace: false,
    optimiseAlpha: false,
  })
  return Buffer.from(optimized)
}

export async function encodeJpeg(image: NormalizedImage, profile: EncodeProfile): Promise<Buffer> {
  const options = jpegOptionsFor(profile)
  return await toSharp(image)
    .jpeg({
      quality: options.quality,
      chromaSubsampling: options.chromaSubsampling,
      progressive: options.progressive,
      mozjpeg: options.mozjpeg,
    })
    .toBuffer()
}

/**
 * 1 プロファイル分のエンコードと判定。
 *
 * 🔒 **同点は問題にしない**（prd/01 §1）。呼び出し側で `null` を除外する。
 */
export async function encodeForProfile(
  image: NormalizedImage,
  profile: EncodeProfile,
): Promise<EncodedResult | null> {
  const [png, jpeg] = await Promise.all([encodePng(image, profile), encodeJpeg(image, profile)])
  const answer = answerFor(png.byteLength, jpeg.byteLength)
  if (!answer) return null

  const ratio = log2Ratio(png.byteLength, jpeg.byteLength)
  return {
    profileId: profile.id,
    png,
    jpeg,
    pngBytes: png.byteLength,
    jpegBytes: jpeg.byteLength,
    answer,
    log2Ratio: ratio,
    difficulty: staticDifficulty(ratio),
  }
}

/**
 * 出題画像（prd/04 §3.1）。
 * 🔒 **可逆 WebP。PNG を display にしてはいけない**（`png_bytes` がそのまま見える）。
 */
export async function encodeDisplay(image: NormalizedImage): Promise<Buffer> {
  return await toSharp(image).webp({ lossless: true, effort: 6 }).toBuffer()
}

/**
 * `encode_profile.tool_versions` に記録する（版が変われば問題を作り直す。prd/01 §3.3）。
 *
 * ⚠ `require('sharp/package.json')` は使えない（sharp の `exports` に無い）。
 * `sharp.versions` に sharp 自身とバンドルされた各ライブラリの版が入っている。
 */
export function toolVersions(): Record<string, string> {
  const versions = sharp.versions as unknown as Record<string, string | undefined>
  const require = createRequire(import.meta.url)
  const oxipngPackage = require('@jsquash/oxipng/package.json') as { version: string }
  return {
    sharp: versions['sharp'] ?? 'unknown',
    libvips: versions['vips'] ?? 'unknown',
    mozjpeg: versions['mozjpeg'] ?? 'unknown',
    webp: versions['webp'] ?? 'unknown',
    zlib: versions['zlib-ng'] ?? 'unknown',
    oxipng: `@jsquash/oxipng@${oxipngPackage.version}`,
  }
}
