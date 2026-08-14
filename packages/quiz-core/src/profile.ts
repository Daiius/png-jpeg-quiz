import { z } from 'zod'

/**
 * エンコードプロファイル（prd/01 §3）。
 *
 * ID の命名は 20 個すべて同じ規則: `q<品質>-<サブサンプリング>-<png最適化>-v<版>`。
 * 🔒 標準だけ別名を持たせない（`std-v1` のようなエイリアスは作らない。prd/01 §3.1）。
 */

export const JPEG_QUALITIES = [60, 75, 80, 90, 95] as const
export const CHROMA_SUBSAMPLINGS = ['4:2:0', '4:4:4'] as const

export type JpegQuality = (typeof JPEG_QUALITIES)[number]
export type ChromaSubsampling = (typeof CHROMA_SUBSAMPLINGS)[number]

/**
 * ID の中でサブサンプリングを表す短縮形。
 * TODO(spec): PNG 最適化なしの短縮形 `raw` は prd に例が無いので暫定。
 */
const SUBSAMPLING_SLUG: Record<ChromaSubsampling, string> = {
  '4:2:0': '420',
  '4:4:4': '444',
}

export const PROFILE_VERSION = 1

export const profileIdSchema = z
  .string()
  .regex(/^q(60|75|80|90|95)-(420|444)-(oxi|raw)-v\d+$/, 'プロファイル ID の形式が違う')

export type ProfileId = z.infer<typeof profileIdSchema>

export interface EncodeProfile {
  id: ProfileId
  jpegQuality: JpegQuality
  chromaSubsampling: ChromaSubsampling
  /** oxipng `-o4` をかけるか（prd/01 §3.2） */
  pngOptimize: boolean
  isStandard: boolean
  publishedLabel: string
}

export function buildProfileId(
  jpegQuality: JpegQuality,
  chromaSubsampling: ChromaSubsampling,
  pngOptimize: boolean,
  version: number = PROFILE_VERSION,
): ProfileId {
  return `q${jpegQuality}-${SUBSAMPLING_SLUG[chromaSubsampling]}-${pngOptimize ? 'oxi' : 'raw'}-v${version}`
}

/**
 * サイトの既定であり、ランキングの基準（prd/01 §3.1）。
 *
 * **PNG・JPEG の両方を最高品質側に振った条件**。PNG は可逆なので常に画質最高で、
 * `oxi` あり（oxipng -o4）は画質を落とさずサイズだけを詰める。JPEG は q95 / 4:4:4。
 * 校正母集団を 6 通り変えても 4:4:4 の高品質側が選ばれる（prd/_grilling/measurements §7）。
 */
export const STANDARD_PROFILE_ID = buildProfileId(95, '4:4:4', true)

/**
 * 選択できる 20 プロファイル（5 品質 × 2 サブサンプリング × PNG 最適化の有無）。
 * **順序は決定的**にしておく（seed の冪等性のため）。
 */
export const ENCODE_PROFILES: readonly EncodeProfile[] = JPEG_QUALITIES.flatMap((jpegQuality) =>
  CHROMA_SUBSAMPLINGS.flatMap((chromaSubsampling) =>
    [true, false].map((pngOptimize): EncodeProfile => {
      const id = buildProfileId(jpegQuality, chromaSubsampling, pngOptimize)
      return {
        id,
        jpegQuality,
        chromaSubsampling,
        pngOptimize,
        isStandard: id === STANDARD_PROFILE_ID,
        publishedLabel: `JPEG 品質 ${jpegQuality} / ${chromaSubsampling} / PNG 最適化${
          pngOptimize ? 'あり（oxipng -o4）' : 'なし（sharp のみ）'
        }`,
      }
    }),
  ),
)

export function findProfile(id: string): EncodeProfile | undefined {
  return ENCODE_PROFILES.find((profile) => profile.id === id)
}

/**
 * 全プロファイル共通の前処理（prd/01 §3.1）。
 * ⚠ **リサイズはしない**。縮小は PNG を大きく不利にする（measurements §5）。
 * 背景色は素材ごとに `meta.json` の `preprocess.flatten` で上書きする。
 */
export const PREPROCESS = {
  colorspace: 'srgb',
  depth: 8,
  stripMetadata: true,
  defaultFlatten: '#ffffff',
  resize: false,
} as const

/**
 * ⚠ **`effort` を必ず明示する。** 省くと 4 倍のサイズになり、
 * `palette: false` を明示すると `effort` が無視される（measurements §1）。
 * 可逆パレット化は oxipng が担うので、sharp では `palette` を触らない。
 */
export function pngOptionsFor(profile: EncodeProfile) {
  return {
    compressionLevel: 9,
    effort: 10,
    oxipng: profile.pngOptimize ? { level: 4 } : null,
  } as const
}

export function jpegOptionsFor(profile: EncodeProfile) {
  return {
    quality: profile.jpegQuality,
    chromaSubsampling: profile.chromaSubsampling,
    progressive: true,
    mozjpeg: true,
  } as const
}
