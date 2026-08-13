import { type CreditGroup, loadCredits, requiresAttribution } from '../../src/credits.ts'

export const metadata = {
  title: 'クレジット — PNG / JPEG どっちが小さい？',
  description: '出題画像の由来と、AI 生成の別の開示。',
}

// 問題プールはビルド成果物だが、公開/取り下げは運用で動くので毎回読む
export const dynamic = 'force-dynamic'

/**
 * クレジット（prd/05 §1.4）。
 *
 * 🔒 **個別の帰属を並べない。** 作者名と出典リンクが並んでいれば、プレイヤーは回答前に
 * 画面の出題画像とリンク先の原本を突き合わせて素性を割り出せる。
 * 素性は答えの方向を強く示すので（AI 生成 18 点は PNG 勝ち 2.2%、Commons のベクタ由来は 67%）、
 * これは T7 に反する（prd/04 §3.5）。
 *
 * → **公開プールは帰属義務の無い素材だけ**で構成し、ここでは**集合として**開示する。
 * 個別の出典・作者・ライセンス・改変内容は**回答後の画面**に出す（prd/05 §1.3）。
 */
export default async function CreditsPage() {
  const groups = await loadCredits()
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  const violating = groups.filter((group) => requiresAttribution(group.license))
  // 🔒 AI 生成の別が未宣言のまま公開すると、開示義務を静かに落とす（prd/05 §1.1）
  const undeclared = groups.filter((group) => group.isAiGenerated === null)

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="font-bold text-3xl">クレジット</h1>
        <p className="text-slate-600">
          出題に使っている画像 {total} 点の由来です。
          <strong>どの画像がどれかは示していません。</strong>
        </p>
      </div>

      {violating.length > 0 ? <AttributionWarning groups={violating} /> : null}
      {undeclared.length > 0 ? <UndeclaredWarning groups={undeclared} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-bold text-xl">素材の由来</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-slate-300 border-b text-left">
                <th className="py-2 pr-4 font-medium">由来</th>
                <th className="py-2 pr-4 font-medium">ライセンス</th>
                <th className="py-2 pr-4 font-medium">点数</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={`${group.site} ${group.license}`} className="border-slate-100 border-b">
                  <td className="py-2 pr-4">
                    {group.site}
                    {group.isAiGenerated === true ? (
                      <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-slate-700 text-xs">
                        AI 生成
                      </span>
                    ) : null}
                    {group.isAiGenerated === null ? (
                      <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-amber-900 text-xs">
                        AI 生成の別が未宣言
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">
                    {group.licenseUrl ? (
                      <a
                        className="text-blue-700 underline"
                        href={group.licenseUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {group.license}
                      </a>
                    ) : (
                      group.license
                    )}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{group.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* ⚠ ライセンス本文へのリンクは原本を指さないので T7 の経路にならない */}
        <p className="text-slate-500 text-xs">
          ライセンス名のリンクはライセンス条文へのものです。原本のページへは意図的にリンクしていません。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold text-xl">AI 生成について</h2>
        <p className="text-slate-600 text-sm">
          {groups
            .filter((group) => group.isAiGenerated === true)
            .flatMap((group) => group.authors)
            .join(' / ') || '（該当なし）'}{' '}
          が生成した画像を含みます。<strong>人間が描いたものと偽っていません。</strong>
          日本の著作権法では創作的寄与が乏しい生成物に著作物性が認められない可能性がありますが、
          配布の妨げにはなりません。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold text-xl">なぜ画像ごとの帰属を載せていないのか</h2>
        <p className="text-slate-600 text-sm">
          帰属表示には<strong>原本へ到達できること</strong>が含まれます。
          作者名と出典リンクが一覧に並んでいると、出題中の画像とリンク先の原本を突き合わせて、
          <strong>回答前にその画像の素性を知れてしまいます。</strong>
          素性（AI 生成か、図版か）は答えの向きを強く示すため、それはクイズとして成立しません。
        </p>
        <p className="text-slate-600 text-sm">
          そこでこのサイトは、<strong>帰属義務のある素材（CC BY / CC BY-SA）を出題に使わず</strong>
          、ここでは由来を集合としてのみ開示しています。 個別の出典・作者・ライセンス・改変内容は、
          <strong>回答した直後の画面でその画像について表示します。</strong>
        </p>
      </section>

      <a className="text-blue-700 text-sm underline" href="/">
        トップへ戻る
      </a>
    </main>
  )
}

/**
 * 🔒 **AI 生成の別が未宣言のまま公開しない**（prd/05 §1.1）。
 *
 * ⚠ **`false` で埋めなかったのはこのため。** 既定 `false` にすると、パイプラインを流し直すまで
 * AI 生成の問題が「AI ではない」と表示され、**開示義務を静かに落とす**。
 * `null`（未宣言）なら、こうして気づける。`pnpm quiz:build` を全素材に流せば解消する。
 */
function UndeclaredWarning({ groups }: { groups: readonly CreditGroup[] }) {
  const count = groups.reduce((sum, group) => sum + group.count, 0)
  return (
    <section className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-bold text-amber-900">
        ⚠ AI 生成の別が未宣言の素材が {count} 点あります（このままでは公開できません）
      </p>
      <p className="mt-2 text-amber-900">
        <code>pnpm quiz:build</code> を全素材に流して、<code>meta.json</code>{' '}
        の宣言を取り込んでください。
      </p>
    </section>
  )
}

/**
 * ⚠ **開発中の検出用。** 帰属義務のある素材が公開プールに残っていると、
 * このサイトは公開できない（prd/05 §1.4 / prd/07 の公開前提条件）。
 * 公開時にはこの条件が偽になっているはずなので、この節は出ない。
 */
function AttributionWarning({ groups }: { groups: readonly CreditGroup[] }) {
  return (
    <section className="rounded border border-red-300 bg-red-50 p-4 text-sm">
      <p className="font-bold text-red-800">
        ⚠ 帰属義務のある素材が出題プールに残っています（このままでは公開できません）
      </p>
      <ul className="mt-2 list-disc pl-5 text-red-900">
        {groups.map((group) => (
          <li key={`${group.site} ${group.license}`}>
            {group.site} / {group.license} — {group.count} 点
          </li>
        ))}
      </ul>
      <p className="mt-2 text-red-900">
        prd/05 §1.4 の決定により、CC BY / CC BY-SA の素材は公開プールに置けません。 該当の問題を{' '}
        <code>retired</code> にしてください。
      </p>
    </section>
  )
}
