'use client'

import { STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { ProfileChoice } from '@/profiles.ts'

/**
 * 条件を選んでセッションを開始する（prd/06 §2）。
 *
 * 🔒 **プロファイルはセッション開始時に固定**され、途中で変えられない（prd/04 §2）。
 * ここに出す `pngWinRate` は**プロファイル全体の偏り**であって、個別問題については何も語らない
 * ——だから公開してよいし、むしろ戦略の材料になる（prd/04 §3.5）。
 */
export function StartPanel() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<ProfileChoice[] | null>(null)
  const [selected, setSelected] = useState(STANDARD_PROFILE_ID)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/profiles')
      .then((response) => response.json())
      .then((body: { profiles: ProfileChoice[] }) => {
        if (cancelled) return
        setProfiles(body.profiles)
        // 標準が遊べない状態なら、遊べるものの先頭に寄せる
        const standard = body.profiles.find((profile) => profile.id === STANDARD_PROFILE_ID)
        if (!standard?.playable) {
          const fallback = body.profiles.find((profile) => profile.playable)
          if (fallback) setSelected(fallback.id)
        }
      })
      .catch(() => {
        if (!cancelled) setError('条件の一覧を取得できませんでした')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function start() {
    setStarting(true)
    setError(null)
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'standard-30', profileId: selected }),
      })
      if (!response.ok) {
        setError(`開始できませんでした（${response.status}）`)
        return
      }
      const body = await response.json()
      router.push(`/play?session=${body.sessionId}`)
    } finally {
      setStarting(false)
    }
  }

  const playable = profiles?.filter((profile) => profile.playable) ?? []
  const current = profiles?.find((profile) => profile.id === selected)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="profile" className="font-medium text-sm">
          エンコード条件
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

      <button
        type="button"
        disabled={starting || playable.length === 0}
        onClick={() => void start()}
        className="self-start rounded bg-slate-900 px-8 py-4 font-bold text-lg text-white hover:bg-slate-700 disabled:opacity-50"
      >
        はじめる
      </button>
      {error ? <p className="text-red-600 text-sm">{error}</p> : null}
    </div>
  )
}
