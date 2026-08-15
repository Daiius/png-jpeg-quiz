import { STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { QuizClient } from './QuizClient.tsx'

export const dynamic = 'force-dynamic'

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>
}) {
  const { session } = await searchParams

  if (!session) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <h1 className="text-2xl font-bold">セッションがありません</h1>
        <p className="text-slate-600">
          トップページから開始してください（標準条件: {STANDARD_PROFILE_ID}）。
        </p>
        <a className="text-blue-700 underline" href="/">
          最初に戻る
        </a>
      </main>
    )
  }

  // ⚠ ここで幅を絞らない。画像はビューポート幅いっぱいに出し、読み物だけ 720px に収める
  // （prd/01 §7.1）。絞る役目は QuizClient 内の <Narrow> が持つ。
  return (
    <main className="flex min-h-dvh flex-col gap-6 py-10">
      <QuizClient sessionId={session} />
    </main>
  )
}
