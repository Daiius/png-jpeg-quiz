import { NextResponse } from 'next/server'
import { serveNextQuestion } from '@/quiz-service.ts'
import { authenticateSession } from '@/session.ts'

export const dynamic = 'force-dynamic'

/**
 * 現在の問題（prd/02 §4-2）。
 *
 * 🔒 返してよいのは `display` の URL・寸法・カテゴリだけ。
 * **正解 / 両形式のバイト数 / png・jpeg の URL / 難易度の数値 / 得点の重みを含めない。**
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const row = await authenticateSession(id)
  if (!row) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // 「いまどの条件で遊んでいるか」を画面に出すために返す（prd/06 §2.1）。
  // 🔒 プレイヤー自身が選んだ公開情報で、個別問題については何も語らない（prd/04 §3.5）
  const sessionContext = { mode: row.mode, profileId: row.profileId }

  const served = await serveNextQuestion(row)
  if (!served) return NextResponse.json({ status: 'finished', ...sessionContext })

  // `hint` は**支払い済み**の色数レンジの再表示（null = 未使用）。無償の開示ではない
  // ——値が入るのは POST /hint で `hint_used_at` が確定した後だけ（prd/06 §7.3, prd/04 §3.6）
  return NextResponse.json({
    status: 'question',
    question: served.question,
    hint: served.hint,
    ...sessionContext,
  })
}
