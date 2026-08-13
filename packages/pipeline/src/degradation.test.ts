import { describe, expect, it } from 'vitest'
import {
  ciede2000,
  de00Map,
  de00Scalars,
  type Lab,
  OVERLAY_LIMIT,
  renderOverlay,
  srgbToLab,
  ssimMap,
} from './degradation.ts'
import type { RawImage } from './metrics.ts'

/**
 * 🔒 **CIEDE2000 はテストベクタで縛る**（prd/05 §6）。
 *
 * ⚠ 間違えても「それらしい絵」が出る式なので、目視では検証にならない。
 * 実際、CIE76 の Lab 変換で括弧を 1 つ間違えたまま
 * 「平均 0.01・最大 119」という矛盾した数値が出ていたことがある。
 *
 * データは Sharma, Wu, Dalal (2005) の CIEDE2000 テストデータ。
 * 形式: [L1, a1, b1, L2, a2, b2, 期待する ΔE00]
 */
const SHARMA_TEST_DATA: readonly (readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
  [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
  [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
  [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0],
  [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
  [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.001, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
  [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.001, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
  [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
  [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
  [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
  [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
  [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
  [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0],
  [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
]

function lab(L: number, a: number, b: number): Lab {
  return { L, a, b }
}

/** 単色で埋めた RGB 画像 */
function solid(width: number, height: number, rgb: readonly [number, number, number]): RawImage {
  const data = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = rgb[0]
    data[i * 3 + 1] = rgb[1]
    data[i * 3 + 2] = rgb[2]
  }
  return { data, width, height, channels: 3 }
}

describe('ciede2000', () => {
  // 🔒 prd/05 §6: 誤差 1e-3 未満
  it.each(SHARMA_TEST_DATA)(
    'Sharma テストベクタ: (%f, %f, %f) vs (%f, %f, %f) → %f',
    (l1, a1, b1, l2, a2, b2, expected) => {
      expect(ciede2000(lab(l1, a1, b1), lab(l2, a2, b2))).toBeCloseTo(expected, 3)
    },
  )

  it('同じ色なら 0', () => {
    expect(ciede2000(lab(50, 2.5, -3), lab(50, 2.5, -3))).toBe(0)
  })

  it('対称である（順序を入れ替えても同じ）', () => {
    for (const [l1, a1, b1, l2, a2, b2] of SHARMA_TEST_DATA) {
      const forward = ciede2000(lab(l1, a1, b1), lab(l2, a2, b2))
      const backward = ciede2000(lab(l2, a2, b2), lab(l1, a1, b1))
      expect(backward).toBeCloseTo(forward, 9)
    }
  })
})

describe('srgbToLab', () => {
  // ⚠ ここが壊れていると ΔE00 のテストは通ったまま実画像だけが狂う
  it('白は L=100 / a=b=0', () => {
    const white = srgbToLab(255, 255, 255)
    expect(white.L).toBeCloseTo(100, 3)
    expect(white.a).toBeCloseTo(0, 3)
    expect(white.b).toBeCloseTo(0, 3)
  })

  it('黒は L=0', () => {
    const black = srgbToLab(0, 0, 0)
    expect(black.L).toBeCloseTo(0, 6)
    expect(black.a).toBeCloseTo(0, 6)
    expect(black.b).toBeCloseTo(0, 6)
  })

  it('中間グレーは無彩色（a = b = 0）で L はおよそ 53.6', () => {
    const gray = srgbToLab(128, 128, 128)
    expect(gray.a).toBeCloseTo(0, 3)
    expect(gray.b).toBeCloseTo(0, 3)
    expect(gray.L).toBeCloseTo(53.585, 2)
  })

  it('sRGB の原色が既知の Lab に一致する', () => {
    const red = srgbToLab(255, 0, 0)
    expect(red.L).toBeCloseTo(53.24, 1)
    expect(red.a).toBeCloseTo(80.09, 1)
    expect(red.b).toBeCloseTo(67.2, 1)
  })
})

describe('de00Map', () => {
  it('同じ画像なら全画素 0', () => {
    const image = solid(4, 3, [10, 200, 30])
    const map = de00Map(image, image)
    expect(map.length).toBe(12)
    expect([...map].every((value) => value === 0)).toBe(true)
  })

  it('寸法が違えば例外', () => {
    expect(() => de00Map(solid(4, 3, [0, 0, 0]), solid(4, 2, [0, 0, 0]))).toThrow(RangeError)
  })
})

describe('ssimMap', () => {
  it('同じ画像なら全画素 1', () => {
    const image = solid(16, 16, [120, 130, 140])
    for (const value of ssimMap(image, image)) {
      expect(value).toBeCloseTo(1, 6)
    }
  })

  it('違う画像では 1 を下回る', () => {
    const reference = solid(16, 16, [0, 0, 0])
    const degraded = solid(16, 16, [255, 255, 255])
    for (const value of ssimMap(reference, degraded)) {
      expect(value).toBeLessThan(1)
    }
  })
})

describe('de00Scalars', () => {
  it('平均・最大・閾値超えの割合を返す', () => {
    const map = Float32Array.from([0, 1, 3, 5])
    const scalars = de00Scalars(map)
    expect(scalars.mean).toBeCloseTo(2.25, 6)
    expect(scalars.max).toBe(5)
    // 2 を超えるのは 3 と 5 の 2 つ
    expect(scalars.over2Pct).toBeCloseTo(50, 6)
  })

  it('p99 は上位側の値になる', () => {
    const map = Float32Array.from(Array.from({ length: 100 }, (_, i) => i))
    expect(de00Scalars(map).p99).toBe(99)
  })

  it('空なら例外', () => {
    expect(() => de00Scalars(new Float32Array(0))).toThrow(RangeError)
  })
})

describe('renderOverlay', () => {
  const image = solid(2, 2, [200, 200, 200])

  it('劣化ゼロなら無彩色（R = G = B）になる', () => {
    const out = renderOverlay(image, Float32Array.from([0, 0, 0, 0]), 'de00')
    expect(out[0]).toBe(out[1])
    expect(out[1]).toBe(out[2])
  })

  it('上限以上ならマゼンタ（G = 0, R = B = 255）になる', () => {
    const limit = OVERLAY_LIMIT.de00
    const out = renderOverlay(image, Float32Array.from([limit, limit, limit, limit]), 'de00')
    expect(out[0]).toBe(255)
    expect(out[1]).toBe(0)
    expect(out[2]).toBe(255)
  })

  it('SSIM は「似ている度」なので 1 が劣化ゼロ側になる', () => {
    const out = renderOverlay(image, Float32Array.from([1, 1, 1, 1]), 'ssim')
    expect(out[1]).toBe(out[0])
  })

  it('マップの長さが合わなければ例外', () => {
    expect(() => renderOverlay(image, Float32Array.from([0]), 'de00')).toThrow(RangeError)
  })
})
