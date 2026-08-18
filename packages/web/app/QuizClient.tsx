'use client'

import type {
  Answer,
  AnswerResult,
  ProfileResult,
  QuestionView,
  SessionStateResponse,
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
  /** `recoverable` なら再試行でこの回を続けられる。false は cookie が無い（403）ときだけ */
  | { kind: 'error'; message: string; recoverable: boolean }

/** 403 = cookie が無い。この回には戻れないので、新規開始だけが出口になる */
const EXPIRED_MESSAGE =
  'この回には参加できません（有効期限が切れたか、別のブラウザで始めた回です）。'

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('ja-JP')} B`
}

/**
 * 読み物（説明文・ボタン）を 720px に収める（prd/01 §7.1）。
 * ⚠ 画像はこれで包まない。画像だけがビューポート幅いっぱいに出るのが今の設計。
 *
 * `wide` は**データの面**（検証ビュー・20 条件の表）だけに使う。読み物は 720px のまま。
 * 🔒 ブレークポイントは `lg`（1024px）1 本。`md`（768px）は `max-w-3xl` と同値で境界にならない。
 */
function Narrow({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-6 ${wide ? 'max-w-3xl lg:max-w-5xl' : 'max-w-3xl'}`}>
      {children}
    </div>
  )
}

/**
 * 拡大ダイアログへの導線（prd/01 §7.4）。
 *
 * 🔑 **モバイルでは幅いっぱいでも 0.30x にしかならず、ダイアログは必須であって装飾ではない。**
 * にもかかわらず画像には「押せる」手がかりが無かった。幅 390px では画像の下に約 300px が
 * 余るので、そこがこの導線の置き場になる（余白と導線不足が同時に解ける）。
 *
 * ⚠ 画像の上に重ねない。🔒 UI は画像の見えに干渉しない（同時対比で画素の色が変わる）。
 */
function ZoomHint({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <Narrow>
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-2 rounded border border-line-strong px-4 py-2 text-sm hover:bg-sunken"
      >
        <span aria-hidden="true" className="text-ink-muted">
          ⤢
        </span>
        {label}
      </button>
    </Narrow>
  )
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
      className="h-dvh max-h-none w-dvw max-w-none bg-darkroom p-0 text-darkroom-ink backdrop:bg-black/70"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-darkroom-line border-b px-4 py-2 text-sm">
          {ZOOM_STEPS.map((option) => (
            <button
              key={String(option)}
              type="button"
              onClick={() => setStep(option)}
              className={
                step === option
                  ? 'rounded bg-darkroom-ink px-3 py-1 font-medium text-darkroom'
                  : 'rounded border border-darkroom-line px-3 py-1'
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
                      ? 'rounded bg-darkroom-ink px-3 py-1 font-medium text-darkroom'
                      : 'rounded border border-darkroom-line px-3 py-1'
                  }
                >
                  {source.label}
                </button>
              ))}
            </span>
          ) : null}

          <span className="ml-auto flex items-center gap-3">
            <span className="tabular-nums text-darkroom-ink/60 text-xs">
              原寸 {width}×{height}
            </span>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded border border-darkroom-line px-3 py-1"
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
  // 回答送信の失敗は出題画面の中に出す（画面ごと error に切り替えると再試行の文脈が失われる）
  const [submitError, setSubmitError] = useState<string | null>(null)
  /**
   * 応答不明のまま終わった送信の選択肢。サーバは受理済みかもしれず、その状態で**反対の**
   * 選択肢を送ると 409 → 次問追随になり、受理済み回答の正解画面と加点を永久に失う
   * （OCL-C3CDAECF）。回復するまで同じ選択肢だけを再送可能にする。
   */
  const [pendingAnswer, setPendingAnswer] = useState<Answer | null>(null)

  // ⚠ コールバックを effect / useCallback の依存に入れない。親が毎レンダリングで
  // 新しい関数を渡すと出題の取得が繰り返される（M2 で踏んだ二重送信と同じ形）
  const contextRef = useRef(onSessionContext)
  useEffect(() => {
    contextRef.current = onSessionContext
  })

  const loadQuestion = useCallback(async () => {
    setPhase({ kind: 'loading' })
    setSubmitError(null)
    setPendingAnswer(null)
    try {
      const response = await fetch(`/api/session/${sessionId}/question`)
      if (response.status === 403) {
        setPhase({ kind: 'error', message: EXPIRED_MESSAGE, recoverable: false })
        return
      }
      if (!response.ok) {
        setPhase({
          kind: 'error',
          message: `出題を取得できませんでした（${response.status}）。`,
          recoverable: true,
        })
        return
      }
      const body = await response.json()
      contextRef.current?.({ mode: body.mode as string, profileId: body.profileId as string })
      if (body.status === 'finished') {
        setPhase({ kind: 'finished' })
        return
      }
      setPhase({ kind: 'question', question: body.question as QuestionView })
    } catch {
      // ネットワーク断。セッションはサーバに残っているので、破棄せず再試行に誘導する
      setPhase({
        kind: 'error',
        message: '通信に失敗しました。電波の状態を確かめて、もう一度試してください。',
        recoverable: true,
      })
    }
  }, [sessionId])

  /**
   * セッション状態から画面を復元する（prd/06 §2.1）。初回表示・リロード・エラー再試行・
   * 409（進行ずれ）の追随は、すべてここを起点にする——**得点をサーバの値に合わせ直す**ので、
   * どの経路でもクライアントの積算ずれが残らない。
   *
   * 復元先の選び方: 現在の問題が未配信で直前の結果があれば**正解画面**
   * （回答直後にリロードしても、検証ビューや 20 条件の表に戻れる。prd/04 §4）。それ以外は出題。
   */
  const bootstrap = useCallback(async () => {
    setPhase({ kind: 'loading' })
    setSubmitError(null)
    setPendingAnswer(null)
    try {
      const response = await fetch(`/api/session/${sessionId}`)
      if (response.status === 403) {
        setPhase({ kind: 'error', message: EXPIRED_MESSAGE, recoverable: false })
        return
      }
      if (!response.ok) {
        setPhase({
          kind: 'error',
          message: `セッションの状態を取得できませんでした（${response.status}）。`,
          recoverable: true,
        })
        return
      }
      const state = (await response.json()) as SessionStateResponse
      contextRef.current?.({ mode: state.mode, profileId: state.profileId })
      setScore(state.score)
      if (state.status === 'finished') {
        setPhase({ kind: 'finished' })
        return
      }
      if (!state.currentServed && state.lastQuestion && state.lastResult) {
        setPhase({ kind: 'result', question: state.lastQuestion, result: state.lastResult })
        return
      }
      await loadQuestion()
    } catch {
      setPhase({
        kind: 'error',
        message: '通信に失敗しました。電波の状態を確かめて、もう一度試してください。',
        recoverable: true,
      })
    }
  }, [sessionId, loadQuestion])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  /**
   * 🔒 送るのは**どちらを選んだかだけ**（prd/04 §2）。経過時間はサーバが `served_at` から測る。
   * ⚠ **制限時間は無い**（prd/04 §5.1）。自動送信の経路も無く、送信は必ずクリック起点。
   */
  async function submit(question: QuestionView, chosen: Answer) {
    // 二重クリックで同じ問題に 2 回 POST するのを防ぐ
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const response = await fetch(`/api/session/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: question.questionId, answer: chosen }),
      })

      if (response.status === 403) {
        setPhase({ kind: 'error', message: EXPIRED_MESSAGE, recoverable: false })
        return
      }
      if (response.status === 429) {
        // 最短回答時間（prd/04 §5.2）。セッションは無傷なので、そのまま答え直せる
        setSubmitError(
          'その速さでは受け付けられませんでした。画像をもう少し見てから答えてください。',
        )
        return
      }
      if (response.status === 409) {
        // 手元とサーバの進行がずれている（別タブで回答した等）。状態を取り直して追随する
        // （bootstrap は得点もサーバの値に合わせ直す）
        await bootstrap()
        return
      }
      if (!response.ok) {
        setSubmitError(`回答を送れませんでした（${response.status}）。もう一度お試しください。`)
        return
      }

      const result: AnswerResult = await response.json()
      setPendingAnswer(null)
      setScore((current) => current + result.awardedPoints)
      setPhase({ kind: 'result', question, result })
    } catch {
      // 送信か応答のどちらかが落ちた。サーバ側は受理済みかもしれないが、
      // 同一回答の再送には保存済みの結果が返る（冪等）ので、同じ選択肢の押し直しで回復できる。
      // 反対の選択肢は pendingAnswer で塞ぐ（上のコメント参照）
      setPendingAnswer(chosen)
      setSubmitError(
        `通信に失敗しました。「${chosen === 'png' ? 'PNG' : 'JPEG'}」をもう一度押すと、安全に再送されます。`,
      )
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (phase.kind === 'loading' || phase.kind === 'error' || phase.kind === 'finished') {
    return (
      <div className="flex flex-1 flex-col">
        <Narrow>
          {/* 進行の無い画面でも、条件表示と About への導線（header）は失わない */}
          {header}
          <div className="mt-6">
            {phase.kind === 'loading' ? <p className="text-ink-faint">読み込み中…</p> : null}

            {phase.kind === 'error' ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-wrong">{phase.message}</p>
                {phase.recoverable ? (
                  <>
                    {/* 🔑 セッションはサーバに残っている。既定の出口は「破棄」ではなく「再試行」 */}
                    <button
                      type="button"
                      onClick={() => void bootstrap()}
                      className="rounded bg-ink px-6 py-3 font-bold text-ground hover:bg-ink-muted"
                    >
                      もう一度試す
                    </button>
                    <a className="text-ink-muted text-sm underline" href="/">
                      新しく始める（この回の得点と進行は失われます）
                    </a>
                  </>
                ) : (
                  // cookie が無い（403）。この回には戻れないので、新規開始だけを出す
                  <a
                    className="rounded bg-ink px-6 py-3 font-bold text-ground hover:bg-ink-muted"
                    href="/"
                  >
                    新しく始める
                  </a>
                )}
              </div>
            ) : null}

            {phase.kind === 'finished' ? (
              <div className="flex flex-col items-start gap-4">
                <h2 className="font-bold text-2xl">おしまい</h2>
                <p className="text-ink-muted">
                  全問終わりました（{score.toFixed(2)} 点）。ランキングへの登録は M3 で実装します。
                </p>
                <a
                  className="rounded bg-ink px-6 py-3 font-bold text-ground hover:bg-ink-muted"
                  href="/"
                >
                  もう一度遊ぶ
                </a>
              </div>
            ) : null}
          </div>
        </Narrow>
      </div>
    )
  }

  const { question } = phase

  return (
    // flex-1 と下の mt-auto で、内容が短いときも 2 択ボタンが画面下端に来る
    // （モバイルでは画像が縦に余るので、そうしないとボタンが宙に浮く）
    <div className="flex flex-1 flex-col gap-6">
      <Narrow>
        <div className="flex items-baseline justify-between text-ink-faint text-sm">
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
        <>
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
          {/* 🔒 出してよいのは「拡大できる」ことだけ。倍率も寸法も答えの方向を示さない（prd/04 §3.5） */}
          <ZoomHint
            label="拡大して細部を見る"
            onOpen={() =>
              setZoom({
                sources: [{ label: '出題画像', url: question.displayUrl, alt: '出題画像' }],
                index: 0,
              })
            }
          />
        </>
      ) : null}

      {phase.kind === 'question' ? (
        // 🔒 画像が縦に長くてもボタンを見せ続け、「全体を見ないまま答える」流れを作らない（prd/01 §7.1）
        <div className="sticky bottom-0 z-10 mt-auto border-line border-t bg-ground/95 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <Narrow>
            {/* 送信の失敗はここに出す。ボタンは生きたままなので、押し直せばそのまま再送になる */}
            {submitError ? <p className="mb-2 text-sm text-wrong">{submitError}</p> : null}
            <div className="flex gap-3">
              {/* 応答不明の間は、送った側だけを再送可能にする（pendingAnswer の説明を参照） */}
              <button
                type="button"
                disabled={submitting || (pendingAnswer !== null && pendingAnswer !== 'png')}
                onClick={() => void submit(question, 'png')}
                className="flex-1 rounded border border-line-strong px-6 py-4 text-lg font-bold hover:bg-sunken disabled:opacity-50"
              >
                PNG
              </button>
              <button
                type="button"
                disabled={submitting || (pendingAnswer !== null && pendingAnswer !== 'jpeg')}
                onClick={() => void submit(question, 'jpeg')}
                className="flex-1 rounded border border-line-strong px-6 py-4 text-lg font-bold hover:bg-sunken disabled:opacity-50"
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
            result.correct ? 'text-xl font-bold text-correct' : 'text-xl font-bold text-wrong'
          }
        >
          {result.correct ? '正解' : '不正解'} — 小さいのは {winner} でした
          {result.awardedPoints > 0 ? (
            <span className="ml-2 text-base text-ink-muted">
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

      {/* 🔑 2 枚の比較はレイアウトではなくダイアログが担う（prd/01 §7.3）。
          横並びにするより、**同じ位置で切り替える**ほうが人間の目には差が見える */}
      <ZoomHint
        label="2 枚を同じ位置で切り替えて比べる"
        onOpen={() => onZoom({ sources, index: 0 })}
      />

      <Narrow>
        <p className="text-ink-muted text-sm">
          サイズ比 log2(PNG/JPEG) = {result.log2Ratio.toFixed(2)}
          {result.explanation ? ` — ${result.explanation}` : ''}
        </p>
      </Narrow>

      {/* データの面は lg で広げる。読み物は 720px のまま（prd/01 §7.1） */}
      <Narrow wide>
        <div className="flex flex-col gap-4">
          <VerificationPanel result={result} />
          <ProfileResultsTable results={result.profileResults} />
        </div>
      </Narrow>

      <Narrow>
        <div className="flex flex-col gap-4">
          <details className="text-ink-muted text-sm">
            <summary className="cursor-pointer">出典とライセンス</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-sunken p-3 text-xs">
              {JSON.stringify(result.source, null, 2)}
            </pre>
          </details>

          <p className="text-ink-faint text-xs">
            ⚠ サイズだけで選ぶものではありません（劣化・透過・用途）。とくに僅差のときは。
          </p>

          <button
            type="button"
            onClick={onNext}
            className="self-start rounded bg-ink px-6 py-3 font-bold text-ground hover:bg-ink-muted"
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
    <section className="flex flex-col gap-2 rounded border border-line p-4">
      <h3 className="font-bold text-sm">JPEG は「どこを」「どれだけ」壊したか</h3>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['de00', 'ssim'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setMetric(option)}
            className={
              metric === option
                ? 'rounded bg-ink px-3 py-1 font-medium text-ground'
                : 'rounded border border-line-strong px-3 py-1 text-ink-muted'
            }
          >
            {option === 'de00' ? 'ΔE00（色の差）' : 'SSIM（構造の差）'}
          </button>
        ))}
        <span className="text-ink-muted text-xs">
          品質 {current.jpegQuality} / {current.chromaSubsampling}
          {current === answered ? '（回答した条件）' : ''}
        </span>
      </div>

      <img
        src={metric === 'de00' ? current.de00Url : current.ssimUrl}
        alt={`${metric === 'de00' ? 'ΔE00' : 'SSIM'} の劣化オーバーレイ`}
        className="rounded border border-line"
      />

      <p className="text-ink-muted text-xs">
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
        <p className="text-ink-muted text-sm">
          この条件では <strong>{current.over2Pct.toFixed(1)}%</strong> の画素が ΔE00 &gt; 2
          （目で違いが分かる目安）を超えています。
        </p>
      ) : null}

      {others.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted">
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
                      ? 'rounded bg-ink px-2 py-1 font-mono text-ground text-xs'
                      : 'rounded border border-line-strong px-2 py-1 font-mono text-ink-muted text-xs'
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
      <summary className="cursor-pointer text-ink-muted">
        他の条件ならどうなるか（{results.length} 通り
        {flipped.size > 0 ? ` — うち ${flipped.size} 通りで答えが変わる` : ''}）
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-line-strong border-b text-left">
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
                    ? 'border-line border-b bg-sunken font-medium'
                    : 'border-line border-b'
                }
              >
                <td className="py-1 pr-3 font-mono">
                  {row.profileId}
                  {row.isStandard ? <span className="ml-1 text-ink-faint">（標準）</span> : null}
                  {row.isSelected ? <span className="ml-1 text-accent">← 今回</span> : null}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {row.pngBytes.toLocaleString('ja-JP')}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {row.jpegBytes.toLocaleString('ja-JP')}
                </td>
                <td className={flipped.has(row.profileId) ? 'py-1 text-wrong' : 'py-1'}>
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
