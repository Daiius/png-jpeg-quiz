import { ENCODE_PROFILES, findProfile, STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'

export const metadata = {
  title: 'エンコード条件 — PNG / JPEG どっちが小さい？',
  description: 'このクイズで使っているエンコード条件（20 プロファイル）の一覧と、標準条件の根拠。',
}

/**
 * 標準条件の明示（prd/01 §3）。
 *
 * 🔒 ここに出してよいのは**条件そのもの**だけ。
 * 個別問題の難易度・正解・実測正答率は載せない（prd/04 §3.5）。
 * プロファイル全体の偏りは対称な情報なので公開してよいが、
 * **問題を特定できる形にしない**。
 */
export default function ConditionsPage() {
  // ⚠ 条件の中身を書き写さない（旧標準の説明文が残る事故を防ぐ）
  const standard = findProfile(STANDARD_PROFILE_ID)

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">エンコード条件</h1>
        <p className="text-slate-600">
          「どちらが小さいか」は<strong>エンコードのオプション次第で変わります</strong>。
          そこでこのサイトは条件を隠さず、20 通りを事前に計算して選べるようにしています。
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">標準条件（ランキングの基準）</h2>
        <p className="font-mono text-sm">{STANDARD_PROFILE_ID}</p>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <dt className="font-medium">前処理</dt>
          <dd>
            sRGB へ変換 / ICC 除去 / 8bit・ch / メタデータ全除去 / 透過は背景色に合成してから除去 /
            <strong>リサイズしない</strong>
          </dd>
          <dt className="font-medium">PNG</dt>
          <dd>
            sharp（<code>compressionLevel: 9</code>, <code>effort: 10</code>）→{' '}
            <strong>oxipng -o4</strong>。色数 256 以下なら可逆パレット化（減色はしない）
          </dd>
          <dt className="font-medium">JPEG</dt>
          <dd>
            品質 <strong>{standard?.jpegQuality}</strong> /{' '}
            <strong>{standard?.chromaSubsampling}</strong> / progressive / mozjpeg
          </dd>
          <dt className="font-medium">比較</dt>
          <dd>ファイルのバイト数。転送時圧縮（gzip / br）は考慮しません</dd>
        </dl>
        <p className="text-sm text-slate-600">
          この条件を標準にしたのは、<strong>PNG・JPEG の両方を最高品質側に振った条件</strong>
          だからです。PNG は可逆なので常に画質最高で、oxipng はサイズだけを詰めます。 JPEG
          も品質・サブサンプリングを最高側にすると、
          <strong>「どちらも最良を尽くしたうえでの比較」</strong>という説明のつく基準になります。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">選べる 20 条件</h2>
        <p className="text-sm text-slate-600">
          JPEG 品質 5 段階 × クロマサブサンプリング 2 種 × PNG 最適化の有無。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-slate-300 border-b text-left">
                <th className="py-2 pr-4 font-medium">ID</th>
                <th className="py-2 pr-4 font-medium">JPEG 品質</th>
                <th className="py-2 pr-4 font-medium">サブサンプリング</th>
                <th className="py-2 font-medium">PNG 最適化</th>
              </tr>
            </thead>
            <tbody>
              {ENCODE_PROFILES.map((profile) => (
                <tr key={profile.id} className="border-slate-200 border-b">
                  <td className="py-2 pr-4 font-mono">
                    {profile.id}
                    {profile.isStandard ? (
                      <span className="ml-2 rounded bg-slate-900 px-2 py-0.5 text-white text-xs">
                        標準
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{profile.jpegQuality}</td>
                  <td className="py-2 pr-4">{profile.chromaSubsampling}</td>
                  <td className="py-2">{profile.pngOptimize ? 'oxipng -o4' : 'なし'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">この割り切りについて</h2>
        <p className="text-sm text-slate-600">
          出題は<strong>サイズだけ</strong>を問います。劣化の許容度・透過の要否・用途は問いません。
          現場の判断はサイズだけでは決まりません——
          <strong>僅差なら、サイズ以外の理由で選ぶべき</strong>です。これは意図的な割り切りです。
        </p>
      </section>

      <a className="text-blue-700 underline" href="/">
        最初に戻る
      </a>
    </main>
  )
}
