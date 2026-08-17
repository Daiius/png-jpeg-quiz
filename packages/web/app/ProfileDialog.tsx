'use client'

import { STANDARD_30_QUESTION_COUNT, STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { useEffect, useRef, useState } from 'react'
import type { ProfileChoice } from '@/profiles.ts'

/**
 * エンコード条件を選び直すダイアログ（prd/06 §2.1）。
 *
 * 🔒 **プロファイルはセッション開始時に固定**され、途中では変えられない（prd/04 §2）。
 * だからここでの決定は**新しいセッションの開始**であって、進行中のものは捨てられる。
 * その一点を画面に書いておくこと。
 *
 * ここに出す `pngWinRate` は**プロファイル全体の偏り**であって、個別問題については何も語らない
 * ——だから公開してよいし、むしろ戦略の材料になる（prd/04 §3.5）。
 */
export function ProfileDialog({
  currentProfileId,
  onStart,
  onClose,
}: {
  currentProfileId: string | null
  onStart: (profileId: string) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [profiles, setProfiles] = useState<ProfileChoice[] | null>(null)
  const [selected, setSelected] = useState(currentProfileId ?? STANDARD_PROFILE_ID)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/profiles')
      .then((response) => response.json())
      .then((body: { profiles: ProfileChoice[] }) => {
        if (cancelled) return
        setProfiles(body.profiles)
        // いま選ばれているものが遊べない状態なら、遊べるものの先頭に寄せる
        setSelected((current) => {
          const found = body.profiles.find((profile) => profile.id === current)
          if (found?.playable) return current
          return body.profiles.find((profile) => profile.playable)?.id ?? current
        })
      })
      .catch(() => {
        if (!cancelled) setError('条件の一覧を取得できませんでした')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const playable = profiles?.filter((profile) => profile.playable) ?? []
  const current = profiles?.find((profile) => profile.id === selected)

  /**
   * 🔒 **`standard-30` を短くしない**（prd/06 §2）。30 問という前提にランキングが乗っている。
   * プールが足りない条件では、**別モード**の練習として遊んでもらう（モードはサーバが決める）。
   */
  const shortPool = current !== undefined && current.poolSize < STANDARD_30_QUESTION_COUNT

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded border border-slate-200 p-0 backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-lg">エンコード条件を変える</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <p className="text-slate-600 text-sm">
          「どちらが小さいか」は<strong>条件次第で変わります</strong>。 20
          通りを事前に計算してあるので、選び直して確かめられます。
        </p>

        <div className="flex flex-col gap-2">
          <label htmlFor="profile" className="font-medium text-sm">
            条件
          </label>
          <select
            id="profile"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={!profiles || playable.length === 0}
            className="rounded border border-slate-300 px-3 py-2 font-mono text-sm"
          >
            {playable.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.id}
                {profile.isStandard ? '（標準）' : ''} — PNG 勝率{' '}
                {(profile.pngWinRate * 100).toFixed(0)}%
              </option>
            ))}
          </select>

          {current ? (
            <p className="text-slate-600 text-xs">
              {current.label} ／ 出題プール {current.poolSize} 問
            </p>
          ) : null}

          {shortPool ? (
            <p className="text-amber-800 text-xs">
              ⚠ この条件の問題は {current?.poolSize} 問しかないため、
              <strong>練習モード（{current?.poolSize} 問）</strong>で始まります。 ランキング用の{' '}
              {STANDARD_30_QUESTION_COUNT} 問モードは、素材が増えたら選べるようになります。
            </p>
          ) : null}

          {profiles && playable.length < profiles.length ? (
            <p className="text-slate-500 text-xs">
              ⚠ {profiles.length - playable.length} 条件は、いまの問題プールでは答えが片方に
              寄りきっているため選べません（素材が増えると解放されます）。
            </p>
          ) : null}
        </div>

        <p className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600 text-xs">
          少数派を当てるほど高得点です。偏った条件はハイリスク・ハイリターンで、
          <strong>期待値は 50:50 に近い条件が最大</strong>
          になります。条件が違っても同じランキングに載ります。
        </p>

        {/* 🔒 途中変更ではないことを明示する（prd/04 §2） */}
        <p className="text-amber-800 text-xs">
          ⚠ 条件はセッション開始時に固定されます。ここで始め直すと
          <strong>いま遊んでいる回の得点と進行は破棄されます</strong>。
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={playable.length === 0}
            onClick={() => onStart(selected)}
            className="rounded bg-slate-900 px-6 py-3 font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            この条件で始め直す
          </button>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="text-slate-600 text-sm underline"
          >
            やめる
          </button>
        </div>
        {error ? <p className="text-red-600 text-sm">{error}</p> : null}
      </div>
    </dialog>
  )
}
