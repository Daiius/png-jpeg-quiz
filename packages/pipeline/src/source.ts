import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { questionCategorySchema } from '@png-jpeg-quiz/quiz-core'
import { z } from 'zod'

/**
 * 素材と `<name>.meta.json` の読み込み（prd/05 §2, §3 ステップ 1）。
 *
 * 🔒 **出典・作者・ライセンスが取れない素材は採用しない**（prd/05 §1）。
 * そのためスキーマで `source` を必須にしてある。
 */

export const sourceMetaSchema = z.object({
  source: z.object({
    site: z.string().min(1),
    page: z.url().optional(),
    url: z.url().optional(),
    author: z.string().min(1),
    license: z.string().min(1),
    license_url: z.url().optional(),
    license_note: z.string().optional(),
    retrieved: z.string().optional(),
    shared_via: z.string().optional(),
    derived_from: z.string().optional(),
  }),
  category: questionCategorySchema,
  tags: z.array(z.string()).default([]),
  /** 透過素材はここで指定した色に合成してから使う（prd/01 §1） */
  preprocess: z.object({ flatten: z.string().optional() }).optional(),
  is_ai_generated: z.boolean().optional(),
  derivation: z.record(z.string(), z.unknown()).optional(),
  note: z.string().optional(),
  caution: z.string().optional(),
  explanation: z.string().optional(),
})

export type SourceMeta = z.infer<typeof sourceMetaSchema>

export interface SourceAsset {
  /** 拡張子を除いたファイル名。ログと `derivation` の参照に使う */
  name: string
  filePath: string
  bytes: Buffer
  /** 素材の内容ハッシュ。**問題 ID の種**（prd/05 §1-3） */
  contentHash: string
  meta: SourceMeta
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/**
 * `assets/source/` を読む。**素材ごとに meta.json が必須**で、無ければ例外にする
 * （黙って落とすとライセンス不明の素材が紛れ込む）。
 */
export async function loadSources(directory: string): Promise<SourceAsset[]> {
  const entries = await readdir(directory)
  const imageFiles = entries.filter((file) =>
    IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()),
  )
  imageFiles.sort()

  const assets: SourceAsset[] = []
  for (const file of imageFiles) {
    const name = file.replace(/\.[^.]+$/, '')
    const metaPath = path.join(directory, `${name}.meta.json`)
    let rawMeta: unknown
    try {
      rawMeta = JSON.parse(await readFile(metaPath, 'utf8'))
    } catch (cause) {
      throw new Error(`${file}: meta.json が読めない（出典とライセンスが必要）: ${metaPath}`, {
        cause,
      })
    }
    const parsed = sourceMetaSchema.safeParse(rawMeta)
    if (!parsed.success) {
      throw new Error(`${file}: meta.json の内容が不正: ${z.prettifyError(parsed.error)}`)
    }

    const bytes = await readFile(path.join(directory, file))
    assets.push({
      name,
      filePath: path.join(directory, file),
      bytes,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      meta: parsed.data,
    })
  }
  return assets
}

/**
 * 問題 ID。**内容ハッシュ由来だが、そのままではない**（prd/03 §3 の「推測不能な ID」）。
 * 素材が同じなら同じ ID になるので、ビルドは冪等になる。
 */
export function questionIdFor(contentHash: string): string {
  return `q_${contentHash.slice(0, 24)}`
}
