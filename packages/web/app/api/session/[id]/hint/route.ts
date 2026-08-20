import { hintRequestSchema } from '@png-jpeg-quiz/quiz-core'
import { NextResponse } from 'next/server'
import { requestHint } from '@/quiz-service.ts'
import { authenticateSession } from '@/session.ts'

export const dynamic = 'force-dynamic'

/**
 * 色数ヒント（prd/06 §7.3 / prd/02 §4-2）。T7 の唯一の例外（prd/04 §3.6）。
 *
 * 🔒 **永続化が開示に先行する。** サーバは `hint_used_at` を書いてからレンジを返し、
 * 開示した時点で減点が確定する。返すのは 2 段階レンジだけ——`color_count` の実数・
 * 他の属性は回答後まで出さない。
 * 冪等: 支払い済みの再要求は保存済みのレンジを返す。回答済みの行への要求は拒否。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const row = await authenticateSession(id)
  if (!row) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const parsed = hintRequestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }

  const outcome = await requestHint(row, parsed.data.questionId)
  if (outcome.status === 'not-allowed') {
    return NextResponse.json({ error: 'hint is not available in this mode' }, { status: 409 })
  }
  if (outcome.status === 'not-current') {
    return NextResponse.json({ error: 'not the current question' }, { status: 409 })
  }
  if (outcome.status === 'already-answered') {
    // 回答済みの行にはヒント代を発生させない（prd/06 §7.3）
    return NextResponse.json({ error: 'already answered' }, { status: 409 })
  }
  return NextResponse.json({ colorRange: outcome.colorRange })
}
