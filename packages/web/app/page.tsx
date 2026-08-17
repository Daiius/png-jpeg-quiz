import { QuizRoot } from './QuizRoot.tsx'

export const dynamic = 'force-dynamic'

/**
 * トップページ ＝ 出題画面（prd/06 §2.1）。
 *
 * 🔑 **開いた時点で 1 問目が出ている。** 開始ボタンも条件選択も挟まない
 * ——何をするサイトかは、説明文ではなく問題そのもので伝える。
 * 条件の選択はダイアログ、サイトの説明は画面下部に置く。
 *
 * `?session=` があれば継続。無ければ `QuizRoot` が「おまかせ開始」でセッションを作る。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>
}) {
  const { session } = await searchParams

  // ⚠ ここで幅を絞らない。画像はビューポート幅いっぱいに出し、読み物だけ 720px に収める
  // （prd/01 §7.1）。絞る役目は QuizClient 内の <Narrow> が持つ。
  return <QuizRoot initialSessionId={session ?? null} />
}
