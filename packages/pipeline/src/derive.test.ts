import { describe, expect, it } from 'vitest'
import { binarize, duotone, inkColor, quantize } from './derive.ts'
import { countColors, type RawImage } from './metrics.ts'

/** 決定的な擬似ノイズ画像（LCG。乱数モジュールに依存しない） */
function noisyImage(width: number, height: number, channels = 3): RawImage {
  const data = new Uint8Array(width * height * channels)
  let state = 42
  for (let i = 0; i < data.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    data[i] = state % 256
  }
  return { data, width, height, channels }
}

describe('quantize', () => {
  it('色数を maxColors 以下に落とし、寸法を保つ', () => {
    const image = noisyImage(40, 30)
    const out = quantize(image, 16)
    expect(out.width).toBe(40)
    expect(out.height).toBe(30)
    expect(out.channels).toBe(3)
    expect(countColors(out)).toBeLessThanOrEqual(16)
  })

  it('決定的: 同じ入力から常に同じバイト列が出る', () => {
    const image = noisyImage(24, 24)
    const a = quantize(image, 16)
    const b = quantize(image, 16)
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
  })

  it('元が maxColors 以下なら色を変えない', () => {
    // 2 色のストライプ
    const width = 8
    const height = 4
    const data = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
      const value = i % 2 === 0 ? 255 : 0
      data.set([value, value, value], i * 3)
    }
    const out = quantize({ data, width, height, channels: 3 }, 16)
    expect(Buffer.from(out.data).equals(Buffer.from(data))).toBe(true)
  })

  it('RGBA 入力（4ch）でも RGB 3ch を返す', () => {
    const image = noisyImage(10, 10, 4)
    const out = quantize(image, 8)
    expect(out.channels).toBe(3)
    expect(out.data.length).toBe(10 * 10 * 3)
    expect(countColors(out)).toBeLessThanOrEqual(8)
  })

  it('maxColors < 2 は拒否する', () => {
    expect(() => quantize(noisyImage(4, 4), 1)).toThrow(RangeError)
  })
})

describe('binarize', () => {
  it('全画素が純黒か純白の 2 値になる', () => {
    const out = binarize(noisyImage(32, 32))
    expect(countColors(out)).toBe(2)
    for (let i = 0; i < out.data.length; i += 3) {
      const [r, g, b] = [out.data[i], out.data[i + 1], out.data[i + 2]]
      expect(r === 0 || r === 255).toBe(true)
      expect(g).toBe(r)
      expect(b).toBe(r)
    }
  })

  it('閾値を境に振り分ける（Rec.601 輝度）', () => {
    // グレー 127 と 128 の 2 画素
    const data = new Uint8Array([127, 127, 127, 128, 128, 128])
    const out = binarize({ data, width: 2, height: 1, channels: 3 })
    expect([...out.data.slice(0, 3)]).toEqual([0, 0, 0])
    expect([...out.data.slice(3, 6)]).toEqual([255, 255, 255])
  })
})

describe('duotone', () => {
  const BLUE = [38, 110, 173] as const
  const WHITE = [255, 255, 255] as const

  it('🔒 中間色を残さない: どの画素も指定した 2 色のどちらかになる', () => {
    const out = duotone(noisyImage(32, 32), BLUE, WHITE, 175)
    expect(countColors(out)).toBe(2)
    for (let i = 0; i < out.data.length; i += 3) {
      const pixel = [out.data[i], out.data[i + 1], out.data[i + 2]]
      const matched = pixel.every((v, c) => v === BLUE[c]) || pixel.every((v, c) => v === WHITE[c])
      expect(matched).toBe(true)
    }
  })

  it('RGBA 入力（4ch）でも RGB 3ch を返し、寸法を保つ', () => {
    const out = duotone(noisyImage(10, 8, 4), BLUE, WHITE)
    expect(out.channels).toBe(3)
    expect(out.width).toBe(10)
    expect(out.height).toBe(8)
    expect(out.data.length).toBe(10 * 8 * 3)
  })

  it('決定的: 同じ入力から常に同じバイト列が出る', () => {
    const image = noisyImage(24, 24)
    const a = duotone(image, BLUE, WHITE, 175)
    const b = duotone(image, BLUE, WHITE, 175)
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true)
  })
})

describe('inkColor', () => {
  /** 暗部が青・明部が白の 2 値画像に、暗部だけノイズを載せたもの */
  function inkyImage(ink: readonly [number, number, number], jitter: number): RawImage {
    const width = 40
    const height = 40
    const data = new Uint8Array(width * height * 3)
    let state = 7
    for (let i = 0; i < width * height; i++) {
      const dark = i % 3 !== 0
      state = (state * 1103515245 + 12345) & 0x7fffffff
      const noise = (state % (2 * jitter + 1)) - jitter
      const pixel = dark ? ink.map((v) => Math.min(255, Math.max(0, v + noise))) : [255, 255, 255]
      data.set(pixel, i * 3)
    }
    return { data, width, height, channels: 3 }
  }

  it('暗部の代表色を返す（明部＝白には引きずられない）', () => {
    const ink = [38, 110, 173] as const
    const [r, g, b] = inkColor(inkyImage(ink, 6))
    expect(Math.abs(r - ink[0])).toBeLessThanOrEqual(2)
    expect(Math.abs(g - ink[1])).toBeLessThanOrEqual(2)
    expect(Math.abs(b - ink[2])).toBeLessThanOrEqual(2)
  })

  it('決定的: 同じ入力から常に同じ色が出る', () => {
    const image = inkyImage([38, 110, 173], 6)
    expect(inkColor(image)).toEqual(inkColor(image))
  })

  it('⚠ 入力を破壊しない（中央値のためにソートしても元バッファは変えない）', () => {
    const image = inkyImage([38, 110, 173], 6)
    const before = Buffer.from(image.data)
    inkColor(image)
    expect(Buffer.from(image.data).equals(before)).toBe(true)
  })

  it('暗部が 1 画素も無ければ拒否する', () => {
    const data = new Uint8Array(3 * 4).fill(255)
    expect(() => inkColor({ data, width: 2, height: 2, channels: 3 })).toThrow(RangeError)
  })
})
