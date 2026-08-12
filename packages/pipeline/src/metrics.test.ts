import { describe, expect, it } from 'vitest'
import { countColors, flatRatio, type RawImage } from './metrics.ts'

/**
 * 行の文字列から `RawImage` を作る。`.` = 黒 / `#` = 白。
 * 模様が目で見えるようにテストを書きたいので、こちらを既定の作り方にする。
 */
function fromPattern(rows: readonly string[]): RawImage {
  const width = rows[0]?.length ?? 0
  const height = rows.length
  if (rows.some((row) => row.length !== width)) {
    throw new Error('すべての行を同じ長さにする')
  }
  const data = new Uint8Array(width * height * 3)
  rows.forEach((row, y) => {
    ;[...row].forEach((cell, x) => {
      const value = cell === '#' ? 255 : 0
      const index = (y * width + x) * 3
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
    })
  })
  return { data, width, height, channels: 3 }
}

/** RGB を直接指定したいときの作り方 */
function fromPixels(
  width: number,
  height: number,
  pixels: readonly (readonly [number, number, number])[],
): RawImage {
  const data = new Uint8Array(width * height * 3)
  pixels.forEach(([r, g, b], i) => {
    data[i * 3] = r
    data[i * 3 + 1] = g
    data[i * 3 + 2] = b
  })
  return { data, width, height, channels: 3 }
}

describe('flatRatio', () => {
  it('完全な単色は 1', () => {
    expect(flatRatio(fromPattern(['...', '...', '...']))).toBe(1)
  })

  it('市松模様は 0（隣接ペアが 1 つも一致しない）', () => {
    expect(flatRatio(fromPattern(['.#.', '#.#', '.#.']))).toBe(0)
  })

  it('縦縞と横縞を対称に扱う（右と下を別々のペアとして数えるため）', () => {
    // 分母 = 2*(4-1) + (2-1)*4 = 10
    // 縦縞: 右方向 6 本すべて不一致 / 下方向 4 本すべて一致
    expect(flatRatio(fromPattern(['.#.#', '.#.#']))).toBeCloseTo(4 / 10, 10)
    // 横縞: 右方向 6 本すべて一致 / 下方向 4 本すべて不一致
    expect(flatRatio(fromPattern(['....', '####']))).toBeCloseTo(6 / 10, 10)
  })

  it('RGB のどれか 1 チャンネルでも違えば不一致', () => {
    expect(
      flatRatio(
        fromPixels(2, 1, [
          [10, 20, 30],
          [10, 20, 31],
        ]),
      ),
    ).toBe(0)
  })

  it('アルファがあっても RGB だけで比較する', () => {
    const data = new Uint8Array([1, 2, 3, 0, 1, 2, 3, 255])
    expect(flatRatio({ data, width: 2, height: 1, channels: 4 })).toBe(1)
  })

  it('1x1 は分母 0 なので 1 を返す', () => {
    expect(flatRatio(fromPattern(['.']))).toBe(1)
  })

  it('壊れた入力を拒否する', () => {
    expect(() => flatRatio({ data: new Uint8Array(0), width: 0, height: 1, channels: 3 })).toThrow(
      RangeError,
    )
    // data が width * height * channels に足りない
    expect(() => flatRatio({ data: new Uint8Array(3), width: 2, height: 2, channels: 3 })).toThrow(
      RangeError,
    )
    // RGB に満たないチャンネル数
    expect(() => flatRatio({ data: new Uint8Array(4), width: 2, height: 1, channels: 2 })).toThrow(
      RangeError,
    )
  })
})

describe('countColors', () => {
  it('相異なる RGB を数える', () => {
    expect(countColors(fromPattern(['.#', '.#']))).toBe(2)
    expect(
      countColors(
        fromPixels(1, 3, [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ]),
      ),
    ).toBe(3)
  })
})
