'use client'

import type {
  Answer,
  AnswerResult,
  ProfileResult,
  QuestionView,
  VerificationView,
} from '@png-jpeg-quiz/quiz-core'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 出題 → 2 択 → 正解画面（prd/04 §4）。
 *
 * 🔒 このコンポーネントが持つのはサーバから来たものだけ。
 * 正解・バイト数・png/jpeg の URL は **回答を送った後のレスポンスにしか入っていない**。
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'question'; question: QuestionView }
  | { kind: 'result'; question: QuestionView; result: AnswerResult }
  | { kind: 'finished' }
  | { kind: 'error'; message: string }

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('ja-JP')} B`
}

export function QuizClient({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [score, setScore] = useState(0)

  const loadQuestion = useCallback(async () => {
    setPhase({ kind: 'loading' })
    const response = await fetch(`/api/session/${sessionId}/question`)
    if (!response.ok) {
      setPhase({ kind: 'error', message: `出題を取得できませんでした（${response.status}）` })
      return
    }
    const body = await response.json()
    if (body.status === 'finished') {
      setPhase({ kind: 'finished' })
      return
    }
    setPhase({ kind: 'question', question: body.question as QuestionView })
  }, [sessionId])

  useEffect(() => {
    void loadQuestion()
  }, [loadQuestion])

  /**
   * 🔒 送るのは**どちらを選んだかだけ**（prd/04 §2）。経過時間はサーバが `served_at` から測る。
   * ⚠ **制限時間は無い**（prd/04 §5.1）。自動送信の経路も無く、送信は必ずクリック起点。
   */
  async function submit(question: QuestionView, chosen: Answer) {
    // 二重クリックで同じ問題に 2 回 POST するのを防ぐ
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const response = await fetch(`/api/session/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.questionId, answer: chosen }),
      })

      if (!response.ok) {
        setPhase({ kind: 'error', message: `回答を送れませんでした（${response.status}）` })
        return
      }

      const result: AnswerResult = await response.json()
      setScore((current) => current + result.awardedPoints)
      setPhase({ kind: 'result', question, result })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (phase.kind === 'loading') {
    return <p className="text-slate-500">読み込み中…</p>
  }

  if (phase.kind === 'error') {
    return <p className="text-red-600">{phase.message}</p>
  }

  if (phase.kind === 'finished') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">おしまい</h2>
        <p className="text-slate-600">全問終わりました。得点とランキングは M2 以降で実装します。</p>
        <a className="text-blue-700 underline" href="/">
          最初に戻る
        </a>
      </div>
    )
  }

  const { question } = phase

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between text-slate-500 text-sm">
        <p>
          第 {question.index + 1} 問 / 全 {question.total} 問（{question.category}）
        </p>
        <p className="tabular-nums">{score.toFixed(2)} 点</p>
      </div>

      {/* display は R2 由来の外部 URL になる（M4）。next/image は挟まない */}
      <img
        src={question.displayUrl}
        width={question.width}
        height={question.height}
        alt="出題画像"
        className="max-h-[52vh] w-auto self-center rounded border border-slate-200 object-contain"
      />

      {phase.kind === 'question' ? (
        <div className="flex flex-col gap-3">
          <p className="font-medium">
            この画像を PNG と JPEG にすると、<strong>小さいのはどちら？</strong>
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(question, 'png')}
              className="flex-1 rounded border border-slate-300 px-6 py-4 text-lg font-bold hover:bg-slate-50 disabled:opacity-50"
            >
              PNG
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(question, 'jpeg')}
              className="flex-1 rounded border border-slate-300 px-6 py-4 text-lg font-bold hover:bg-slate-50 disabled:opacity-50"
            >
              JPEG
            </button>
          </div>
        </div>
      ) : (
        <ResultPanel result={phase.result} onNext={() => void loadQuestion()} />
      )}
    </div>
  )
}

/** 回答後は全部見せる（prd/04 §4）。ここは意図的に開示側。 */
function ResultPanel({ result, onNext }: { result: AnswerResult; onNext: () => void }) {
  const winner = result.answer === 'png' ? 'PNG' : 'JPEG'
  return (
    <div className="flex flex-col gap-4">
      <p
        className={
          result.correct ? 'text-xl font-bold text-green-700' : 'text-xl font-bold text-red-700'
        }
      >
        {result.correct ? '正解' : '不正解'} — 小さいのは {winner} でした
        {result.awardedPoints > 0 ? (
          <span className="ml-2 text-base text-slate-600">
            +{result.awardedPoints.toFixed(2)} 点
          </span>
        ) : null}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <figure className="flex flex-col gap-2">
          <figcaption className="text-sm font-medium">
            PNG — {formatBytes(result.pngBytes)}
          </figcaption>
          {/* 実物をそのまま配り、開発者ツールで転送サイズを検証できるようにする（prd/04 §4） */}
          <img src={result.pngUrl} alt="PNG 版" className="rounded border border-slate-200" />
        </figure>
        <figure className="flex flex-col gap-2">
          <figcaption className="text-sm font-medium">
            JPEG — {formatBytes(result.jpegBytes)}
          </figcaption>
          {/* 同上 */}
          <img src={result.jpegUrl} alt="JPEG 版" className="rounded border border-slate-200" />
        </figure>
      </div>

      <p className="text-sm text-slate-600">
        サイズ比 log2(PNG/JPEG) = {result.log2Ratio.toFixed(2)}
        {result.explanation ? ` — ${result.explanation}` : ''}
      </p>

      <VerificationPanel result={result} />

      <ProfileResultsTable results={result.profileResults} />

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer">出典とライセンス</summary>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs">
          {JSON.stringify(result.source, null, 2)}
        </pre>
      </details>

      <p className="text-xs text-slate-500">
        ⚠ サイズだけで選ぶものではありません（劣化・透過・用途）。とくに僅差のときは。
      </p>

      <button
        type="button"
        onClick={onNext}
        className="self-start rounded bg-slate-900 px-6 py-3 font-bold text-white hover:bg-slate-700"
      >
        {result.hasNext ? '次の問題へ' : '結果を見る'}
      </button>
    </div>
  )
}

/**
 * 検証ビュー（prd/04 §4.1）— JPEG が「どこを」「どれだけ」壊したか。
 *
 * サイズの答えと**対になる情報**。「JPEG が小さいのはタダではない」を目で確かめられるようにする。
 *
 * - 🔒 **既定は回答した条件のみ。** 出題条件は固定なので、他条件は「見たい人だけ」（折りたたみ）。
 * - 🔒 **どちらの指標を見ているか必ず出す。** ΔE00 は輪郭の**上**に乗り、
 *   1−SSIM は 8×8 窓で均されて輪郭の**外側**が光る。同じ領域を指しながら画素はずれる。
 * - ⚠ **絵と数値は厳密には一致しない。** 絵は連続階調（ΔE00 上限 5）、数値は閾値 2 の二値。
 *   意図した不一致（prd/04 §4.1）。
 */
function VerificationPanel({ result }: { result: AnswerResult }) {
  const [metric, setMetric] = useState<'de00' | 'ssim'>('de00')
  const selected = result.profileResults.find((profile) => profile.isSelected)
  const answered = result.verification.find(
    (view) =>
      view.jpegQuality === selected?.jpegQuality &&
      view.chromaSubsampling === selected?.chromaSubsampling,
  )
  const [shown, setShown] = useState<VerificationView | null>(null)
  const current = shown ?? answered

  if (!current) return null

  const others = result.verification.filter((view) => view !== answered)

  return (
    <section className="flex flex-col gap-2 rounded border border-slate-200 p-4">
      <h3 className="font-bold text-sm">JPEG は「どこを」「どれだけ」壊したか</h3>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['de00', 'ssim'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMetric(option)}
            className={
              metric === option
                ? 'rounded bg-slate-900 px-3 py-1 font-medium text-white'
                : 'rounded border border-slate-300 px-3 py-1 text-slate-700'
            }
          >
            {option === 'de00' ? 'ΔE00（色の差）' : 'SSIM（構造の差）'}
          </button>
        ))}
        <span className="text-slate-600 text-xs">
          品質 {current.jpegQuality} / {current.chromaSubsampling}
          {current === answered ? '（回答した条件）' : ''}
        </span>
      </div>

      <img
        src={metric === 'de00' ? current.de00Url : current.ssimUrl}
        alt={`${metric === 'de00' ? 'ΔE00' : 'SSIM'} の劣化オーバーレイ`}
        className="rounded border border-slate-200"
      />

      <p className="text-slate-600 text-xs">
        {metric === 'de00' ? (
          <>
            <strong>ΔE00（CIEDE2000）</strong> — 色の差。輪郭の<strong>上</strong>に乗ります。
            マゼンタが濃いほど大きい（上限 5 で固定。素材ごとに正規化していません）。
          </>
        ) : (
          <>
            <strong>1 − SSIM</strong> — 構造の差。8×8 窓で均されるため、輪郭の
            <strong>外側</strong>が光ります（上限 0.25 で固定）。
            <strong>ΔE00 とは別の場所を指します。</strong>
          </>
        )}
      </p>

      {current.over2Pct !== null ? (
        <p className="text-slate-700 text-sm">
          この条件では <strong>{current.over2Pct.toFixed(1)}%</strong> の画素が ΔE00 &gt; 2
          （目で違いが分かる目安）を超えています。
        </p>
      ) : null}

      {others.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">
            他の条件の劣化を見る（{result.verification.length} 通り）
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {result.verification.map((view) => {
              const isCurrent = view === current
              return (
                <button
                  key={`${view.jpegQuality}-${view.chromaSubsampling}`}
                  type="button"
                  onClick={() => setShown(view)}
                  className={
                    isCurrent
                      ? 'rounded bg-slate-900 px-2 py-1 font-mono text-white text-xs'
                      : 'rounded border border-slate-300 px-2 py-1 font-mono text-slate-700 text-xs'
                  }
                >
                  q{view.jpegQuality}/{view.chromaSubsampling}
                </button>
              )
            })}
          </div>
        </details>
      ) : null}
    </section>
  )
}

/**
 * 「他の条件ならどうなるか」（prd/04 §4）。**条件で答えが変わることの実演**が主目的なので、
 * 答えが反転している行が目で追えるようにする。
 */
function ProfileResultsTable({ results }: { results: readonly ProfileResult[] }) {
  if (results.length === 0) return null
  const flipped = new Set(
    results
      .filter((r) => r.answer !== results.find((x) => x.isSelected)?.answer)
      .map((r) => r.profileId),
  )

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-600">
        他の条件ならどうなるか（{results.length} 通り
        {flipped.size > 0 ? ` — うち ${flipped.size} 通りで答えが変わる` : ''}）
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-slate-300 border-b text-left">
              <th className="py-1 pr-3 font-medium">条件</th>
              <th className="py-1 pr-3 font-medium text-right">PNG</th>
              <th className="py-1 pr-3 font-medium text-right">JPEG</th>
              <th className="py-1 font-medium">小さいのは</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr
                key={row.profileId}
                className={
                  row.isSelected
                    ? 'border-slate-200 border-b bg-amber-50 font-medium'
                    : 'border-slate-200 border-b'
                }
              >
                <td className="py-1 pr-3 font-mono">
                  {row.profileId}
                  {row.isStandard ? <span className="ml-1 text-slate-500">（標準）</span> : null}
                  {row.isSelected ? <span className="ml-1 text-amber-700">← 今回</span> : null}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {row.pngBytes.toLocaleString('ja-JP')}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {row.jpegBytes.toLocaleString('ja-JP')}
                </td>
                <td className={flipped.has(row.profileId) ? 'py-1 text-red-700' : 'py-1'}>
                  {row.answer === 'png' ? 'PNG' : 'JPEG'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
