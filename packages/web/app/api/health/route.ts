import { pingDatabase } from '@png-jpeg-quiz/database'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * 開発環境の疎通確認（web → MySQL）。
 * 🔒 問題・正解に関わる情報は一切返さない。
 */
export async function GET() {
  try {
    await pingDatabase()
    return NextResponse.json({ status: 'ok', database: 'ok' })
  } catch (error) {
    // 接続先やパスワードが出ないよう、詳細はサーバのログにだけ残す
    console.error('[health] database ping failed:', error)
    return NextResponse.json({ status: 'degraded', database: 'unreachable' }, { status: 503 })
  }
}
