'use client'

import { STANDARD_PROFILE_ID } from '@png-jpeg-quiz/quiz-core'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * セッションを開始してクイズ画面へ移る。
 * TODO(spec): プロファイル選択 UI は M2（prd/06 §2）。M1 は標準条件に固定する。
 */
export function StartButton() {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setStarting(true)
    setError(null)
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'standard-30', profileId: STANDARD_PROFILE_ID }),
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

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={starting}
        onClick={() => void start()}
        className="self-start rounded bg-slate-900 px-8 py-4 text-lg font-bold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        はじめる
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  )
}
