export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold">PNG / JPEG どっちが小さい？</h1>
      <p className="text-slate-600">
        表示された画像を、指定された条件で PNG と JPEG にエンコードしたとき、
        どちらの配布サイズが小さいかを当てる 2 択クイズです。
      </p>
      <p className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        M0（リポジトリ基盤）の時点です。出題は M1 で実装します。 DB への疎通は{' '}
        <code className="font-mono">/api/health</code> で確認できます。
      </p>
    </main>
  )
}
