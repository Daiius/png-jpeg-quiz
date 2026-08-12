import mysql from 'mysql2/promise'
import { readDatabaseEnv } from './env.ts'

let pool: mysql.Pool | undefined

/**
 * プロセスで 1 つだけプールを持つ。Next.js の dev はモジュールを何度も評価しうるので、
 * 都度 `createPool` しない。
 *
 * TODO(spec): Drizzle クライアントは M1 でスキーマ（prd/03 の 9 テーブル）と同時に足す。
 * M0 の時点では「web から DB へ到達できること」を確かめるだけなので、生の接続だけを持つ。
 */
export function getPool(): mysql.Pool {
  pool ??= mysql.createPool(readDatabaseEnv().DATABASE_URL)
  return pool
}

/** 疎通確認。接続できなければ例外を投げる。 */
export async function pingDatabase(): Promise<void> {
  const connection = await getPool().getConnection()
  try {
    await connection.query('SELECT 1')
  } finally {
    connection.release()
  }
}
