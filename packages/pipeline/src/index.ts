/**
 * `pipeline` — 素材 → エンコード → 正解確定 → アセット生成（prd/05）。
 *
 * ⚠ **オフライン専用。** sharp / oxipng / mozjpeg は実行時（web）に持ち込まない（prd/02 §1）。
 * 取り込み・正規化・20 プロファイルのエンコード・キー予約は M1 で足す。
 */

export { countColors, flatRatio, type RawImage } from './metrics.ts'
