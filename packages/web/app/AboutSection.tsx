import { findProfile } from '@png-jpeg-quiz/quiz-core'

/**
 * 画面下部の説明（prd/06 §2.1）。**出題画面の下にスクロールして到達する。**
 *
 * ⚠ ここに出す条件は**表示のみ**。選ぶ UI はダイアログに一本化する（ここにあるのは開く導線だけ）。
 * 同じ操作が 2 箇所にあると、どちらがセッションを作り直すのか分からなくなる。
 *
 * 🔒 出題中の画面なので、**答えの方向を示す情報は置かない**（prd/04 §3.5）。
 * 条件そのものと、プロファイル全体の性質までが上限。
 */
export function AboutSection({
  profileId,
  onChangeProfile,
}: {
  profileId: string | null
  onChangeProfile: () => void
}) {
  // ⚠ 条件の中身を**書き写さない**。プロファイル定義から引く
  // （旧標準 q80-420 の説明文が再校正後も残っていて、ID と食い違っていた）
  const profile = profileId === null ? null : findProfile(profileId)

  return (
    <section id="about" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12 text-sm">
      <div className="flex flex-col gap-3">
        {/* ページの h1 は QuizRoot の sr-only。ここは同名の見出しだが階層上は h2（見た目は不変） */}
        <h2 className="font-bold text-2xl">PNG / JPEG どっちが小さい？</h2>
        <p className="text-ink-muted">
          表示された画像を、決まった条件で PNG と JPEG にエンコードしたとき、
          どちらの配布サイズが小さいかを当てる 2 択クイズです。
          <strong>実際にエンコードした結果</strong>を正解にしています（推定ではありません）。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-bold">いま適用している条件</h3>
        <dl className="grid grid-cols-[5rem_1fr] gap-y-2 rounded border border-line bg-sunken px-4 py-3 text-ink-muted">
          <dt className="font-medium">条件 ID</dt>
          <dd className="font-mono">{profileId ?? '（開始待ち）'}</dd>
          {profile ? (
            <>
              <dt className="font-medium">前処理</dt>
              <dd>
                sRGB へ変換 / メタデータ除去 / 透過は背景色に合成。
                <strong>リサイズしない</strong>
              </dd>
              <dt className="font-medium">PNG</dt>
              <dd>
                sharp（compressionLevel 9 / effort 10）
                {profile.pngOptimize ? ' → oxipng -o4' : '（oxipng による最適化なし）'}
              </dd>
              <dt className="font-medium">JPEG</dt>
              <dd>
                品質 {profile.jpegQuality} / {profile.chromaSubsampling} / progressive / mozjpeg
              </dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onChangeProfile}
            className="rounded border border-line-strong px-4 py-2 font-medium hover:bg-sunken"
          >
            条件を変えて始め直す
          </button>
          <a className="text-accent underline" href="/conditions">
            20 通りの条件と、標準条件の根拠
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-ink-muted">
        <h3 className="font-bold text-ink">正解の持ち方</h3>
        <p>
          正解はサーバだけが持っています。回答するまで、正解も PNG / JPEG のバイト数も 画像の URL
          もブラウザには渡していません。回答すると
          <strong>両方の実物とバイト数、20 条件すべての結果</strong>
          を出すので、開発者ツールで転送サイズを自分で確かめられます。
        </p>
        <p className="text-ink-faint text-xs">
          ⚠ 実務では、サイズだけで形式を選ぶものではありません（劣化・透過・用途）。
        </p>
      </div>

      <a className="text-accent underline" href="/credits">
        素材のクレジット
      </a>
    </section>
  )
}
