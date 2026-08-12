'use client'

import type { Answer, AnswerResult, ProfileResult, QuestionView } from '@png-jpeg-quiz/quiz-core'
import { useCallback, useEffect, useState } from 'react'

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
    setPhase({ kind: 'question', question: body.question })
  }, [sessionId])

  useEffect(() => {
    void loadQuestion()
  }, [loadQuestion])

  async function answer(question: QuestionView, chosen: Answer) {
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
      setPhase({ kind: 'result', question, result: await response.json() })
    } finally {
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
      <p className="text-sm text-slate-500">
        第 {question.index + 1} 問 / 全 {question.total} 問（{question.category}）
      </p>

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
              onClick={() => void answer(question, 'png')}
              className="flex-1 rounded border border-slate-300 px-6 py-4 text-lg font-bold hover:bg-slate-50 disabled:opacity-50"
            >
              PNG
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void answer(question, 'jpeg')}
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
