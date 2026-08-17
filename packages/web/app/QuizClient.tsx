'use client'

import type {
  Answer,
  AnswerResult,
  ProfileResult,
  QuestionView,
  VerificationView,
} from '@png-jpeg-quiz/quiz-core'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

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

/**
 * 読み物（説明文・ボタン・表）を 720px に収める（prd/01 §7.1）。
 * ⚠ 画像はこれで包まない。画像だけがビューポート幅いっぱいに出るのが今の設計。
 */
function Narrow({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-6">{children}</div>
}

/** ダイアログで切り替える対象。正解画面では PNG / JPEG の 2 枚、出題中は 1 枚だけ */
interface ZoomSource {
  label: string
  url: string
  alt: string
}

/** 開くダイアログの中身。どの画像からタップされたかで初期選択が変わる */
interface ZoomRequest {
  sources: ZoomSource[]
  index: number
}

const ZOOM_STEPS = ['fit', 1, 2, 4] as const
type ZoomStep = (typeof ZOOM_STEPS)[number]

/**
 * 拡大ダイアログ（prd/01 §7.3）。
 *
 * - **fit で開く。** いきなり 1:1 だと大きい素材では一部しか映らず、どこを見ているか分からない。
 * - ⚠ **独自のピンチ・パンを実装しない。** パンはネイティブのスクロール、さらなる拡大は
 *   ブラウザのピンチに任せる（モバイルのピンチズーム許可と二重にしない）。
 * - 🔒 A/B 切替では**倍率とスクロール位置を保持する**。同じ位置での変化を見せるのが目的で、
 *   位置がずれると切替の意味が失われる。そのため 2 枚を同じグリッドセルに重ねて置き、
 *   `src` を差し替えるのではなく**可視性だけを切り替える**（読み込みのちらつきも消える）。
 */
function ZoomDialog({
  sources,
  width,
  height,
  initialIndex,
  onClose,
}: {
  sources: readonly ZoomSource[]
  width: number
  height: number
  initialIndex: number
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<ZoomStep>('fit')
  const [index, setIndex] = useState(initialIndex)

  useEffect(() => {
    // showModal でトップレイヤに出す。Esc と背景（::backdrop）はブラウザが面倒をみる
    dialogRef.current?.showModal()
  }, [])

  const current = sources[index] ?? sources[0]
  if (!current) return null

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="h-dvh max-h-none w-dvw max-w-none bg-slate-900 p-0 text-white backdrop:bg-black/70"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-slate-700 border-b px-4 py-2 text-sm">
          {ZOOM_STEPS.map((option) => (
            <button
              key={String(option)}
              type="button"
              onClick={() => setStep(option)}
              className={
                step === option
                  ? 'rounded bg-white px-3 py-1 font-medium text-slate-900'
                  : 'rounded border border-slate-600 px-3 py-1'
              }
            >
              {option === 'fit' ? '全体' : option === 1 ? '1:1' : `${option}x`}
            </button>
          ))}

          {/* 🔒 出題中は sources が 1 枚なので、この切替は出ない（prd/01 §7.3） */}
          {sources.length > 1 ? (
            <span className="ml-2 flex gap-2">
              {sources.map((source, i) => (
                <button
                  key={source.url}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={
                    index === i
                      ? 'rounded bg-white px-3 py-1 font-medium text-slate-900'
                      : 'rounded border border-slate-600 px-3 py-1'
                  }
                >
                  {source.label}
                </button>
              ))}
            </span>
          ) : null}

          <span className="ml-auto flex items-center gap-3">
            <span className="tabular-nums text-slate-400 text-xs">
              原寸 {width}×{height}
            </span>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded border border-slate-600 px-3 py-1"
              aria-label="閉じる"
            >
              ✕
            </button>
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          {/* fit は 1 枚のセルをコンテナいっぱいに広げて `object-contain` で letterbox する。
              ⚠ `max-w/max-h` だけでは縮小しかせず、原寸より小さい画像が拡大されない。
              倍率指定のときは内容幅に合わせ、コンテナより小さい間は中央に置く */}
          <div
            className={
              step === 'fit'
                ? 'grid h-full w-full'
                : 'grid min-h-full w-max min-w-full place-items-center'
            }
          >
            {sources.map((source, i) => (
              <img
                key={source.url}
                src={source.url}
                width={width}
                height={height}
                alt={source.alt}
                // 🔒 拡大しても実物と 1 画素も違わないものを見せる（prd/01 §7.2）
                style={
                  step === 'fit'
                    ? undefined
                    : { width: width * step, maxWidth: 'none', height: 'auto' }
                }
                className={`col-start-1 row-start-1 [image-rendering:pixelated] ${
                  step === 'fit' ? 'h-full w-full object-contain' : ''
                } ${i === index ? '' : 'invisible'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </dialog>
  )
}

/**
 * インラインの画像（prd/01 §7.1）。**ビューポート幅いっぱい**に出し、タップで拡大ダイアログを開く。
 * `button` で包むのはキーボードからも開けるようにするため。
 */
function ZoomableImage({
  url,
  alt,
  width,
  height,
  onOpen,
}: {
  url: string
  alt: string
  width: number
  height: number
  onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in">
      <img
        src={url}
        width={width}
        height={height}
        alt={alt}
        className="block h-auto w-full [image-rendering:pixelated]"
      />
    </button>
  )
}

/** そのセッションが何で遊んでいるか（prd/06 §2.1）。画面に条件を出すために親へ渡す */
export interface SessionContext {
  mode: string
  profileId: string
}

export function QuizClient({
  sessionId,
  header,
  onSessionContext,
}: {
  sessionId: string
  /** 問題番号・得点の下に差し込む行（条件の表示と変更導線）。出題中も回答後も出る */
  header?: ReactNode
  onSessionContext?: (context: SessionContext) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [score, setScore] = useState(0)
  const [zoom, setZoom] = useState<ZoomRequest | null>(null)

  // ⚠ コールバックを effect / useCallback の依存に入れない。親が毎レンダリングで
  // 新しい関数を渡すと出題の取得が繰り返される（M2 で踏んだ二重送信と同じ形）
  const contextRef = useRef(onSessionContext)
  useEffect(() => {
    contextRef.current = onSessionContext
  })

  const loadQuestion = useCallback(async () => {
    setPhase({ kind: 'loading' })
    const response = await fetch(`/api/session/${sessionId}/question`)
    if (!response.ok) {
      setPhase({ kind: 'error', message: `出題を取得できませんでした（${response.status}）` })
      return
    }
    const body = await response.json()
    contextRef.current?.({ mode: body.mode as string, profileId: body.profileId as string })
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
    return (
      <Narrow>
        <p className="text-slate-500">読み込み中…</p>
      </Narrow>
    )
  }

  if (phase.kind === 'error') {
    return (
      <Narrow>
        <div className="flex flex-col items-start gap-3">
          <p className="text-red-600">{phase.message}</p>
          {/* 期限切れ・別ブラウザの URL を開いた場合はここに来る。新しい回を始められるようにする */}
          <a
            className="rounded bg-slate-900 px-6 py-3 font-bold text-white hover:bg-slate-700"
            href="/"
          >
            新しく始める
          </a>
        </div>
      </Narrow>
    )
  }

  if (phase.kind === 'finished') {
    return (
      <Narrow>
        <div className="flex flex-col items-start gap-4">
          <h2 className="font-bold text-2xl">おしまい</h2>
          <p className="text-slate-600">
            全問終わりました（{score.toFixed(2)} 点）。ランキングへの登録は M3 で実装します。
          </p>
          <a
            className="rounded bg-slate-900 px-6 py-3 font-bold text-white hover:bg-slate-700"
            href="/"
          >
            もう一度遊ぶ
          </a>
        </div>
      </Narrow>
    )
  }

  const { question } = phase

  return (
    // flex-1 と下の mt-auto で、内容が短いときも 2 択ボタンが画面下端に来る
    // （モバイルでは画像が縦に余るので、そうしないとボタンが宙に浮く）
    <div className="flex flex-1 flex-col gap-6">
      <Narrow>
        <div className="flex items-baseline justify-between text-slate-500 text-sm">
          <p>
            第 {question.index + 1} 問 / 全 {question.total} 問（{question.category}）
          </p>
          <p className="tabular-nums">{score.toFixed(2)} 点</p>
        </div>
        {header}
        {phase.kind === 'question' ? (
          // 問いは画像より先に読ませる。ボタンは sticky で下に常駐する
          <p className="mt-2 font-medium">
            この画像を PNG と JPEG にすると、<strong>小さいのはどちら？</strong>
          </p>
        ) : null}
      </Narrow>

      {/* 🔒 幅いっぱいに出す（prd/01 §7.1）。display は R2 由来の外部 URL になる（M4）ので
          next/image は挟まない。
          ⚠ 回答後は出さない。すぐ下に PNG / JPEG の実物が同じ幅で並ぶので、3 枚目は
          スクロールを増やすだけになる */}
      {phase.kind === 'question' ? (
        <ZoomableImage
          url={question.displayUrl}
          alt="出題画像"
          width={question.width}
          height={question.height}
          onOpen={() =>
            setZoom({
              sources: [{ label: '出題画像', url: question.displayUrl, alt: '出題画像' }],
              index: 0,
            })
          }
        />
      ) : null}

      {phase.kind === 'question' ? (
        // 🔒 画像が縦に長くてもボタンを見せ続け、「全体を見ないまま答える」流れを作らない（prd/01 §7.1）
        <div className="sticky bottom-0 z-10 mt-auto border-slate-200 border-t bg-white/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <Narrow>
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
          </Narrow>
        </div>
      ) : (
        <ResultPanel
          result={phase.result}
          width={question.width}
          height={question.height}
          onZoom={setZoom}
          onNext={() => void loadQuestion()}
        />
      )}

      {zoom ? (
        <ZoomDialog
          sources={zoom.sources}
          width={question.width}
          height={question.height}
          initialIndex={zoom.index}
          onClose={() => setZoom(null)}
        />
      ) : null}
    </div>
  )
}

/** 回答後は全部見せる（prd/04 §4）。ここは意図的に開示側。 */
function ResultPanel({
  result,
  width,
  height,
  onZoom,
  onNext,
}: {
  result: AnswerResult
  width: number
  height: number
  onZoom: (request: ZoomRequest) => void
  onNext: () => void
}) {
  const winner = result.answer === 'png' ? 'PNG' : 'JPEG'
  // 🔒 2 枚を 1 つのダイアログに渡す。同じ位置での A/B 切替が目的（prd/01 §7.3）
  const sources: ZoomSource[] = [
    { label: 'PNG', url: result.pngUrl, alt: 'PNG 版' },
    { label: 'JPEG', url: result.jpegUrl, alt: 'JPEG 版' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Narrow>
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
      </Narrow>

      {/* 実物をそのまま配り、開発者ツールで転送サイズを検証できるようにする（prd/04 §4）。
          🔒 横並びにすると各々が半分の幅になり、劣化が見えない。縦積みで幅いっぱい（prd/01 §7.1） */}
      {sources.map((source, index) => (
        <figure key={source.url} className="flex flex-col gap-2">
          <Narrow>
            <figcaption className="font-medium text-sm">
              {source.label} — {formatBytes(index === 0 ? result.pngBytes : result.jpegBytes)}
            </figcaption>
          </Narrow>
          <ZoomableImage
            url={source.url}
            alt={source.alt}
            width={width}
            height={height}
            onOpen={() => onZoom({ sources, index })}
          />
        </figure>
      ))}

      <Narrow>
        <div className="flex flex-col gap-4">
          <p className="text-slate-600 text-sm">
            サイズ比 log2(PNG/JPEG) = {result.log2Ratio.toFixed(2)}
            {result.explanation ? ` — ${result.explanation}` : ''}
          </p>

          <VerificationPanel result={result} />

          <ProfileResultsTable results={result.profileResults} />

          <details className="text-slate-600 text-sm">
            <summary className="cursor-pointer">出典とライセンス</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs">
              {JSON.stringify(result.source, null, 2)}
            </pre>
          </details>

          <p className="text-slate-500 text-xs">
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
      </Narrow>
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
