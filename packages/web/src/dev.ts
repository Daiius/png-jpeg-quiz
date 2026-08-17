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
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return questionCount
  return Math.min(questionCount, parsed)
}
