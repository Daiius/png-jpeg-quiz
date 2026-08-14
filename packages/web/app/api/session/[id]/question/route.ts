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

  const view = await serveNextQuestion(row)
  if (!view) return NextResponse.json({ status: 'finished' })

  return NextResponse.json({ status: 'question', question: view })
}
