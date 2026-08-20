import { describe, expect, it } from 'vitest'
import { HINT_PENALTY_RATE, type HintConfig } from './hint.ts'
import {
  answerProbability,
  difficultyWeight,
  expectedSurprisal,
  scoreQuestion,
  surprisal,
} from './score.ts'

describe('surprisal', () => {
  it('prd/06 §1 の例を再現する（q60 は PNG 勝ち 30%）', () => {
    // JPEG を当てても -log2(0.7) = 0.51 点
    expect(surprisal(answerProbability(0.3, 'jpeg'))).toBeCloseTo(0.51, 2)
    // PNG を見抜けば -log2(0.3) = 1.74 点
    expect(surprisal(answerProbability(0.3, 'png'))).toBeCloseTo(1.74, 2)
  })

  it('50:50 なら 1 bit', () => {
    expect(surprisal(0.5)).toBe(1)
  })

  it('確率 0 を拒否する（log が発散する）', () => {
    expect(() => surprisal(0)).toThrow(RangeError)
  })
})

describe('expectedSurprisal', () => {
  it('50:50 で最大になる（標準条件が期待値で有利）', () => {
    const standard = expectedSurprisal(0.48)
    expect(standard).toBeGreaterThan(expectedSurprisal(0.3))
    expect(standard).toBeGreaterThan(expectedSurprisal(0.59))
    expect(expectedSurprisal(0.5)).toBe(1)
  })

  it('偏った条件ほど期待値が下がる', () => {
    expect(expectedSurprisal(0.3)).toBeGreaterThan(expectedSurprisal(0.1))
  })
})

describe('scoreQuestion', () => {
  it('不正解は 0 点', () => {
    expect(scoreQuestion({ correct: false, answer: 'png', difficulty: 1, pngWinRate: 0.3 })).toBe(0)
  })

  it('少数派を当てるほど高い', () => {
    const base = { correct: true, difficulty: 0.5, pngWinRate: 0.3 } as const
    const rarePng = scoreQuestion({ ...base, answer: 'png' })
    const commonJpeg = scoreQuestion({ ...base, answer: 'jpeg' })
    expect(rarePng).toBeGreaterThan(commonJpeg)
  })

  it('拮抗している問題ほど高い', () => {
    const base = { correct: true, answer: 'png', pngWinRate: 0.48 } as const
    expect(scoreQuestion({ ...base, difficulty: 1 })).toBeGreaterThan(
      scoreQuestion({ ...base, difficulty: 0 }),
    )
  })

  it('易問でも 0 点にはならない（30 問の積み上げが効くように）', () => {
    expect(
      scoreQuestion({ correct: true, answer: 'png', difficulty: 0, pngWinRate: 0.48 }),
    ).toBeGreaterThan(0)
  })
})

describe('scoreQuestion（色数ヒント。prd/06 §7.2）', () => {
  const standardHint: HintConfig = { kind: 'color-count-range', penaltyRate: HINT_PENALTY_RATE }
  const base = { correct: true, answer: 'png', difficulty: 0.5, pngWinRate: 0.48 } as const

  it('ヒント使用で ×0.5（全問一律の定率）', () => {
    const full = scoreQuestion(base, standardHint)
    const hinted = scoreQuestion({ ...base, hintUsed: true }, standardHint)
    expect(hinted).toBeCloseTo(full * (1 - HINT_PENALTY_RATE), 10)
  })

  it('「見て正解」＞「見ずに不正解」（性質 1。対価を払って当てた人が失敗より下にならない）', () => {
    expect(scoreQuestion({ ...base, hintUsed: true }, standardHint)).toBeGreaterThan(0)
  })

  it('ヒントが答えを確定させても、期待値は当てずっぽうと同じ（性質 2）', () => {
    // 確定ヒント: 正解率 1 × 減点後 0.5 S。当てずっぽう: 正解率 0.5 × 満額 S
    const full = scoreQuestion(base, standardHint)
    const certainWithHint = 1 * scoreQuestion({ ...base, hintUsed: true }, standardHint)
    const coinFlip = 0.5 * full
    expect(certainWithHint).toBeCloseTo(coinFlip, 10)
  })

  it('不正解はヒントの有無に関係なく 0 点', () => {
    expect(scoreQuestion({ ...base, correct: false, hintUsed: true }, standardHint)).toBe(0)
  })

  it('ヒント未使用・設定なしでは満額のまま（後方互換）', () => {
    const full = scoreQuestion(base)
    expect(scoreQuestion({ ...base, hintUsed: false }, standardHint)).toBe(full)
    expect(scoreQuestion({ ...base, hintUsed: true }, null)).toBe(full)
  })

  it('practice の減点率 0 では減点されない', () => {
    const free: HintConfig = { kind: 'color-count-range', penaltyRate: 0 }
    expect(scoreQuestion({ ...base, hintUsed: true }, free)).toBe(scoreQuestion(base))
  })

  it('減点率 1 以上・負を拒否する（1 だと「見て正解」＝「見ずに不正解」になる）', () => {
    const all: HintConfig = { kind: 'color-count-range', penaltyRate: 1 }
    expect(() => scoreQuestion({ ...base, hintUsed: true }, all)).toThrow(RangeError)
    const negative: HintConfig = { kind: 'color-count-range', penaltyRate: -0.1 }
    expect(() => scoreQuestion({ ...base, hintUsed: true }, negative)).toThrow(RangeError)
  })
})

describe('difficultyWeight', () => {
  it('[0, 1] の外を拒否する', () => {
    expect(() => difficultyWeight(-0.1)).toThrow(RangeError)
    expect(() => difficultyWeight(1.1)).toThrow(RangeError)
  })
})

describe('answerProbability', () => {
  it('png と jpeg で足すと 1', () => {
    expect(answerProbability(0.48, 'png') + answerProbability(0.48, 'jpeg')).toBeCloseTo(1, 10)
  })

  it('0 / 1 の勝率を拒否する（その条件では出題が成立しない）', () => {
    expect(() => answerProbability(0, 'png')).toThrow(RangeError)
    expect(() => answerProbability(1, 'png')).toThrow(RangeError)
  })
})
