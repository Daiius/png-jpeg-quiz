import type { NormalizedImage } from './normalize.ts'
import type { SourceAsset } from './source.ts'

/**
 * `question` 行のうち、**素材と正規化画像だけで決まる列**（prd/03 §3）。
 *
 * insert と `onDuplicateKeyUpdate` の両方がこの 1 か所を使う。
 * 二重に書くと**片方だけ更新し忘れる**（実際 `is_synthetic` がそれで抜けていた）。
 * 純関数にしてあるのは、`meta.json` の宣言がそのまま DB へ届くことを
 * DB 無しの静的テストで固定するため。
 */
export function questionValuesFrom(asset: SourceAsset, image: NormalizedImage) {
  return {
    width: image.width,
    height: image.height,
    category: asset.meta.category,
    colorCount: Math.min(image.colorCount, 257),
    flatRatio: image.flatRatio,
    tags: asset.meta.tags,
    /**
     * 🔒 **合成（意地悪加工）かどうかは `meta.json` の宣言をそのまま持ち込む。**
     * ここで `false` に固定すると、減色版・再描画版が非合成として記録され、
     * 正解画面での加工開示（prd/05 §4）が落ちる。
     */
    isSynthetic: asset.meta.is_synthetic,
    // 🔒 `meta.json` の宣言は必須（source.ts）。ここで `?? false` に倒さない ──
    // 書き忘れが「AI ではない」という断定になり、開示義務を静かに落とす（prd/05 §1.1）
    isAiGenerated: asset.meta.is_ai_generated,
    derivation: {
      ...(asset.meta.derivation ?? {}),
      sourceName: asset.name,
      ...(image.flattenedWith ? { flatten: image.flattenedWith } : {}),
    },
    source: asset.meta.source,
    explanation: asset.meta.explanation ?? null,
  }
}
