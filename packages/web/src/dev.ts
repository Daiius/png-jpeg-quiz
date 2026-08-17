/**
 * dev / E2E 専用の口。**本番ビルドでは常に無効**（`NODE_ENV=production` で素通し）。
 *
 * `DEV_QUESTION_COUNT` はセッションの問題数を上から抑える。E2E や手元確認で
 * 「完走」を短時間で再現するためのもの（プール 19 点の practice を毎回 19 問
 * 回すのは重い。standard-30 の完走もこれで再現できる）。
 *
 * 🔒 `quiz-core` には持ち込まない。モードの定義（30 問固定の意味論）は汚さず、
 * web が受け取った結果を dev に限って丸める。
 */
export function devQuestionCount(questionCount: number): number {
  if (process.env['NODE_ENV'] === 'production') return questionCount
  const raw = process.env['DEV_QUESTION_COUNT']
  if (!raw) return questionCount
  // ⚠ parseInt は文字列全体を検証しない（'3abc' → 3、'1.5' → 1）。設定ミスは黙って
  // 受理せず無視する（OCL-9D0D4E59）。文字列全体が正の十進整数のときだけ効かせる
  if (!/^[1-9]\d*$/.test(raw)) return questionCount
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed)) return questionCount
  return Math.min(questionCount, parsed)
}
