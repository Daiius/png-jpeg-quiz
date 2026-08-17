import { getDatabase, session } from '@png-jpeg-quiz/database'
import { createSessionRequestSchema, defaultModeForPool, findMode } from '@png-jpeg-quiz/quiz-core'
import { NextResponse } from 'next/server'
import { resolveStartProfile } from '@/profiles.ts'
import { newSessionId, newSessionSecret, setSessionCookie } from '@/session.ts'

export const dynamic = 'force-dynamic'

/**
 * セッション開始（prd/02 §4-2）。
 *
 * 🔒 **プロファイルはここで固定**し、途中で変えられない（prd/04 §2）。
 * 🔑 **mode / profileId は省略できる**（prd/06 §2.1）。省略時はサーバが既定を選ぶ
 * ——`/` を開いた瞬間に始まる「おまかせ開始」がこの経路。
 */
export async function POST(request: Request) {
  const parsed = createSessionRequestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }
  const { mode: modeId, profileId } = parsed.data

  // 答えが片方に寄りきっている条件は選ばせない（得点が -log2(0) で発散する。prd/06 §1）。
  // 省略時はここで標準条件が選ばれる
  const profile = await resolveStartProfile(profileId)
  if (!profile) {
    return NextResponse.json(
      { error: profileId === undefined ? 'no playable profile' : 'profile is not playable' },
      { status: 409 },
    )
  }

  // 🔒 プールが 30 問に満たないときは practice を選ぶ。**standard-30 は短くしない**（prd/06 §2）
  const mode = modeId === undefined ? defaultModeForPool(profile.poolSize) : findMode(modeId)
  if (!mode) {
    return NextResponse.json({ error: 'unknown mode' }, { status: 400 })
  }

  // 問題数はモードが決める（prd/02 §4-1）
  const questionCount = mode.questionCount(profile.poolSize)

  // 明示された mode がプールに対して大きすぎるときは、短縮せずに断る（practice を使ってもらう）
  if (questionCount > profile.poolSize) {
    return NextResponse.json(
      {
        error: 'not enough questions for this mode',
        required: questionCount,
        available: profile.poolSize,
      },
      { status: 409 },
    )
  }

  const sessionId = newSessionId()
  const secret = newSessionSecret()
  await getDatabase()
    .insert(session)
    .values({ id: sessionId, secret, mode: mode.id, profileId: profile.id, questionCount })
  await setSessionCookie(sessionId, secret)

  return NextResponse.json({
    sessionId,
    mode: mode.id,
    profileId: profile.id,
    questionCount,
  })
}
