import { describe, expect, it } from 'vitest'
import { CLEAN_META, QUANT_META } from './derive-geometric-meta.ts'
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
    })
  }

  it('AI 生成の宣言は素材ごとに違う（減色版は AI 出力の画素、再描画版は自作）', () => {
    expect(QUANT_META.is_ai_generated).toBe(true)
    expect(CLEAN_META.is_ai_generated).toBe(false)
  })
})
