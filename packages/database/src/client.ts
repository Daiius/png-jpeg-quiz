import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import { readDatabaseEnv } from './env.ts'
import { schema } from './schema.ts'

/**
 * ⚠ `ReturnType<typeof drizzle>` は overload で壊れる（同名の別型になる）。
 * **型はここで明示的に書く。**
 */
export type Database = MySql2Database<typeof schema>

let pool: mysql.Pool | undefined
let database: Database | undefined

/**
 * プロセスで 1 つだけプールを持つ。Next.js の dev はモジュールを何度も評価しうるので、
 * 都度 `createPool` しない。
 */
export function getPool(): mysql.Pool {
  pool ??= mysql.createPool(readDatabaseEnv().DATABASE_URL)
  return pool
}

export function getDatabase(): Database {
  database ??= drizzle(getPool(), { schema, mode: 'default' })
  return database
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

/** スクリプト（migrate / seed / pipeline）の終了時に握っている接続を離す */
export async function closeDatabase(): Promise<void> {
  await pool?.end()
  pool = undefined
  database = undefined
}
