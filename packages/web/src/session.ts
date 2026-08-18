import { randomBytes, timingSafeEqual } from 'node:crypto'
import { getDatabase, session } from '@png-jpeg-quiz/database'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'

/**
 * セッションの所有証明（prd/04 §2）。
 *
 * 🔒 `session.id`（URL に出す）と `secret`（HttpOnly Cookie）を**分ける**。
 * 回答 POST は Cookie の `secret` を検証する。
 * 署名付きステートレストークンは採らない——DB 行があるほうが、
 * 再送防止・重複出題防止・不正検知の記録がそのまま書ける。
 */

const COOKIE_PREFIX = 'pjq_session_'

export function newSessionId(): string {
  return randomBytes(16).toString('hex')
}

export function newSessionSecret(): string {
  return randomBytes(32).toString('hex')
}

export function sessionCookieName(sessionId: string): string {
  return `${COOKIE_PREFIX}${sessionId}`
}

export async function setSessionCookie(sessionId: string, secret: string): Promise<void> {
  const store = await cookies()
  store.set(sessionCookieName(sessionId), secret, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    // 制限時間を廃止し「何日かけてもよい」（prd/04 §5.1）ので、cookie で急かさない
    maxAge: 60 * 60 * 24 * 30,
  })
}

/** 定数時間で比較する（秘密の一致判定に `===` を使わない） */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type SessionRow = typeof session.$inferSelect

/**
 * Cookie の `secret` を検証して、セッション行を返す。
 * 🔒 **一致しなければ null**。呼び出し側は 403 を返すこと。
 */
export async function authenticateSession(sessionId: string): Promise<SessionRow | null> {
  const store = await cookies()
  const provided = store.get(sessionCookieName(sessionId))?.value
  if (!provided) return null

  const rows = await getDatabase().select().from(session).where(eq(session.id, sessionId)).limit(1)
  const row = rows[0]
  if (!row) return null
  if (!secretMatches(provided, row.secret)) return null
  return row
}
