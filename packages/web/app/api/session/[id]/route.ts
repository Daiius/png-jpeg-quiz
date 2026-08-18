import { NextResponse } from 'next/server'
import { sessionState } from '@/quiz-service.ts'
import { authenticateSession } from '@/session.ts'

export const dynamic = 'force-dynamic'

/**
 * セッション状態（prd/02 §4-2）。リロードで得点・進行・直前の正解画面を復元する（prd/06 §2.1）。
 *
 * 🔒 返してよいのはプレイヤー自身の集計値と、**回答済み**の問題の開示だけ。
 * 未回答の問題の情報を含めない（prd/04 §3.5）。
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const row = await authenticateSession(id)
  if (!row) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  return NextResponse.json(await sessionState(row))
}
