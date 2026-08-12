import { describe, expect, it } from 'vitest'
import { answerFor, log2Ratio, staticDifficulty } from './difficulty.ts'

describe('log2Ratio', () => {
  it('PNG が半分なら -1、倍なら +1', () => {
    expect(log2Ratio(500, 1000)).toBe(-1)
    expect(log2Ratio(1000, 500)).toBe(1)
  })

  it('実測値を再現する（commons-vector-space 相当の超拮抗）', () => {
    // prd/_grilling/measurements.md §6.2: log2r 0.15 付近
    expect(log2Ratio(11_100, 10_000)).toBeCloseTo(0.15, 2)
  })

  it('0 以下・非有限のバイト数を拒否する', () => {
    expect(() => log2Ratio(0, 100)).toThrow(RangeError)
    expect(() => log2Ratio(100, -1)).toThrow(RangeError)
    expect(() => log2Ratio(Number.NaN, 100)).toThrow(RangeError)
  })
})

describe('answerFor', () => {
  it('小さいほうが正解', () => {
    expect(answerFor(1_111, 5_596)).toBe('png')
    expect(answerFor(383_968, 150_899)).toBe('jpeg')
  })

  it('同点は問題にしない（null）', () => {
    expect(answerFor(1_000, 1_000)).toBeNull()
  })
})

describe('staticDifficulty', () => {
  it('拮抗しているほど高い', () => {
    expect(staticDifficulty(0)).toBe(1)
    expect(staticDifficulty(0.11)).toBeGreaterThan(staticDifficulty(1.11))
    expect(staticDifficulty(1.11)).toBeGreaterThan(staticDifficulty(4.65))
  })

  it('符号によらない（PNG 勝ち・JPEG 勝ちで対称）', () => {
    expect(staticDifficulty(-0.75)).toBe(staticDifficulty(0.75))
  })

  it('飽和点を超えたら 0 に張り付く', () => {
    expect(staticDifficulty(4)).toBe(0)
    expect(staticDifficulty(4.65)).toBe(0)
    expect(staticDifficulty(100)).toBe(0)
  })

  it('常に [0, 1] に収まる', () => {
    for (const r of [-9, -4.65, -0.23, 0, 0.15, 3.54, 9]) {
      const d = staticDifficulty(r)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })

  it('非有限を拒否する', () => {
    expect(() => staticDifficulty(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
