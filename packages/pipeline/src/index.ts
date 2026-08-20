/**
 * `pipeline` — 素材 → エンコード → 正解確定 → アセット生成（prd/05）。
 *
 * ⚠ **オフライン専用。** sharp / oxipng / mozjpeg は実行時（web）に持ち込まない（prd/02 §1）。
 */

export { type BuildOptions, type BuildSummary, build } from './build.ts'
export { binarize, duotone, inkColor, quantize, type Rgb, rec601Luma } from './derive.ts'
export { encodeDisplay, encodeForProfile, encodeJpeg, encodePng, toolVersions } from './encode.ts'
export { displayObjectKey, reserveEncodedKey } from './keys.ts'
export { countColors, flatRatio, type RawImage } from './metrics.ts'
export { type NormalizedImage, normalize } from './normalize.ts'
export { loadSources, questionIdFor, type SourceAsset } from './source.ts'
export { isPlayable, playableProfiles, recalcWinRates, winRateFor } from './win-rate.ts'
