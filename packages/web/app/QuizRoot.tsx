'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AboutSection } from './AboutSection.tsx'
import { ProfileDialog } from './ProfileDialog.tsx'
import { QuizClient } from './QuizClient.tsx'

/**
 * トップページの本体（prd/06 §2.1）。
 *
 * - **開いた瞬間にセッションを作って出題する**（`?session=` があればそれを継続）。
 * - 条件の変更はダイアログ。⚠ プロファイルはセッション開始時に固定なので、
 *   **変更は「新しいセッションを開始する」こと**（prd/04 §2）。
 * - サイトの説明は画面下部（`AboutSection`）。出題画面は常に 1 画面ぶんを占める。
 */
export function QuizRoot({ initialSessionId }: { initialSessionId: string | null }) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 二重起動でセッションを 2 つ作らない（開発時の StrictMode でも effect は 2 回走る）
  const startingRef = useRef(false)
  // 🔒 開始をやめたときに、後から来た応答で進行中のセッションを置き換えないための中止装置
  const abortRef = useRef<AbortController | null>(null)

  /**
   * セッションを開始する。`profileId` を省略すると**サーバが既定を選ぶ**（prd/06 §2.1）。
   * 🔒 モードもサーバが決める（プールが 30 問に満たなければ practice）。
   *
   * ⚠ **成否を返す。** 条件変更から呼ぶときは、失敗したらダイアログを閉じてはいけない
   * （既存セッションが残っているので、閉じるとエラーの行き場が無くなる）。
   *
   * 🔒 **中止されたら、成功していても反映しない。** 条件変更をやめた後に応答が届くと、
   * いま遊んでいるセッションと URL を黙って差し替えてしまう（得点と進行が消える）。
   */
  const start = useCallback(async (chosenProfileId?: string): Promise<boolean> => {
    if (startingRef.current) return false
    startingRef.current = true
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chosenProfileId === undefined ? {} : { profileId: chosenProfileId }),
        signal: controller.signal,
      })
      if (!response.ok) {
        setError(`はじめられませんでした（${response.status}）`)
        return false
      }
      const body = await response.json()
      // 応答を読み終えるまでの間にやめられていたら、ここから先は触らない
      if (controller.signal.aborted) return false
      setSessionId(body.sessionId as string)
      setProfileId(body.profileId as string)
      // 🔒 リロードで同じセッションに戻れるようにする（prd/06 §2.1）。
      // ⚠ router.replace ではなく history API。ページを再レンダリングさせない
      window.history.replaceState(null, '', `/?session=${encodeURIComponent(body.sessionId)}`)
      return true
    } catch {
      // ⚠ 自分で中止したときは失敗ではない。エラーを出さずに黙って引き下がる
      if (!controller.signal.aborted) setError('はじめられませんでした（通信エラー）')
      return false
    } finally {
      startingRef.current = false
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  useEffect(() => {
    if (sessionId === null) void start()
  }, [sessionId, start])

  return (
    <main className="flex flex-col">
      {/* 出題画面は必ず 1 画面ぶん。説明はその下へスクロールして到達する */}
      <div className="flex min-h-dvh flex-col gap-6 py-6">
        {sessionId === null ? (
          <StartingPlaceholder error={error} onRetry={() => void start()} />
        ) : (
          <QuizClient
            // 条件を変えると別のセッションになる。得点も進行も作り直す
            key={sessionId}
            sessionId={sessionId}
            onSessionContext={(context) => setProfileId(context.profileId)}
            header={
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                <span className="text-slate-500">条件</span>
                <span className="font-mono text-slate-700">{profileId ?? '…'}</span>
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50"
                >
                  変える
                </button>
                <a href="#about" className="ml-auto text-slate-500 underline">
                  このクイズについて ↓
                </a>
              </div>
            }
          />
        )}
      </div>

      <AboutSection profileId={profileId} onChangeProfile={() => setDialogOpen(true)} />

      {dialogOpen ? (
        <ProfileDialog
          currentProfileId={profileId}
          // 🔒 **成功したときだけ閉じる。** 先に閉じると、失敗しても既存セッションが
          // 表示されたままなので「何も起きなかった」ようにしか見えない
          onStart={async (chosen) => {
            if (await start(chosen)) setDialogOpen(false)
          }}
          startError={error}
          // 🔒 開始中に閉じたら中止する。放っておくと、閉じた後に届いた応答が
          // 進行中のセッションを差し替える（OCL-44744DDD）
          onClose={() => {
            abortRef.current?.abort()
            setError(null)
            setDialogOpen(false)
          }}
        />
      ) : null}
    </main>
  )
}

/**
 * セッションを作っている間の代役。**出題画面と同じ骨格**を出す。
 * ⚠ ここで「はじめる」ボタンを出さない。押させないことがこの設計の主眼（prd/06 §2.1）。
 */
function StartingPlaceholder({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="mx-auto w-full max-w-3xl px-6">
        <p className="text-slate-500 text-sm">{error ? 'エラー' : '出題を準備しています…'}</p>
        <p className="mt-2 font-medium">
          この画像を PNG と JPEG にすると、<strong>小さいのはどちら？</strong>
        </p>
        {error ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <p className="text-red-600 text-sm">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded bg-slate-900 px-6 py-3 font-bold text-white hover:bg-slate-700"
            >
              やり直す
            </button>
          </div>
        ) : null}
      </div>

      {!error ? <div className="h-64 w-full animate-pulse bg-slate-100" /> : null}
    </div>
  )
}
