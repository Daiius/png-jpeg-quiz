/**
 * `quiz-core` — モード定義・出題選択・採点・得点計算・Zod スキーマ。
 *
 * 🔒 フレームワーク非依存の純関数に保つ（prd/02 §4-1）。
 * **DB も HTTP も import しない。** ここが Phase 2 の Vite + Hono 版と共有される本体になる。
 */

export { type Answer, answerFor, log2Ratio, staticDifficulty } from './difficulty.ts'
