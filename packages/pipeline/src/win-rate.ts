import { type Database, encodeProfile, question, questionEncoding } from '@png-jpeg-quiz/database'
import { and, eq } from 'drizzle-orm'

/**
 * `encode_profile.png_win_rate` の再計算（prd/05 §3 ステップ 12）。
 *
 * ⚠ **問題プールが変わるたびに回す。** 得点式の `p` はここから来る（prd/06 §1）ので、
 * 実際の分布とずれていると得点が歪む。CI でも一致を検査する（prd/05 §6）。
 *
 * 🔒 ここで使うのは**プロファイル全体の偏り**という対称な情報だけ。
 * 個別問題について何も語らないので公開してよい（prd/04 §3.5）。
 */
export async function recalcWinRates(database: Database): Promise<Map<string, number>> {
  const rows = await database
    .select({ profileId: questionEncoding.profileId, answer: questionEncoding.answer })
    .from(questionEncoding)
    .innerJoin(question, eq(question.id, questionEncoding.questionId))
    .where(eq(question.status, 'published'))

  const counts = new Map<string, { png: number; total: number }>()
  for (const row of rows) {
    const entry = counts.get(row.profileId) ?? { png: 0, total: 0 }
    entry.total += 1
    if (row.answer === 'png') entry.png += 1
    counts.set(row.profileId, entry)
  }

  const rates = new Map<string, number>()
  for (const [profileId, { png, total }] of counts) {
    const rate = total === 0 ? 0 : png / total
    rates.set(profileId, rate)
    await database
      .update(encodeProfile)
      .set({ pngWinRate: rate })
      .where(eq(encodeProfile.id, profileId))
  }
  return rates
}

/**
 * そのプロファイルで出題が成立するか。
 *
 * ⚠ **プールが片方に寄りきっている（0 または 1）と得点が計算できない**
 * （`-log2(0)` が発散する）。プロファイル選択から外すべき状態を検出する。
 */
export function isPlayable(pngWinRate: number, poolSize: number): boolean {
  return poolSize > 0 && pngWinRate > 0 && pngWinRate < 1
}

/** 出題可能なプロファイルだけを返す */
export async function playableProfiles(database: Database): Promise<string[]> {
  const rows = await database
    .select({ profileId: questionEncoding.profileId, answer: questionEncoding.answer })
    .from(questionEncoding)
    .innerJoin(question, eq(question.id, questionEncoding.questionId))
    .where(eq(question.status, 'published'))

  const counts = new Map<string, { png: number; total: number }>()
  for (const row of rows) {
    const entry = counts.get(row.profileId) ?? { png: 0, total: 0 }
    entry.total += 1
    if (row.answer === 'png') entry.png += 1
    counts.set(row.profileId, entry)
  }

  return [...counts.entries()]
    .filter(([, { png, total }]) => isPlayable(png / total, total))
    .map(([profileId]) => profileId)
    .sort()
}

/** 特定プロファイルの内訳（デバッグ・検査用） */
export async function winRateFor(
  database: Database,
  profileId: string,
): Promise<{ png: number; jpeg: number; rate: number }> {
  const rows = await database
    .select({ answer: questionEncoding.answer })
    .from(questionEncoding)
    .innerJoin(question, eq(question.id, questionEncoding.questionId))
    .where(and(eq(questionEncoding.profileId, profileId), eq(question.status, 'published')))

  const png = rows.filter((row) => row.answer === 'png').length
  const jpeg = rows.length - png
  return { png, jpeg, rate: rows.length === 0 ? 0 : png / rows.length }
}
