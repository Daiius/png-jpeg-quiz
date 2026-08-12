import { migrate } from 'drizzle-orm/mysql2/migrator'
import { closeDatabase, getDatabase } from './client.ts'

/**
 * マイグレーションの適用。
 *
 * 🔒 **起動時の自動適用にはしない**（prd/02 §7）。本番でも使い捨てコンテナとして
 * 明示的に実行する。こうすると「適用した SQL」と「動いているコード」の版が構造的に一致する。
 */
async function main(): Promise<void> {
  await migrate(getDatabase(), {
    migrationsFolder: new URL('../migrations', import.meta.url).pathname,
  })
  console.log('migrations applied')
  await closeDatabase()
}

await main()
