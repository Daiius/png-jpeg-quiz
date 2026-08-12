import { z } from 'zod'

/**
 * DB 接続に必要な環境変数。**値の実体はコミットしない**（雛形は `.env.example`）。
 */
const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^mysql$/ }),
})

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>

/**
 * `process.env` を検証して返す。**壊れた設定で起動させない**ために、
 * 欠落・不正はここで例外にする。
 */
export function readDatabaseEnv(
  source: Record<string, string | undefined> = process.env,
): DatabaseEnv {
  const parsed = databaseEnvSchema.safeParse(source)
  if (!parsed.success) {
    throw new Error(`invalid database env: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
