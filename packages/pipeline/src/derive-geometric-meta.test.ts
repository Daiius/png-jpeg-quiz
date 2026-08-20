import { describe, expect, it } from 'vitest'
import {
  assertKnownSource,
  CLEAN_META,
  QUANT_META,
  SOURCE_SHA256,
} from './derive-geometric-meta.ts'
import { sourceMetaSchema } from './source.ts'

/**
 * 派生素材の meta が **quiz:build に読める形で、合成素材として宣言されている**ことを固定する
 * （prd/05 §4: 合成問題は `is_synthetic` / `derivation` に加工内容を記録して正解画面で開示する）。
 */
describe('derive:geometric が書き出す meta', () => {
  for (const [name, meta] of [
    ['ai-geometric-16', QUANT_META],
    ['ai-geometric-clean', CLEAN_META],
  ] as const) {
    describe(name, () => {
      it('sourceMetaSchema を満たす', () => {
        expect(sourceMetaSchema.safeParse(meta).success).toBe(true)
      })

      it('🔒 合成素材として宣言する（既定の false に落ちない）', () => {
        expect(meta.is_synthetic).toBe(true)
        expect(sourceMetaSchema.parse(meta).is_synthetic).toBe(true)
      })

      it('加工内容と派生元を derivation に記録する', () => {
        expect(meta.derivation.source).toBe('ai-geometric')
        expect(meta.derivation.op).toBeTruthy()
        expect(meta.derivation.method).toBeTruthy()
      })

      it('固定で書き出す来歴が、どの原本のものかを内容ハッシュで指す', () => {
        expect(meta.derivation.sourceSha256).toBe(SOURCE_SHA256)
      })
    })
  }

  it('AI 生成の宣言は素材ごとに違う（減色版は AI 出力の画素、再描画版は自作）', () => {
    expect(QUANT_META.is_ai_generated).toBe(true)
    expect(CLEAN_META.is_ai_generated).toBe(false)
  })
})

/**
 * 🔒 出典・ライセンスは ai-geometric.png 固定で書き出す。
 * **原本そのものでなければ作らせない**（同寸の別画像に来歴が付くのを防ぐ。prd/05 §1）。
 */
describe('assertKnownSource', () => {
  it('既知の原本なら通す', () => {
    expect(() => assertKnownSource(SOURCE_SHA256, 'ai-geometric.png')).not.toThrow()
  })

  it('内容が違えば止める（寸法が同じでも通さない）', () => {
    expect(() => assertKnownSource('0'.repeat(64), 'other.png')).toThrow(/other\.png/)
  })

  it('期待するハッシュは 64 桁の 16 進', () => {
    expect(SOURCE_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})
