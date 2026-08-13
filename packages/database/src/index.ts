/**
 * `database` — Drizzle スキーマ・マイグレーション・DB クライアント（prd/03）。
 */

export { closeDatabase, type Database, getDatabase, getPool, pingDatabase } from './client.ts'
export { type DatabaseEnv, readDatabaseEnv } from './env.ts'
export {
  encodeProfile,
  question,
  questionDisplayAsset,
  questionEncodedAsset,
  questionEncoding,
  questionOverlayAsset,
  questionStats,
  schema,
  scoreEntry,
  session,
  sessionQuestion,
} from './schema.ts'
