import { describe, expect, it } from 'vitest'
import {
  COLOR_RANGE_BOUNDARY,
  colorRange,
  decideHint,
  HINT_PENALTY_RATE,
  type HintConfig,
  type ServedForHint,
} from './hint.ts'

const config: HintConfig = { kind: 'color-count-range', penaltyRate: HINT_PENALTY_RATE }

function served(overrides: Partial<ServedForHint> = {}): ServedForHint {
  return { questionId: 'q1', answeredAt: null, hintUsedAt: null, ...overrides }
}

describe('colorRange', () => {
  it('境界は 256（prd/06 §7.1。可逆パレット化が届くか）', () => {
    expect(COLOR_RANGE_BOUNDARY).toBe(256)
    expect(colorRange(1)).toBe('le256')
    expect(colorRange(16)).toBe('le256')
    expect(colorRange(256)).toBe('le256')
    expect(colorRange(257)).toBe('gt256')
  })

  it('キャップ値 257 も実数の大きい値も同じレンジ（実数の大小は出さない）', () => {
    // AI 生成の「単色ベタ塗り」は 769 色（measurements §6.1）。キャップ後は 257 で保存される
    expect(colorRange(257)).toBe(colorRange(769))
    expect(colorRange(769)).toBe(colorRange(20295))
  })

  it('1 未満・非整数を拒否する', () => {
    expect(() => colorRange(0)).toThrow(RangeError)
    expect(() => colorRange(-1)).toThrow(RangeError)
    expect(() => colorRange(1.5)).toThrow(RangeError)
  })
})

describe('decideHint（prd/06 §7.3 の受理規則）', () => {
  it('モードにヒントが無ければ拒否する', () => {
    expect(decideHint(null, served(), 'q1')).toBe('reject-not-allowed')
  })

  it('未配信・questionId 不一致は「現在の問題ではない」', () => {
    expect(decideHint(config, null, 'q1')).toBe('reject-not-current')
    expect(decideHint(config, served(), 'q2')).toBe('reject-not-current')
  })

  it('回答済みの行への要求は拒否する（ヒント代を発生させない）', () => {
    expect(decideHint(config, served({ answeredAt: new Date() }), 'q1')).toBe('reject-answered')
  })

  it('回答済みなら、支払い済みでも「拒否」が先勝ちする（再減点の余地を残さない）', () => {
    expect(
      decideHint(config, served({ answeredAt: new Date(), hintUsedAt: new Date() }), 'q1'),
    ).toBe('reject-answered')
  })

  it('支払い済みの再要求は replay（冪等。二重減点しない）', () => {
    expect(decideHint(config, served({ hintUsedAt: new Date() }), 'q1')).toBe('replay')
  })

  it('未使用なら disclose（🔒 呼び出し側は永続化してから開示する）', () => {
    expect(decideHint(config, served(), 'q1')).toBe('disclose')
  })
})
