import { getDatabase, question, questionEncoding, session } from '@png-jpeg-quiz/database'
import { createSessionRequestSchema, findMode, findProfile } from '@png-jpeg-quiz/quiz-core'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { findPlayableProfile } from '@/profiles.ts'
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
  const { mode: modeId, profileId } = parsed.data
  if (!findProfile(profileId)) {
    return NextResponse.json({ error: 'unknown profile' }, { status: 400 })
  }

  const mode = findMode(modeId)
  if (!mode) {
    return NextResponse.json({ error: 'unknown mode' }, { status: 400 })
  }

  // 答えが片方に寄りきっている条件は選ばせない（得点が -log2(0) で発散する。prd/06 §1）
  if (!(await findPlayableProfile(profileId))) {
    return NextResponse.json({ error: 'profile is not playable' }, { status: 409 })
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

  // 問題数はモードが決める（prd/02 §4-1）
  const questionCount = mode.questionCount(available.length)

  const sessionId = newSessionId()
  const secret = newSessionSecret()
  await database
    .insert(session)
    .values({ id: sessionId, secret, mode: mode.id, profileId, questionCount })
  await setSessionCookie(sessionId, secret)

  return NextResponse.json({ sessionId, mode: mode.id, profileId, questionCount })
}
