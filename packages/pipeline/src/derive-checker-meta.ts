import { type Rgb, rec601Luma } from './derive.ts'
import { assertKnownSource as assertSourceHash } from './derive-io.ts'
import type { SourceMeta } from './source.ts'

/**
 * `derive:checker` が書き出す派生素材の**格子の実測値・SVG・`meta.json`**（prd/05 §1, §4）。
 *
 * CLI 本体（`derive-checker-cli.ts`）は import しただけで実行されるので、
 * **静的テストから読めるようにここへ分けてある**。
 */

/** 原本と同寸で描く。⚠ リサイズしない（PNG を大きく不利にする。measurements §5） */
export const EXPECTED = { width: 312, height: 197 } as const

/**
 * 原本 `assets/source/ai-pattern-checker.png` の SHA-256。
 *
 * 🔒 **入力がこれと一致しなければ CLI は止める。** 格子の座標もインク色も
 * **この 1 枚を測って得た値**であって、入力から導き直してはいない。
 * 別画像に対して走らせれば、写し取った配置も来歴の記述も嘘になる。
 */
export const SOURCE_SHA256 = '3d3ccea30e50d5d87c66aa8e05bc55ab71834f537358f9301febc166fa8b2c6b'

/** 入力が既知の原本かを確かめる。**一致しなければ派生素材を作らせない。** */
export function assertKnownSource(sha256: string, sourcePath: string): void {
  assertSourceHash(sha256, SOURCE_SHA256, sourcePath, 'ai-pattern-checker.png')
}

/**
 * 市松の**列境界**（x 座標。両端を含む）。
 *
 * 原本の全行で輝度が中点を横切る位置を求め、その平均を画素境界に丸めた実測値。
 * 一様な格子（ピッチ 35.92・位相 -0.5）で近似するより、**測った境界をそのまま置く方が原本に近い**
 * （AI 生成なので格子自体がわずかに不均一で、近似すると最大 0.6px ずれる）。
 * ⚠ 右端の 287..311（25px）は**欠けマス**。原本のトリミングをそのまま写す。
 */
export const COLUMN_EDGES = [0, 36, 71, 107, 143, 179, 215, 251, 287, 312] as const

/**
 * 市松の**行境界**（y 座標。両端を含む）。測り方は `COLUMN_EDGES` と同じ。
 * ⚠ 下端の 182..196（15px）は**欠けマス**。
 */
export const ROW_EDGES = [0, 37, 73, 109, 145, 182, 197] as const

/**
 * 青マスのインク色 = 原本の青領域のチャンネル別中央値（`inkColor`）。
 * CLI は毎回この値を測り直し、ここと一致しなければ止める（meta の記述を実測に縛るため）。
 */
export const INK: Rgb = [38, 110, 173]

/** 背景。原本の白は 254 前後だが、**再描画版は純白に寄せる**（2 色を確定させる） */
export const PAPER: Rgb = [255, 255, 255]

/**
 * 2 色スナップの閾値 = インクと紙の輝度の中点。**どちらの色にも寄らない**
 * （既定の 128 では、青 (輝度 96) と白 (255) の中間色が白側へ大きく偏る）。
 */
export const SNAP_THRESHOLD = (rec601Luma(...INK) + rec601Luma(...PAPER)) / 2

/** `#rrggbb`（SVG と meta の表記を 1 か所に揃える） */
export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 実測した境界から市松を組み立てる。塗るのは **`(行 + 列)` が偶数のマス**
 * （原本の左上マスが青。全マスで確認済み）。
 *
 * 🔒 座標がすべて整数なので、**縁にアンチエイリアスが出ない**。
 * それでも呼び出し側で 2 色スナップと色数の検査は行う（ラスタライザ任せにしない）。
 */
export function checkerSvg(ink: Rgb): string {
  const rects: string[] = []
  for (let row = 0; row + 1 < ROW_EDGES.length; row++) {
    for (let column = 0; column + 1 < COLUMN_EDGES.length; column++) {
      if ((row + column) % 2 !== 0) continue
      const x = COLUMN_EDGES[column] ?? 0
      const y = ROW_EDGES[row] ?? 0
      const width = (COLUMN_EDGES[column + 1] ?? 0) - x
      const height = (ROW_EDGES[row + 1] ?? 0) - y
      rects.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`)
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${EXPECTED.width}" height="${EXPECTED.height}" viewBox="0 0 ${EXPECTED.width} ${EXPECTED.height}">`,
    `  <rect width="${EXPECTED.width}" height="${EXPECTED.height}" fill="${toHex(PAPER)}"/>`,
    `  <g fill="${toHex(ink)}">`,
    ...rects.map((rect) => `    ${rect}`),
    '  </g>',
    '</svg>',
  ].join('\n')
}

export const CLEAN_META = {
  source: {
    site: '自作（本リポジトリの生成スクリプト）',
    author: 'Daiius（作成）',
    license: '自作（権利者が本プロジェクトでの利用・再配布を許諾）',
    license_note:
      'ai-pattern-checker.png（AI 生成）の格子配置（行列数・セル寸法・位相・端の欠けマス）と青の代表色を画素計測で写し取り、SVG から新規に描画した自作素材。画素は SVG のラスタライズ + 2 色スナップで生成しており、AI 出力のピクセルは一切含まない。構図の参照元が AI 生成であることは回答後の解説で開示する。',
    derived_from: `ai-pattern-checker.png を参照した自作再描画（純白背景 + 単色青 ${toHex(INK)}、2 色のみ）。同寸 ${EXPECTED.width}x${EXPECTED.height}`,
  },
  category: 'illustration',
  tags: ['pattern', 'tile', 'edge', 'clean'],
  is_ai_generated: false,
  /** 🔒 再描画して作った合成素材（prd/05 §4）。見た目が元画像と同じでも「入手したまま」ではない */
  is_synthetic: true,
  derivation: {
    op: 'redraw',
    source: 'ai-pattern-checker',
    colors: 2,
    method: 'SVG ラスタライズ + 2 色スナップ（白 / 青。アンチエイリアスの中間色を除去）',
    ink: toHex(INK),
    paper: toHex(PAPER),
    grid: `列境界 x=${COLUMN_EDGES.join(',')} / 行境界 y=${ROW_EDGES.join(',')}（右端と下端は原本と同じ欠けマス）`,
    sourceSha256: SOURCE_SHA256,
    script: 'packages/pipeline/src/derive-checker-cli.ts',
    note: '見た目は元画像と同じだがノイズゼロ。AI 生成の画素ノイズが有る / 無いだけが違う対を作り、原本と並べて見せる意地悪問題ペアの素材（prd/05 §4）',
  },
  note: '市松パターン（ai-pattern-checker のクリーン 2 色再描画版）',
  caution: '⚠ 正解はパイプラインの実測で決める（断定しない）',
} satisfies SourceMeta
