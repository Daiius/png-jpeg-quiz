import { describe, expect, it } from 'vitest'
import { requiresAttribution } from './credits.ts'

/**
 * 🔒 **判定を誤ると公開してはいけない素材が公開プールに残る**（prd/05 §1.4）。
 * `meta.json` の `license` は自由文字列なので、表記ゆれに対する挙動を固定しておく。
 */
describe('requiresAttribution', () => {
  it.each(['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-SA 3.0', 'cc by-nc 4.0', '  CC BY 2.0  '])(
    '帰属が要る: %s',
    (license) => {
      expect(requiresAttribution(license)).toBe(true)
    },
  )

  it.each([
    'CC0',
    'CC0 1.0',
    'cc0 1.0 universal',
    'OpenAI 出力（生成者に権利帰属）',
    'Public Domain',
    '自作（CC0 相当）',
  ])('帰属が要らない: %s', (license) => {
    expect(requiresAttribution(license)).toBe(false)
  })

  // ⚠ 判定できないものは**安全側**（帰属必須）に倒す。
  // 「分からないから公開してよい」にすると、表記が増えたときに黙って漏れる
  it.each(['', '不明', 'MIT', 'なんらかの独自ライセンス'])(
    '判別できないものは帰属必須に倒す: %s',
    (license) => {
      expect(requiresAttribution(license)).toBe(true)
    },
  )
})
