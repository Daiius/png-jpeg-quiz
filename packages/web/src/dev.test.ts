import { afterEach, describe, expect, it, vi } from 'vitest'
import { devQuestionCount } from './dev.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('devQuestionCount', () => {
  it('DEV_QUESTION_COUNT が無ければそのまま返す', () => {
    vi.stubEnv('DEV_QUESTION_COUNT', undefined)
    expect(devQuestionCount(30)).toBe(30)
  })

  it('DEV_QUESTION_COUNT で上から抑える', () => {
    vi.stubEnv('DEV_QUESTION_COUNT', '3')
    expect(devQuestionCount(30)).toBe(3)
  })

  it('モードの問題数より大きい値は効かない（増やす方向には働かない）', () => {
    vi.stubEnv('DEV_QUESTION_COUNT', '100')
    expect(devQuestionCount(30)).toBe(30)
  })

  it('不正な値（0 以下・数値でない・空文字）は無視する', () => {
    for (const raw of ['0', '-1', 'abc', '']) {
      vi.stubEnv('DEV_QUESTION_COUNT', raw)
      expect(devQuestionCount(30)).toBe(30)
    }
  })

  it('文字列全体が正の十進整数でない値は無視する（parseInt の部分解釈に頼らない）', () => {
    // '3abc' を 3、'1.5' を 1 として受理しない（OCL-9D0D4E59）
    for (const raw of ['3abc', '1.5', '1e2', ' 3', '3 ', '007', '0x10', '+3']) {
      vi.stubEnv('DEV_QUESTION_COUNT', raw)
      expect(devQuestionCount(30)).toBe(30)
    }
  })

  it('安全な整数の範囲を超える値は無視する', () => {
    vi.stubEnv('DEV_QUESTION_COUNT', '9007199254740993')
    expect(devQuestionCount(30)).toBe(30)
  })

  it('🔒 本番ビルドでは常に無効', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEV_QUESTION_COUNT', '3')
    expect(devQuestionCount(30)).toBe(30)
  })
})
