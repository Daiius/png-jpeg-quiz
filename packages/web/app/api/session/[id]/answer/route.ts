import { submitAnswerRequestSchema } from '@png-jpeg-quiz/quiz-core'
import { NextResponse } from 'next/server'
import { submitAnswer } from '@/quiz-service.ts'
import { authenticateSession } from '@/session.ts'

export const dynamic = 'force-dynamic'

/**
 * 回答（prd/02 §4-2）。ここで初めて正解・バイト数・両形式の URL を返す（prd/04 §4）。
 * 🔒 クライアントから受け取るのは「どちらを選んだか」だけ。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const row = await authenticateSession(id)
  if (!row) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const parsed = submitAnswerRequestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }

  const outcome = await submitAnswer(row, parsed.data.questionId, parsed.data.answer)
  if (outcome.status === 'not-current') {
    return NextResponse.json({ error: 'not the current question' }, { status: 409 })
  }
  if (outcome.status === 'already-answered') {
    return NextResponse.json({ error: 'already answered' }, { status: 409 })
  }
  // 🔒 人間に不可能な速さ（prd/04 §5 / T6）
  if (outcome.status === 'too-fast') {
    return NextResponse.json({ error: 'too fast' }, { status: 429 })
  }
  // 🔒 まだ期限前。クライアントの時計が進んでいる（prd/04 §2）
  if (outcome.status === 'not-expired') {
    return NextResponse.json(
      { error: 'not expired yet', remainingMs: outcome.remainingMs },
      { status: 425 },
    )
  }
  return NextResponse.json(outcome.result)
}
