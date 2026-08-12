import { z } from 'zod'

const webEnvSchema = z.object({
  /** 画像配信のベース URL。M4 で R2 のカスタムドメインに差し替える（prd/02 §5） */
  ASSET_BASE_URL: z.url().default('http://localhost:3000/assets'),
  PUBLIC_ORIGIN: z.url().default('http://localhost:3000'),
})

export type WebEnv = z.infer<typeof webEnvSchema>

let cached: WebEnv | undefined

export function webEnv(): WebEnv {
  cached ??= webEnvSchema.parse(process.env)
  return cached
}

/** 出題・回答レスポンスに載せる絶対 URL を組み立てる */
export function assetUrl(objectKey: string): string {
  return `${webEnv().ASSET_BASE_URL.replace(/\/$/, '')}/${objectKey}`
}
