import { describe, expect, it } from 'vitest'
import {
  classifyTiming,
  findMode,
  MIN_ANSWER_MS,
  type ModeState,
  type PoolEntry,
  QUESTION_TIME_LIMIT_MS,
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
  it('プールが十分なら 30 問（prd/06 §2）', () => {
    expect(standard30.questionCount(200)).toBe(30)
  })

  it('プールが足りなければ在庫に合わせる', () => {
    expect(standard30.questionCount(22)).toBe(22)
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

  it('制限時間を過ぎたら時間切れ（不正解扱い）', () => {
    expect(classifyTiming(QUESTION_TIME_LIMIT_MS)).toBe('ok')
    expect(classifyTiming(QUESTION_TIME_LIMIT_MS + 1)).toBe('timed-out')
  })
})
