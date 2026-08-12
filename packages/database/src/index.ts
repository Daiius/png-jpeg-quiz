/**
 * `database` — Drizzle スキーマ・マイグレーション・DB クライアント（prd/03）。
 *
 * スキーマ本体（9 テーブル）・マイグレーション・seed は M1 で足す。
 * M0 の時点では接続と環境変数の検証だけを持つ。
 */

export { getPool, pingDatabase } from './client.ts'
export { type DatabaseEnv, readDatabaseEnv } from './env.ts'
