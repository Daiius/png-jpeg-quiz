import { describe, expect, it } from 'vitest'
import { duotone } from './derive.ts'
import {
  assertKnownSource,
  CLEAN_META,
  COLUMN_EDGES,
  checkerSvg,
  EXPECTED,
  INK,
  PAPER,
  ROW_EDGES,
  SNAP_THRESHOLD,
  SOURCE_SHA256,
  toHex,
} from './derive-checker-meta.ts'
import { rasterizeSvg } from './derive-io.ts'
import { countColors, type RawImage } from './metrics.ts'
import { sourceMetaSchema } from './source.ts'

/**
 * `derive:checker` が作る `ai-pattern-checker-clean` の**成立条件**を固定する。
 *
 * 原本（AI 生成・画素ノイズ有り）と**同寸・同配置で、色はちょうど 2 色**というのが
 * この素材の存在理由なので、そこは実際にラスタライズして確かめる（定数の突き合わせでは足りない）。
 */

/** 実際に SVG を描いて 2 色スナップまで通す（CLI 本体と同じ手順） */
async function renderClean(): Promise<RawImage> {
  const rendered = await rasterizeSvg(checkerSvg(INK))
  return duotone(rendered, INK, PAPER, SNAP_THRESHOLD)
}

describe('市松の格子（原本の実測値）', () => {
  it('境界が 0 から原本の寸法までを覆う', () => {
    expect(COLUMN_EDGES[0]).toBe(0)
    expect(ROW_EDGES[0]).toBe(0)
    expect(COLUMN_EDGES.at(-1)).toBe(EXPECTED.width)
    expect(ROW_EDGES.at(-1)).toBe(EXPECTED.height)
  })

  it('境界は狭義単調増加（幅 0 のマスを作らない）', () => {
    for (const edges of [COLUMN_EDGES, ROW_EDGES]) {
      for (let i = 1; i < edges.length; i++) {
        expect(edges[i] as number).toBeGreaterThan(edges[i - 1] as number)
      }
    }
  })

  it('⚠ 端は原本と同じ欠けマス（右端 25px・下端 15px）', () => {
    expect((COLUMN_EDGES.at(-1) as number) - (COLUMN_EDGES.at(-2) as number)).toBe(25)
    expect((ROW_EDGES.at(-1) as number) - (ROW_EDGES.at(-2) as number)).toBe(15)
  })

  it('青マスは (行 + 列) が偶数のマスだけ（9 列 x 6 行のうち 27 枚）', () => {
    const svg = checkerSvg(INK)
    expect(svg.match(/<rect x=/g)?.length).toBe(27)
    // 左上マス (0,0) は青
    expect(svg).toContain(`<rect x="0" y="0" width="36" height="37"/>`)
  })
})

describe('クリーン 2 色版のラスタライズ', () => {
  it('原本と同寸（⚠ リサイズしない）', async () => {
    const clean = await renderClean()
    expect(clean.width).toBe(EXPECTED.width)
    expect(clean.height).toBe(EXPECTED.height)
  })

  it('🔒 ちょうど 2 色で、その 2 色が宣言どおりの青と白（中間色を残さない）', async () => {
    const clean = await renderClean()
    expect(countColors(clean)).toBe(2)
    const seen = new Set<string>()
    for (let i = 0; i < clean.data.length; i += 3) {
      seen.add(toHex([clean.data[i] ?? 0, clean.data[i + 1] ?? 0, clean.data[i + 2] ?? 0]))
    }
    expect([...seen].sort()).toEqual([toHex(INK), toHex(PAPER)].sort())
  })

  it('決定的: 2 回描いても同じバイト列になる', async () => {
    const a = await renderClean()
    const b = await renderClean()
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
  })
})

/**
 * 🔒 出典・ライセンスと格子の実測値は ai-pattern-checker.png 固定で書き出す。
 * **原本そのものでなければ作らせない**（同寸の別画像に来歴が付くのを防ぐ。prd/05 §1）。
 */
describe('assertKnownSource', () => {
  it('既知の原本なら通す', () => {
    expect(() => assertKnownSource(SOURCE_SHA256, 'ai-pattern-checker.png')).not.toThrow()
  })

  it('内容が違えば止める（寸法が同じでも通さない）', () => {
    expect(() => assertKnownSource('0'.repeat(64), 'other.png')).toThrow(/other\.png/)
  })

  it('期待するハッシュは 64 桁の 16 進', () => {
    expect(SOURCE_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('derive:checker が書き出す meta', () => {
  it('sourceMetaSchema を満たす', () => {
    expect(sourceMetaSchema.safeParse(CLEAN_META).success).toBe(true)
  })

  it('🔒 合成素材として宣言する（既定の false に落ちない）', () => {
    expect(CLEAN_META.is_synthetic).toBe(true)
    expect(sourceMetaSchema.parse(CLEAN_META).is_synthetic).toBe(true)
  })

  it('再描画版は AI 生成ではない（AI 出力の画素を含まない）', () => {
    expect(CLEAN_META.is_ai_generated).toBe(false)
  })

  it('加工内容と派生元を derivation に記録する', () => {
    expect(CLEAN_META.derivation.source).toBe('ai-pattern-checker')
    expect(CLEAN_META.derivation.op).toBe('redraw')
    expect(CLEAN_META.derivation.colors).toBe(2)
    expect(CLEAN_META.derivation.method).toBeTruthy()
  })

  it('固定で書き出す来歴が、どの原本のものかを内容ハッシュで指す', () => {
    expect(CLEAN_META.derivation.sourceSha256).toBe(SOURCE_SHA256)
  })

  it('meta が名乗る色と格子が、実際に描くものと一致する', () => {
    expect(CLEAN_META.derivation.ink).toBe(toHex(INK))
    expect(CLEAN_META.derivation.paper).toBe(toHex(PAPER))
    expect(CLEAN_META.derivation.grid).toContain(COLUMN_EDGES.join(','))
    expect(CLEAN_META.derivation.grid).toContain(ROW_EDGES.join(','))
  })
})
