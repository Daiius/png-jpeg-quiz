import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

/**
 * 生成アセットのローカル配信。**M4 で R2 に差し替える**（prd/02 §5）。
 *
 * 🔒 `display` と `encoded` を同じキー空間に置かないのは prd/05 §2 の要件だが、
 * **配信側でパスを推測されないことが本質ではない**（キー自体が乱数）。
 * ここは「ビルド成果物をそのまま返す」だけに留める。
 */

const BUILD_ASSETS_DIR = process.env['BUILD_ASSETS_DIR'] ?? '/app/build/assets'

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key } = await context.params
  const objectKey = key.join('/')

  // パストラバーサルを弾く: 正規化した結果がビルドディレクトリの内側にあることを確かめる
  const target = path.resolve(BUILD_ASSETS_DIR, objectKey)
  const root = path.resolve(BUILD_ASSETS_DIR)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return new Response('not found', { status: 404 })
  }

  const contentType = CONTENT_TYPES[path.extname(target).toLowerCase()]
  if (!contentType) return new Response('not found', { status: 404 })

  let size: number
  try {
    const stats = await stat(target)
    if (!stats.isFile()) return new Response('not found', { status: 404 })
    size = stats.size
  } catch {
    return new Response('not found', { status: 404 })
  }

  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>
  return new Response(stream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      // すべて不変なので長期キャッシュでよい（prd/02 §4-3）
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
