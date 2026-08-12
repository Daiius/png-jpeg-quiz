import { getDatabase, question, questionEncoding, session } from '@png-jpeg-quiz/database'
import { createSessionRequestSchema, findProfile } from '@png-jpeg-quiz/quiz-core'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { newSessionId, newSessionSecret, setSessionCookie } from '@/session.ts'

export const dynamic = 'force-dynamic'

/**
 * セッション開始（prd/02 §4-2）。
 * 🔒 **プロファイルはここで固定**し、途中で変えられない（prd/04 §2）。
 */
export async function POST(request: Request) {
  const parsed = createSessionRequestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }
  const { mode, profileId } = parsed.data
  if (!findProfile(profileId)) {
    return NextResponse.json({ error: 'unknown profile' }, { status: 400 })
  }

  const database = getDatabase()
  const available = await database
    .select({ questionId: questionEncoding.questionId })
    .from(questionEncoding)
    .innerJoin(question, eq(question.id, questionEncoding.questionId))
    .where(and(eq(questionEncoding.profileId, profileId), eq(question.status, 'published')))

  if (available.length === 0) {
    return NextResponse.json({ error: 'no questions for this profile' }, { status: 409 })
  }

  // TODO(spec): standard-30 は 30 問（prd/06 §2）。プールが足りない M1 の間は在庫に合わせる
  const questionCount = Math.min(30, available.length)

  const sessionId = newSessionId()
  const secret = newSessionSecret()
  await database.insert(session).values({ id: sessionId, secret, mode, profileId, questionCount })
  await setSessionCookie(sessionId, secret)

  return NextResponse.json({ sessionId, mode, profileId, questionCount })
}
