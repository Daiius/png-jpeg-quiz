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
    '  CC0  ',
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

  /**
   * 🔒 **部分一致で「帰属不要」に倒さない。**
   * `MIT / generated with OpenAI` が「OpenAI を含むから帰属不要」になると、
   * MIT の表示義務を落としたまま公開してしまう。
   */
  it.each([
    'MIT / generated with OpenAI',
    'CC0 / CC BY 4.0',
    'Public Domain および CC BY-SA 4.0',
    '自作 + Apache-2.0',
    'CC0, MIT',
    'CC0 and MIT',
    '独自ライセンス（Public Domain ではない）',
    // ⚠ 前方一致では素通りしてしまう形（bot の再指摘）
    'OpenAI; MIT',
    'OpenAI MIT',
    'CC0 1.0 with additional terms',
    '自作 だが Apache-2.0 部分を含む',
    // ⚠ 末尾の注記を剥がして比べると素通りしてしまう形（bot の再指摘）
    'CC0（MIT も含む）',
    'CC0（追加条件あり）',
    'Public Domain (with attribution requested)',
    // 注記のない「自作」は許可リストに入れていない（実在しない表記を先回りで許可しない）
    '自作',
    '自作（CC0 相当）',
  ])('複合表記・注記つきは帰属必須に倒す: %s', (license) => {
    expect(requiresAttribution(license)).toBe(true)
  })

  // 実際に `meta.json` にある表記が帰属不要と判定されること（許可リストの回帰）
  it.each(['CC0', 'OpenAI 出力（生成者に権利帰属）'])('実在する表記は帰属不要: %s', (license) => {
    expect(requiresAttribution(license)).toBe(false)
  })
})
