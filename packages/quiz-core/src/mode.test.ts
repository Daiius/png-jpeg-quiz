import { describe, expect, it } from 'vitest'
import { HINT_PENALTY_RATE } from './hint.ts'
import {
  classifyTiming,
  defaultModeForPool,
  findMode,
  type LockedForSettle,
  MIN_ANSWER_MS,
  type ModeState,
  type PoolEntry,
  practice,
  type SettleOutcome,
  STANDARD_30_QUESTION_COUNT,
  settleAnswer,
  standard30,
  targetDifficulty,
} from './mode.ts'

function pool(...difficulties: number[]): PoolEntry[] {
  return difficulties.map((difficulty, i) => ({
    questionId: `q${i}`,
    difficulty,
    answer: 'jpeg' as const,
  }))
}

function state(overrides: Partial<ModeState> = {}): ModeState {
  return {
    index: 0,
    questionCount: 5,
    usedQuestionIds: [],
    correctCount: 0,
    streak: 0,
    ...overrides,
  }
}

describe('targetDifficulty', () => {
  it('最初は易しく、最後は最難に向かう', () => {
    expect(targetDifficulty(0, 30)).toBe(0)
    expect(targetDifficulty(29, 30)).toBe(1)
  })

  it('単調に上がる', () => {
    let previous = -1
    for (let i = 0; i < 30; i++) {
      const value = targetDifficulty(i, 30)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('1 問だけのときは 0（ゼロ除算しない）', () => {
    expect(targetDifficulty(0, 1)).toBe(0)
  })
})

describe('standard30.pickNext', () => {
  it('易しい順に出す（難易度カーブ）', () => {
    const entries = pool(0, 0.25, 0.5, 0.75, 1)
    const used: string[] = []
    const picked: number[] = []

    for (let index = 0; index < 5; index++) {
      const next = standard30.pickNext(state({ index, usedQuestionIds: used }), entries)
      expect(next).not.toBeNull()
      if (!next) break
      used.push(next.questionId)
      picked.push(next.difficulty)
    }

    expect(picked).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('同じ問題を二度出さない', () => {
    const entries = pool(0.5, 0.5, 0.5)
    const first = standard30.pickNext(state(), entries)
    expect(first).not.toBeNull()
    const second = standard30.pickNext(
      state({ index: 1, usedQuestionIds: [first?.questionId ?? ''] }),
      entries,
    )
    expect(second?.questionId).not.toBe(first?.questionId)
  })

  it('候補が尽きたら null（終了）', () => {
    const entries = pool(0.5)
    expect(standard30.pickNext(state({ usedQuestionIds: ['q0'] }), entries)).toBeNull()
  })

  it('問題数に達したら null', () => {
    expect(standard30.pickNext(state({ index: 5, questionCount: 5 }), pool(0.5))).toBeNull()
  })

  it('選択が決定的（同じ状態なら同じ問題）', () => {
    const entries = pool(0.5, 0.5, 0.5)
    const a = standard30.pickNext(state(), entries)
    const b = standard30.pickNext(state(), entries)
    expect(a?.questionId).toBe(b?.questionId)
  })
})

describe('standard30.questionCount', () => {
  it('🔒 常に 30 問（prd/06 §2）。プールが足りなくても短くしない', () => {
    expect(standard30.questionCount(200)).toBe(30)
    expect(standard30.questionCount(22)).toBe(30)
    expect(standard30.questionCount(0)).toBe(30)
  })
})

describe('practice', () => {
  it('プールに合わせて短くする（standard-30 とは別モード）', () => {
    expect(practice.questionCount(22)).toBe(22)
    expect(practice.questionCount(200)).toBe(30)
  })

  it('ID が standard-30 と混ざらない', () => {
    expect(practice.id).not.toBe(standard30.id)
    expect(findMode('practice')?.id).toBe('practice')
  })

  it('出題選択は standard-30 と同じカーブ', () => {
    const entries = pool(0, 0.5, 1)
    const state5 = { ...state({ questionCount: 3 }) }
    expect(practice.pickNext(state5, entries)?.questionId).toBe(
      standard30.pickNext(state5, entries)?.questionId,
    )
  })
})

describe('defaultModeForPool', () => {
  it('🔒 プールが 30 問未満なら practice。standard-30 を短くしない（prd/06 §2.1）', () => {
    expect(defaultModeForPool(0).id).toBe('practice')
    expect(defaultModeForPool(21).id).toBe('practice')
    expect(defaultModeForPool(STANDARD_30_QUESTION_COUNT - 1).id).toBe('practice')
  })

  it('30 問ちょうどから standard-30', () => {
    expect(defaultModeForPool(STANDARD_30_QUESTION_COUNT).id).toBe('standard-30')
    expect(defaultModeForPool(200).id).toBe('standard-30')
  })

  it('選ばれたモードの問題数はプールに収まる（開始が 409 にならない）', () => {
    for (const poolSize of [1, 5, 21, 29, 30, 31, 200]) {
      const mode = defaultModeForPool(poolSize)
      expect(mode.questionCount(poolSize)).toBeLessThanOrEqual(poolSize)
    }
  })
})

describe('モードの色数ヒント設定（prd/06 §7.4）', () => {
  const base = { correct: true, answer: 'png', difficulty: 0.5, pngWinRate: 0.48 } as const

  it('standard-30 は一律 ×0.5 の減点つきで許可する', () => {
    expect(standard30.hint).toEqual({ kind: 'color-count-range', penaltyRate: HINT_PENALTY_RATE })
    const full = standard30.score(base)
    expect(standard30.score({ ...base, hintUsed: true })).toBeCloseTo(full * 0.5, 10)
  })

  it('practice は減点なしで許可する（ランキングに載らない）', () => {
    expect(practice.hint).toEqual({ kind: 'color-count-range', penaltyRate: 0 })
    expect(practice.score({ ...base, hintUsed: true })).toBe(practice.score(base))
  })

  it('ヒント未使用の得点はこれまでと変わらない', () => {
    expect(standard30.score(base)).toBe(practice.score(base))
    expect(standard30.score(base)).toBeGreaterThan(0)
  })
})

describe('settleAnswer（ヒントと回答の直列化。prd/06 §7.3 / OCL-FC970B81）', () => {
  const scoreInput = { correct: true, answer: 'png', difficulty: 0.5, pngWinRate: 0.48 } as const
  const locked = (overrides: Partial<LockedForSettle> = {}): LockedForSettle => ({
    answeredAt: null,
    hintUsedAt: null,
    ...overrides,
  })
  const full = standard30.score(scoreInput)
  /** `award` を前提にした得点の取り出し（union を絞る） */
  const points = (outcome: SettleOutcome): number => {
    if (outcome.status !== 'award') throw new Error(`award ではない: ${outcome.status}`)
    return outcome.awardedPoints
  }

  it('ヒント未使用なら満額', () => {
    expect(settleAnswer(standard30, locked(), scoreInput)).toEqual({
      status: 'award',
      hintUsed: false,
      awardedPoints: full,
    })
  })

  it('🔒 /hint が先に確定していたら減点が効く（ロック内で読み直した値で採点する）', () => {
    const outcome = settleAnswer(standard30, locked({ hintUsedAt: new Date() }), scoreInput)
    expect(outcome).toEqual({
      status: 'award',
      hintUsed: true,
      awardedPoints: full * (1 - HINT_PENALTY_RATE),
    })
  })

  it('🔒 ロック前の古い読み取りでは満額になる並行順序でも、ロック後の値なら減点される', () => {
    // 回答の受付が始まった時点（ロック前）の断面。まだ /hint は commit されていない
    const beforeLock = locked()
    // ロックを取ってから読み直した断面。この間に /hint が commit された
    const afterLock = locked({ hintUsedAt: new Date() })
    // ⚠ 古い断面で採点すると満額が保存され、50% 減点をすり抜ける（これが OCL-FC970B81）
    expect(points(settleAnswer(standard30, beforeLock, scoreInput))).toBe(full)
    // 🔒 ロック後の断面を渡す限り、先に確定した /hint の減点は必ず効く
    expect(points(settleAnswer(standard30, afterLock, scoreInput))).toBeCloseTo(
      full * (1 - HINT_PENALTY_RATE),
      10,
    )
  })

  it('🔒 回答が先に確定していたら受け付けない（二重採点しない）', () => {
    // 逆向きの先勝ち: 回答が先なら /hint 側は decideHint が reject-answered を返す
    expect(settleAnswer(standard30, locked({ answeredAt: new Date() }), scoreInput)).toEqual({
      status: 'already-answered',
    })
    expect(
      settleAnswer(
        standard30,
        locked({ answeredAt: new Date(), hintUsedAt: new Date() }),
        scoreInput,
      ),
    ).toEqual({ status: 'already-answered' })
  })

  it('practice では減点なし（モード定義の定率をそのまま使う）', () => {
    const outcome = settleAnswer(practice, locked({ hintUsedAt: new Date() }), scoreInput)
    expect(outcome).toEqual({
      status: 'award',
      hintUsed: true,
      awardedPoints: practice.score(scoreInput),
    })
  })

  it('不正解・偏りきったプールは 0 点（-log2(0) の発散を採点に持ち込まない）', () => {
    expect(points(settleAnswer(standard30, locked(), { ...scoreInput, correct: false }))).toBe(0)
    for (const pngWinRate of [0, 1]) {
      expect(points(settleAnswer(standard30, locked(), { ...scoreInput, pngWinRate }))).toBe(0)
    }
  })
})

describe('findMode', () => {
  it('standard-30 を引ける', () => {
    expect(findMode('standard-30')?.allowProfileChoice).toBe(true)
    expect(findMode('endless')).toBeUndefined()
  })
})

describe('classifyTiming', () => {
  it('人間に不可能な速さを弾く（prd/04 §5）', () => {
    expect(classifyTiming(0)).toBe('too-fast')
    expect(classifyTiming(MIN_ANSWER_MS - 1)).toBe('too-fast')
    expect(classifyTiming(MIN_ANSWER_MS)).toBe('ok')
  })

  it('⚠ 上限は無い（制限時間は廃止。prd/04 §5.1）', () => {
    expect(classifyTiming(20_000)).toBe('ok')
    expect(classifyTiming(60 * 60 * 1000)).toBe('ok')
  })
})
