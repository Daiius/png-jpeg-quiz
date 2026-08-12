import { describe, expect, it } from 'vitest'
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
