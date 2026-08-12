import { defineConfig } from 'drizzle-kit'

// マイグレーション SQL の生成用。適用は src/migrate.ts が行う（prd/02 §7）。
export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? '',
  },
})
