import { STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { StartPanel } from './StartPanel.tsx'

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold">PNG / JPEG どっちが小さい？</h1>
      <p className="text-slate-600">
        表示された画像を、決まった条件で PNG と JPEG にエンコードしたとき、
        どちらの配布サイズが小さいかを当てる 2 択クイズです。
      </p>

      <dl className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <dt className="font-medium">標準条件</dt>
        <dd className="font-mono">{STANDARD_PROFILE_ID}</dd>
        <dd className="mt-1 text-slate-600">
          PNG: sharp（compressionLevel 9 / effort 10）→ oxipng -o4 ／ JPEG: 品質
          80・4:2:0・progressive・mozjpeg ／ リサイズなし
        </dd>
      </dl>

      <StartPanel />

      <p className="text-slate-500 text-xs">
        正解はサーバだけが持っています。回答すると PNG / JPEG 両方の実物とバイト数、 そして 20
        条件すべての結果を表示します。
      </p>

      <a className="text-blue-700 text-sm underline" href="/conditions">
        エンコード条件の詳細を見る
      </a>
    </main>
  )
}
