import { describe, expect, it } from 'vitest'
import type { NormalizedImage } from './normalize.ts'
import { questionValuesFrom } from './question-values.ts'
import { type SourceAsset, sourceMetaSchema } from './source.ts'

function assetWith(metaPatch: Record<string, unknown>): SourceAsset {
  const meta = sourceMetaSchema.parse({
    source: { site: 's', author: 'a', license: 'l' },
    category: 'illustration',
    is_ai_generated: false,
    ...metaPatch,
  })
  return {
    name: 'sample',
    filePath: '/tmp/sample.png',
    bytes: Buffer.alloc(0),
    contentHash: 'x',
    meta,
  }
}

const image: NormalizedImage = {
  raw: { data: new Uint8Array(3), width: 1, height: 1, channels: 3 },
  width: 1,
  height: 1,
  colorCount: 999,
  flatRatio: 0.5,
  hadAlpha: false,
  flattenedWith: null,
}

/**
 * `meta.json` の宣言が `question` 行へそのまま届くことの固定（prd/03 §3）。
 * DB を要らなくするために、列の値は純関数へ切り出してある。
 */
describe('questionValuesFrom', () => {
  it('🔒 合成素材の宣言をそのまま持ち込む（false 固定にしない）', () => {
    expect(questionValuesFrom(assetWith({ is_synthetic: true }), image).isSynthetic).toBe(true)
  })

  it('宣言が無ければ「加工していない」として false', () => {
    expect(questionValuesFrom(assetWith({}), image).isSynthetic).toBe(false)
  })

  it('⚠ derivation があるだけでは合成扱いにしない（切り出し・背景合成は加工ではない）', () => {
    const values = questionValuesFrom(assetWith({ derivation: { op: 'crop' } }), image)
    expect(values.isSynthetic).toBe(false)
    expect(values.derivation).toMatchObject({ op: 'crop', sourceName: 'sample' })
  })

  it('AI 生成の宣言も `?? false` に倒さずそのまま渡す', () => {
    expect(questionValuesFrom(assetWith({ is_ai_generated: true }), image).isAiGenerated).toBe(true)
  })

  it('color_count は 257 で頭打ち（256 超の印）', () => {
    expect(questionValuesFrom(assetWith({}), image).colorCount).toBe(257)
  })
})
