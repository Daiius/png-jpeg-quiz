import { assertKnownSource as assertSourceHash } from './derive-io.ts'
import type { SourceMeta } from './source.ts'

/**
 * `derive:geometric` が書き出す派生素材の `meta.json` と、その**前提になる原本の同定**
 * （prd/05 §1, §4）。
 *
 * CLI 本体（`derive-geometric-cli.ts`）は import しただけで実行されるので、
 * **静的テストから読めるようにここへ分けてある**。
 */

export const QUANT_COLORS = 16

/**
 * 原本 `assets/source/ai-geometric.png` の SHA-256。
 *
 * 🔒 **入力がこれと一致しなければ CLI は止める。** ここに並ぶ出典・作者・ライセンスは
 * **この 1 枚に対する事実**であって、入力から導いた値ではない。寸法しか見ずに通すと、
 * 同寸の別画像や差し替わった既定ファイルに OpenAI / Daiius の来歴が付いたまま
 * DB と回答後表示へ流れる（prd/05 §1: 出典・作者・ライセンスが取れる素材だけ採用する）。
 */
export const SOURCE_SHA256 = 'b4a3422303c9026b3cf57b7a2ec3c1017a857c3046880762162a5e81daa25697'

/** 入力が既知の原本かを確かめる。**一致しなければ派生素材を作らせない。** */
export function assertKnownSource(sha256: string, sourcePath: string): void {
  assertSourceHash(sha256, SOURCE_SHA256, sourcePath, 'ai-geometric.png')
}

export const QUANT_META = {
  source: {
    site: 'OpenAI ChatGPT（画像生成）',
    author: 'Daiius（生成・提供）',
    license: 'OpenAI 出力（生成者に権利帰属）',
    license_note:
      'OpenAI ChatGPT で生成した ai-geometric.png を 16 色に減色した派生素材。利用規約により出力の権利は生成者に譲渡され、再配布・商用利用が認められている。⚠ 日本法では創作的寄与が乏しく著作物性は認められない可能性が高いが、配布の妨げにはならない。🔒 AI 生成である旨は回答後の画面とクレジット一覧でのみ開示する（出題前に出すと T7 の漏洩になる）。確認日 2026-08-14。',
    retrieved: '2026-08-13',
    shared_via: 'clip.faveo-systema.net',
    derived_from: 'ai-geometric.png（334x223）を 16 色に減色（メディアンカット・ディザなし）',
    license_url: 'https://openai.com/policies/row-terms-of-use/',
  },
  category: 'illustration',
  tags: ['flat', 'shape', 'edge', 'ai-noise', 'quantized'],
  is_ai_generated: true,
  /** 🔒 減色して作った合成素材（prd/05 §4）。正解画面で加工内容を開示する */
  is_synthetic: true,
  derivation: {
    op: 'quantize',
    source: 'ai-geometric',
    colors: QUANT_COLORS,
    method: 'median-cut（ディザなし・決定的）',
    sourceSha256: SOURCE_SHA256,
    script: 'packages/pipeline/src/derive-geometric-cli.ts',
    note: 'AI 生成由来の画素ノイズを 16 色へ丸める。「減色してもまだ JPEG が勝つか」を元画像・クリーン 2 色版と対で見せる意地悪問題ペアの素材（prd/05 §4）',
  },
  note: '幾何学図形・ライン（ai-geometric の 16 色減色版）',
  caution:
    '⚠ 減色後もアンチエイリアスぶんの中間色は残る。正解はパイプラインの実測で決める（断定しない）',
} satisfies SourceMeta

export const CLEAN_META = {
  source: {
    site: '自作（本リポジトリの生成スクリプト）',
    author: 'Daiius（作成）',
    license: '自作（権利者が本プロジェクトでの利用・再配布を許諾）',
    license_note:
      'ai-geometric.png（AI 生成）の図形配置を目視・座標計測で写し取り、SVG から新規に描画した自作素材。画素は SVG のラスタライズ + 白黒 2 値化で生成しており、AI 出力のピクセルは一切含まない。構図の参照元が AI 生成であることは回答後の解説で開示する。',
    derived_from:
      'ai-geometric.png を参照した自作再描画（純白背景 + 単色黒、2 色のみ）。同寸 334x223',
  },
  category: 'illustration',
  tags: ['flat', 'shape', 'edge', 'clean'],
  is_ai_generated: false,
  /** 🔒 再描画して作った合成素材（prd/05 §4）。見た目が元画像と同じでも「入手したまま」ではない */
  is_synthetic: true,
  derivation: {
    op: 'redraw',
    source: 'ai-geometric',
    colors: 2,
    method: 'SVG ラスタライズ + 白黒 2 値化（アンチエイリアスの中間色を除去）',
    sourceSha256: SOURCE_SHA256,
    script: 'packages/pipeline/src/derive-geometric-cli.ts',
    note: '見た目は元画像と同じだがノイズゼロ。「真にフラットなら PNG が勝つ」を元画像・16 色減色版と対で見せる意地悪問題ペアの素材（prd/05 §4）',
  },
  note: '幾何学図形・ライン（ai-geometric のクリーン 2 色再描画版）',
  caution: '⚠ 正解はパイプラインの実測で決める（断定しない）',
} satisfies SourceMeta
