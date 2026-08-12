import { NextResponse } from 'next/server'
import { listProfileChoices } from '@/profiles.ts'

export const dynamic = 'force-dynamic'

/** 選べる条件の一覧（prd/06 §2）。🔒 問題を特定できる情報は載せない（prd/04 §3.5） */
export async function GET() {
  return NextResponse.json({ profiles: await listProfileChoices() })
}
