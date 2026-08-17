import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * 旧: 出題画面。いまは `/` 自体が出題画面（prd/06 §2.1）なので、そこへ寄せるだけ。
 * ⚠ セッション ID は落とさない（開いたままのタブ・ブックマークがここに来る）。
 */
export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>
}) {
  const { session } = await searchParams
  redirect(session ? `/?session=${encodeURIComponent(session)}` : '/')
}
